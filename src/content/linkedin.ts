// LinkedIn Easy Apply content script.
//
// Selectors below were captured by hand-inspecting a real Easy Apply modal
// (2026-07-19) -- LinkedIn's own CSS classes are build-hashed and unstable,
// but these `data-*`/`data-test-*` attributes and native `<label for>`
// associations held steady across the whole flow and are the intended hooks
// for this kind of tooling. They *will* need occasional maintenance as
// LinkedIn changes its markup -- that's expected, not a bug to chase forever.
import {
  fillField,
  matchAndFillFields,
  randomDelayMs,
  waitForAnswer,
  type ExtractedField,
} from "../lib/autofill-engine";
import { fillFileInput, labelTextFor } from "../lib/dom-fill";
import { sendMessage } from "../lib/messages";
import type { Application, FieldType, SyncPayload } from "../lib/types";

const SELECTORS = {
  modal: ".artdeco-modal",
  nextButton: "[data-easy-apply-next-button]",
  reviewButton: "[data-live-test-easy-apply-review-button]",
  submitButton: "[data-live-test-easy-apply-submit-button]",
  formFieldWrapper: "[data-test-form-element]",
  jobTitle: ".job-details-jobs-unified-top-card__job-title",
  companyName: ".job-details-jobs-unified-top-card__company-name",
  jobIdHolder: "[data-job-id]",
} as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEasyApplyModal(modal: Element): boolean {
  return (
    !!modal.querySelector(SELECTORS.formFieldWrapper) ||
    /Apply to/.test(modal.querySelector("h2")?.textContent ?? "")
  );
}

// Closes the modal and discards the in-progress draft (the "Discard" choice
// in LinkedIn's "Save this application?" confirmation) -- used on our own
// error paths so a stuck/unrecognized form doesn't block the rest of a bulk
// run stuck behind an open modal.
async function closeAndDiscardModal(modal: Element) {
  const closeButton = modal.querySelector<HTMLElement>("[data-test-modal-close-btn]");
  closeButton?.click();
  await sleep(500);
  const discardButton = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Discard",
  );
  discardButton?.click();
}

function getCurrentJobInfo(): { jobTitle: string; company: string; url: string } | null {
  const titleEl = document.querySelector(SELECTORS.jobTitle);
  const companyEl = document.querySelector(SELECTORS.companyName);
  const jobId = document.querySelector(SELECTORS.jobIdHolder)?.getAttribute("data-job-id");

  const jobTitle = titleEl?.textContent?.trim();
  const company = companyEl?.textContent?.trim();
  if (!jobTitle || !company || !jobId) return null;

  return {
    jobTitle,
    company,
    // Canonical URL keyed on the numeric job ID -- the visible location.href
    // while browsing search results includes volatile query params
    // (currentJobId, search keywords) that would defeat the dashboard's
    // dedupe-by-url logic.
    url: `https://www.linkedin.com/jobs/view/${jobId}/`,
  };
}

// One row of the form (a single question) can be a text input, a
// select/dropdown, a radio group, or a checkbox. LinkedIn wraps every one of
// these consistently in a [data-test-form-element] container regardless of
// step (contact info, resume, screening questions, ...).
function extractFieldsFromCurrentStep(modal: Element): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const wrappers = modal.querySelectorAll(SELECTORS.formFieldWrapper);

  for (const wrapper of Array.from(wrappers)) {
    const radios = Array.from(wrapper.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    if (radios.length > 0) {
      const label =
        wrapper.querySelector("legend, .fb-dash-form-element__label")?.textContent?.trim() ||
        labelTextFor(radios[0]);
      fields.push({ element: radios[0], label, fieldType: "radio", radioGroup: radios });
      continue;
    }

    const select = wrapper.querySelector<HTMLSelectElement>("select");
    if (select) {
      fields.push({ element: select, label: labelTextFor(select), fieldType: "select" });
      continue;
    }

    const textarea = wrapper.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) {
      fields.push({ element: textarea, label: labelTextFor(textarea), fieldType: "textarea" });
      continue;
    }

    const checkbox = wrapper.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox) {
      fields.push({ element: checkbox, label: labelTextFor(checkbox), fieldType: "checkbox" });
      continue;
    }

    const textInput = wrapper.querySelector<HTMLInputElement>(
      'input[type="text"], input[type="tel"], input[type="email"], input[type="number"]',
    );
    if (textInput) {
      fields.push({ element: textInput, label: labelTextFor(textInput), fieldType: "text" });
    }
    // input[type="file"] (resume) is handled separately by handleResumeStep().
  }

  return fields;
}

function isFieldRequired(field: ExtractedField): boolean {
  const el = field.fieldType === "radio" ? field.radioGroup![0] : field.element;
  return el.required || el.getAttribute("aria-required") === "true";
}

async function handleResumeStep(modal: Element, resumeFileUrl: string | null): Promise<void> {
  const fileInput = modal.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) return; // not a resume step

  // LinkedIn auto-selects a previously-used resume when one exists -- only
  // upload a fresh one if the step is genuinely empty and we have a file.
  const alreadySelected = modal.querySelector('input[type="radio"]:checked');
  if (alreadySelected || !resumeFileUrl) return;

  await fillFileInput(fileInput, resumeFileUrl, "resume.pdf");
}

function findStageButton(
  modal: Element,
): { kind: "next" | "review" | "submit"; el: HTMLElement } | null {
  const submit = modal.querySelector<HTMLElement>(SELECTORS.submitButton);
  if (submit) return { kind: "submit", el: submit };

  const review = modal.querySelector<HTMLElement>(SELECTORS.reviewButton);
  if (review) return { kind: "review", el: review };

  const next = modal.querySelector<HTMLElement>(SELECTORS.nextButton);
  if (next) return { kind: "next", el: next };

  return null;
}

async function reportUnmatchedField(
  application: Application,
  field: ExtractedField,
): Promise<string | null> {
  const options =
    field.fieldType === "select"
      ? Array.from((field.element as HTMLSelectElement).options).map((o) => o.textContent?.trim() ?? "")
      : field.fieldType === "radio"
        ? field.radioGroup!.map((r) => labelTextFor(r) || r.value)
        : undefined;

  await sendMessage({
    type: "REPORT_PENDING_QUESTION",
    applicationId: application.id,
    questionText: field.label,
    fieldType: field.fieldType as FieldType,
    options,
  });

  return waitForAnswer(field.label);
}

async function failApplication(application: Application, reason: string, modal: Element) {
  await sendMessage({
    type: "UPDATE_APPLICATION_STATUS",
    applicationId: application.id,
    status: "failed",
    failureReason: reason,
  });
  await closeAndDiscardModal(modal);
}

async function runEasyApplyFlow(modal: Element, application: Application, sync: SyncPayload) {
  const MAX_STEPS = 25;

  for (let step = 0; step < MAX_STEPS; step++) {
    await handleResumeStep(modal, sync.profile.resumeFileUrl);

    const fields = extractFieldsFromCurrentStep(modal);
    const { unmatched } = matchAndFillFields(fields, sync.profile, sync.questionBank);
    const requiredUnmatched = unmatched.filter(isFieldRequired);

    for (const field of requiredUnmatched) {
      const answer = await reportUnmatchedField(application, field);
      if (!answer) {
        await failApplication(
          application,
          `Timed out waiting for an answer to: "${field.label}"`,
          modal,
        );
        return;
      }
      fillField(field, answer);
    }

    const button = findStageButton(modal);
    if (!button) {
      await failApplication(
        application,
        "Could not find a Next/Review/Submit button on the current step",
        modal,
      );
      return;
    }

    if (button.kind === "submit") {
      if (sync.settings.submitMode === "review") {
        await sendMessage({
          type: "UPDATE_APPLICATION_STATUS",
          applicationId: application.id,
          status: "filled_pending_review",
        });
      } else {
        button.el.click();
        await sendMessage({
          type: "UPDATE_APPLICATION_STATUS",
          applicationId: application.id,
          status: "submitted",
          submittedAt: new Date().toISOString(),
        });
      }
      return;
    }

    button.el.click();
    await sleep(randomDelayMs(2, 4));
  }

  await failApplication(
    application,
    `Exceeded ${MAX_STEPS} steps without reaching submit -- form is probably longer/different than expected`,
    modal,
  );
}

async function onEasyApplyModalOpened(modal: Element) {
  const jobInfo = getCurrentJobInfo();
  if (!jobInfo) return;

  const syncRes = await sendMessage<SyncPayload>({ type: "GET_SYNC_DATA" });
  if (!syncRes.ok) return;
  const sync = syncRes.data;

  if (!sync.settings.linkedinEnabled) return;

  const appRes = await sendMessage<Application>({
    type: "REPORT_APPLICATION",
    platform: "linkedin",
    jobTitle: jobInfo.jobTitle,
    company: jobInfo.company,
    url: jobInfo.url,
  });
  if (!appRes.ok) return;
  const application = appRes.data;

  // Already handled before (submitted, or already sitting in the pending
  // queue from a previous pass) -- don't reprocess.
  if (application.status === "submitted" || application.status === "blocked_needs_answer") return;

  await runEasyApplyFlow(modal, application, sync);
}

const seenModals = new WeakSet<Element>();

const observer = new MutationObserver(() => {
  const modal = document.querySelector(SELECTORS.modal);
  if (modal && isEasyApplyModal(modal) && !seenModals.has(modal)) {
    seenModals.add(modal);
    onEasyApplyModalOpened(modal).catch((err) => {
      console.error("[auto-apply-jobs] linkedin flow failed", err);
    });
  }
});

observer.observe(document.body, { childList: true, subtree: true });

console.log("[auto-apply-jobs] linkedin content script loaded");
