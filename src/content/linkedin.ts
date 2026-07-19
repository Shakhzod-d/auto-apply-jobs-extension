// LinkedIn Easy Apply content script.
//
// Selectors below were captured by hand-inspecting real Easy Apply flows and
// search results (2026-07-19) -- LinkedIn's own CSS classes are
// build-hashed and unstable, but these `data-*`/`data-test-*` attributes,
// native `<label for>` associations, and aria-labels held steady throughout
// and are the intended hooks for this kind of tooling. They *will* need
// occasional maintenance as LinkedIn changes its markup -- expected, not a
// bug to chase forever.
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
import {
  getBulkRunState,
  setBulkRunState,
  type BulkRunState,
} from "../lib/bulk-run-state";

const SELECTORS = {
  modal: ".artdeco-modal",
  nextButton: "[data-easy-apply-next-button]",
  reviewButton: "[data-live-test-easy-apply-review-button]",
  submitButton: "[data-live-test-easy-apply-submit-button]",
  formFieldWrapper: "[data-test-form-element]",
  jobTitle: ".job-details-jobs-unified-top-card__job-title",
  companyName: ".job-details-jobs-unified-top-card__company-name",
  jobIdHolder: "[data-job-id]",
  jobCard: "li[data-occludable-job-id]",
  nextPageButton: 'button[aria-label="View next page"]',
} as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LinkedIn is a heavy Ember SPA -- after a navigation (or a card click that
// swaps the details pane), the DOM the new view will render into exists
// well before the actual content does. Polling instead of a fixed delay
// avoids both "gave up too early" (the bug that shipped first) and paying a
// worst-case delay on every single job when it usually loads fast.
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 15_000, intervalMs = 400 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

function isEasyApplyModal(modal: Element): boolean {
  return (
    !!modal.querySelector(SELECTORS.formFieldWrapper) ||
    /Apply to/.test(modal.querySelector("h2")?.textContent ?? "")
  );
}

async function clickAndWait(el: HTMLElement, ms = 500) {
  el.click();
  await sleep(ms);
}

// Closes the modal via the "Save this application?" confirmation.
// `keepDraft: true` clicks Save (LinkedIn remembers it under My Jobs > In
// Progress, so a later pass can pick it back up) -- used when a bulk run
// abandons an application because it hit an unanswered required question,
// so we don't lose the fields already filled. `keepDraft: false` clicks
// Discard -- used on genuine errors where resuming wouldn't help.
async function closeModal(modal: Element, keepDraft: boolean) {
  const closeButton = modal.querySelector<HTMLElement>("[data-test-modal-close-btn]");
  if (!closeButton) return;
  await clickAndWait(closeButton);

  const buttons = Array.from(document.querySelectorAll("button"));
  const target = buttons.find((b) => b.textContent?.trim() === (keepDraft ? "Save" : "Discard"));
  target?.click();
  await sleep(500);
}

function getCurrentJobInfo(): { jobTitle: string; company: string; url: string } | null {
  const titleEl = document.querySelector(SELECTORS.jobTitle);
  const companyEl = document.querySelector(SELECTORS.companyName);
  const jobId = document.querySelector(SELECTORS.jobIdHolder)?.getAttribute("data-job-id");

  const jobTitle = titleEl?.textContent?.trim();
  const company = companyEl?.textContent?.trim();
  if (!jobTitle || !company || !jobId) return null;

  return { jobTitle, company, url: jobUrlFromId(jobId) };
}

function jobUrlFromId(jobId: string): string {
  // Canonical URL keyed on the numeric job ID -- the visible location.href
  // while browsing search results includes volatile query params
  // (currentJobId, tracking IDs) that would defeat the dashboard's
  // dedupe-by-url logic.
  return `https://www.linkedin.com/jobs/view/${jobId}/`;
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
): Promise<void> {
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
}

type FlowResult = "submitted" | "pending_review" | "blocked" | "failed";

async function failApplication(
  application: Application,
  reason: string,
  modal: Element,
): Promise<FlowResult> {
  await sendMessage({
    type: "UPDATE_APPLICATION_STATUS",
    applicationId: application.id,
    status: "failed",
    failureReason: reason,
  });
  await closeModal(modal, false);
  return "failed";
}

// `interactive: true` (a human just clicked Easy Apply themselves) blocks on
// each unanswered required question, waiting for the user to answer it from
// the dashboard, since they're right there expecting the form to complete.
// `interactive: false` (the bulk driver opened this) never blocks -- it
// reports the question, saves the draft, and moves on immediately, since
// blocking a 1000-job run for up to 30 minutes per unknown question would
// defeat the purpose. That application stays `blocked_needs_answer` for a
// human (or a future resume pass) to pick up later.
async function runEasyApplyFlow(
  modal: Element,
  application: Application,
  sync: SyncPayload,
  interactive: boolean,
): Promise<FlowResult> {
  const MAX_STEPS = 25;

  for (let step = 0; step < MAX_STEPS; step++) {
    await handleResumeStep(modal, sync.profile.resumeFileUrl);

    const fields = extractFieldsFromCurrentStep(modal);
    const { unmatched } = matchAndFillFields(fields, sync.profile, sync.questionBank);
    const requiredUnmatched = unmatched.filter(isFieldRequired);

    if (requiredUnmatched.length > 0 && !interactive) {
      for (const field of requiredUnmatched) await reportUnmatchedField(application, field);
      await closeModal(modal, true);
      return "blocked";
    }

    for (const field of requiredUnmatched) {
      await reportUnmatchedField(application, field);
      const answer = await waitForAnswer(field.label);
      if (!answer) {
        return failApplication(
          application,
          `Timed out waiting for an answer to: "${field.label}"`,
          modal,
        );
      }
      fillField(field, answer);
    }

    const button = findStageButton(modal);
    if (!button) {
      return failApplication(
        application,
        "Could not find a Next/Review/Submit button on the current step",
        modal,
      );
    }

    if (button.kind === "submit") {
      if (sync.settings.submitMode === "review") {
        await sendMessage({
          type: "UPDATE_APPLICATION_STATUS",
          applicationId: application.id,
          status: "filled_pending_review",
        });
        return "pending_review";
      }
      button.el.click();
      await sendMessage({
        type: "UPDATE_APPLICATION_STATUS",
        applicationId: application.id,
        status: "submitted",
        submittedAt: new Date().toISOString(),
      });
      return "submitted";
    }

    button.el.click();
    await sleep(randomDelayMs(2, 4));
  }

  return failApplication(
    application,
    `Exceeded ${MAX_STEPS} steps without reaching submit -- form is probably longer/different than expected`,
    modal,
  );
}

// The observer below fires for *every* Easy Apply modal, whether a human or
// the bulk driver opened it. When the driver is waiting on one, it stashes
// its resolver here so the observer's result flows back to it; otherwise
// the observer treats the open as an interactive, user-initiated one.
let pendingBulkResolve: ((result: FlowResult) => void) | null = null;

function waitForNextModalResult(): Promise<FlowResult> {
  return new Promise((resolve) => {
    pendingBulkResolve = resolve;
  });
}

// Captured by the bulk driver right before it clicks Easy Apply (while the
// details pane -- not yet a modal -- is guaranteed queryable), used as a
// fallback below in case the modal covers/removes the underlying pane's
// title/company elements by the time this async handler actually runs.
let pendingJobInfo: { jobTitle: string; company: string; url: string } | null = null;

// Every exit path below MUST resolve `resolveBulk` if it was set -- the
// bulk-driver bug that shipped first (loop just hangs, "0 processed"
// forever) was this function returning early without doing so, e.g. when
// getCurrentJobInfo() came back null. A safety timeout in the driver covers
// us even if a future change misses a path, but that's a 90s stall per
// miss, not a fix.
async function onEasyApplyModalOpened(modal: Element) {
  const resolveBulk = pendingBulkResolve;
  pendingBulkResolve = null;
  const interactive = !resolveBulk;
  const fallbackJobInfo = pendingJobInfo;
  pendingJobInfo = null;

  try {
    const jobInfo = getCurrentJobInfo() ?? fallbackJobInfo;
    if (!jobInfo) {
      log("could not determine job info for the open modal");
      resolveBulk?.("failed");
      return;
    }

    const syncRes = await sendMessage<SyncPayload>({ type: "GET_SYNC_DATA" });
    if (!syncRes.ok) {
      log("sync failed while handling modal:", syncRes.error);
      resolveBulk?.("failed");
      return;
    }
    const sync = syncRes.data;

    if (!sync.settings.linkedinEnabled) {
      resolveBulk?.("failed");
      return;
    }

    const appRes = await sendMessage<Application>({
      type: "REPORT_APPLICATION",
      platform: "linkedin",
      jobTitle: jobInfo.jobTitle,
      company: jobInfo.company,
      url: jobInfo.url,
    });
    if (!appRes.ok) {
      log("failed to report application:", appRes.error);
      resolveBulk?.("failed");
      return;
    }
    const application = appRes.data;

    // Already handled before (submitted, or already sitting in the pending
    // queue from a previous pass) -- don't reprocess.
    if (application.status === "submitted" || application.status === "blocked_needs_answer") {
      resolveBulk?.("blocked");
      return;
    }

    const result = await runEasyApplyFlow(modal, application, sync, interactive);
    resolveBulk?.(result);
  } catch (err) {
    log("onEasyApplyModalOpened threw:", err);
    resolveBulk?.("failed");
  }
}

const seenModals = new WeakSet<Element>();

const observer = new MutationObserver(() => {
  const modal = document.querySelector(SELECTORS.modal);
  if (modal && isEasyApplyModal(modal) && !seenModals.has(modal)) {
    seenModals.add(modal);
    onEasyApplyModalOpened(modal).catch((err) => {
      console.error("[auto-apply-jobs] linkedin flow failed", err);
      pendingBulkResolve?.("failed");
      pendingBulkResolve = null;
    });
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------------------
// Bulk-apply driver: works through the current search results page, clicking
// Easy Apply on each not-yet-applied listing and letting the flow above
// handle the resulting modal.

function getJobCards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.jobCard));
}

function cardJobId(card: HTMLElement): string | null {
  return card.querySelector("[data-job-id]")?.getAttribute("data-job-id") ?? null;
}

function cardIsEasyApply(card: HTMLElement): boolean {
  return /Easy Apply/i.test(card.textContent ?? "");
}

function cardAlreadyApplied(card: HTMLElement): boolean {
  return /\bApplied\b/.test(card.textContent ?? "");
}

async function goToNextPage(): Promise<boolean> {
  const nextButton = document.querySelector<HTMLButtonElement>(SELECTORS.nextPageButton);
  if (!nextButton || nextButton.disabled) return false;
  await clickAndWait(nextButton, 2000);
  return true;
}

const log = (...args: unknown[]) => console.log("[auto-apply-jobs]", ...args);

async function reportStatus(message: string) {
  log(message);
  const current = await getBulkRunState();
  if (current) await setBulkRunState({ ...current, lastMessage: message, lastActivityAt: Date.now() });
}

async function stopBulkRun(reason: string) {
  log("stopping:", reason);
  const current = await getBulkRunState();
  if (current) await setBulkRunState({ ...current, active: false, lastMessage: reason });
}

async function bulkApplyLoop() {
  const processedJobIds = new Set<string>();
  log("bulk apply loop started");

  while (true) {
    try {
      const bulkRun = await getBulkRunState();
      if (!bulkRun?.active || bulkRun.platform !== "linkedin") {
        log("loop exiting: run no longer active");
        return;
      }

      const syncRes = await sendMessage<SyncPayload>({ type: "GET_SYNC_DATA", forceRefresh: true });
      if (!syncRes.ok) return stopBulkRun("Lost connection to dashboard: " + syncRes.error);
      const sync = syncRes.data;

      if (!sync.settings.linkedinEnabled) return stopBulkRun("LinkedIn disabled in Settings");
      if (sync.stats.appliedToday >= sync.settings.dailyCap) return stopBulkRun("Overall daily cap reached");
      if (sync.stats.linkedinAppliedToday >= sync.settings.linkedinDailyCap) {
        return stopBulkRun("LinkedIn daily cap reached");
      }

      await reportStatus("Looking for the next job…");
      await waitFor(() => getJobCards().length > 0);
      const cards = getJobCards();
      const next = cards.find((card) => {
        const jobId = cardJobId(card);
        return jobId && !processedJobIds.has(jobId) && cardIsEasyApply(card) && !cardAlreadyApplied(card);
      });

      if (!next) {
        await reportStatus("No more unapplied jobs on this page, trying next page…");
        const advanced = await goToNextPage();
        if (!advanced) return stopBulkRun("No more results");
        await waitFor(() => getJobCards().length > 0);
        continue;
      }

      const jobId = cardJobId(next)!;
      processedJobIds.add(jobId);
      const cardTitle = next.querySelector('a[href*="/jobs/view/"]')?.textContent?.trim() ?? jobId;

      await reportStatus(`Opening: ${cardTitle}`);
      next.scrollIntoView({ block: "center" });
      await clickAndWait(next, 300);

      const applyButtonSelector = '.jobs-apply-button[data-live-test-job-apply-button], .jobs-apply-button';
      const appeared = await waitFor(() => !!document.querySelector(applyButtonSelector));
      if (!appeared) {
        log("no Easy Apply button appeared for", cardTitle, "-- skipping");
        continue;
      }
      const applyButton = document.querySelector<HTMLElement>(applyButtonSelector)!;

      await reportStatus(`Applying: ${cardTitle}`);
      pendingJobInfo = getCurrentJobInfo(); // captured pre-modal, while reliably queryable
      const resultPromise = waitForNextModalResult();
      applyButton.click();

      const result = await Promise.race([
        resultPromise,
        sleep(90_000).then((): FlowResult => {
          log("timed out waiting for modal flow to finish for", cardTitle);
          return "failed";
        }),
      ]);
      log("result for", cardTitle, "=", result);

      const updated = await getBulkRunState();
      if (!updated) return;
      await setBulkRunState({
        ...updated,
        processedCount: updated.processedCount + 1,
        submittedCount: updated.submittedCount + (result === "submitted" ? 1 : 0),
        pendingReviewCount: updated.pendingReviewCount + (result === "pending_review" ? 1 : 0),
        blockedCount: updated.blockedCount + (result === "blocked" ? 1 : 0),
        failedCount: updated.failedCount + (result === "failed" ? 1 : 0),
        lastActivityAt: Date.now(),
        lastMessage: `${cardTitle}: ${result}`,
      });

      // In review mode, a submitted-for-review application leaves the modal
      // open for the user -- stop the automated loop rather than barreling
      // into the next job out from under them.
      if (result === "pending_review") {
        return stopBulkRun("Filled and waiting for your review");
      }

      await sleep(randomDelayMs(sync.settings.minDelaySeconds, sync.settings.maxDelaySeconds));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[auto-apply-jobs] bulk apply loop error", err);
      await stopBulkRun("Stopped on error: " + message);
      return;
    }
  }
}

async function maybeStartBulkRun() {
  const bulkRun = await getBulkRunState();
  if (bulkRun?.active && bulkRun.platform === "linkedin") {
    bulkApplyLoop().catch((err) => console.error("[auto-apply-jobs] bulk apply loop failed", err));
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  const newValue = changes.bulkRun?.newValue as BulkRunState | undefined;
  if (areaName === "local" && newValue?.active) {
    maybeStartBulkRun();
  }
});

maybeStartBulkRun();

console.log("[auto-apply-jobs] linkedin content script loaded");
