// Off-platform ATS content script -- handles whatever page a LinkedIn
// "Apply" (non-Easy-Apply) button opens: could be Greenhouse, Lever,
// Workday, or a fully custom company careers page. There's no consistent
// structure to rely on the way there is with LinkedIn's own Easy Apply UI,
// so this uses the same shared matching/fill engine but generically (query
// every visible form control on the page, not a specific wrapper class).
//
// Present via a <all_urls> content script match (see manifest.config.ts),
// but stays entirely passive -- does nothing at all -- until the background
// sends it a targeted ARM_EXTERNAL_APPLY message for this exact tab. That
// only happens for a tab our own bulk driver opened, so this never runs on
// a page the user is just browsing.
import { matchAndFillFields, type ExtractedField } from "../lib/autofill-engine";
import { fillFileInput, labelTextFor } from "../lib/dom-fill";
import { sendMessage, type ExtensionMessage } from "../lib/messages";
import type { Application, FieldType, FlowResult, SyncPayload } from "../lib/types";

const log = (...args: unknown[]) => console.log("[auto-apply-jobs:external]", ...args);

function extractAllFields(): ExtractedField[] {
  const fields: ExtractedField[] = [];

  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const seenRadioNames = new Set<string>();
  for (const radio of radios) {
    if (!radio.name || seenRadioNames.has(radio.name)) continue;
    seenRadioNames.add(radio.name);
    const group = radios.filter((r) => r.name === radio.name);
    const label =
      radio.closest("fieldset")?.querySelector("legend")?.textContent?.trim() || labelTextFor(radio);
    fields.push({ element: radio, label, fieldType: "radio", radioGroup: group });
  }

  document.querySelectorAll<HTMLSelectElement>("select").forEach((el) => {
    fields.push({ element: el, label: labelTextFor(el), fieldType: "select" });
  });

  document.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((el) => {
    fields.push({ element: el, label: labelTextFor(el), fieldType: "textarea" });
  });

  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((el) => {
    fields.push({ element: el, label: labelTextFor(el), fieldType: "checkbox" });
  });

  document
    .querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input:not([type])',
    )
    .forEach((el) => {
      fields.push({ element: el, label: labelTextFor(el), fieldType: "text" });
    });

  return fields;
}

function isFieldRequired(field: ExtractedField): boolean {
  const el = field.fieldType === "radio" ? field.radioGroup![0] : field.element;
  return el.required || el.getAttribute("aria-required") === "true";
}

async function handleResumeUpload(resumeFileUrl: string | null) {
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput || !resumeFileUrl || (fileInput.files && fileInput.files.length > 0)) return;
  await fillFileInput(fileInput, resumeFileUrl, "resume.pdf");
}

async function reportResult(result: FlowResult) {
  log("done:", result);
  await sendMessage({ type: "REPORT_EXTERNAL_APPLY_RESULT", result });
}

async function run(jobTitle: string, company: string) {
  try {
    const syncRes = await sendMessage<SyncPayload>({ type: "GET_SYNC_DATA" });
    if (!syncRes.ok) return reportResult("failed");
    const sync = syncRes.data;

    const appRes = await sendMessage<Application>({
      type: "REPORT_APPLICATION",
      // Tagged by discovery source (LinkedIn search), not by where the form
      // actually lives -- the url field below captures the real destination.
      platform: "linkedin",
      jobTitle,
      company,
      url: location.href.split("?")[0],
    });
    if (!appRes.ok) return reportResult("failed");
    const application = appRes.data;

    if (application.status === "submitted" || application.status === "blocked_needs_answer") {
      return reportResult("blocked");
    }

    await handleResumeUpload(sync.profile.resumeFileUrl);

    const fields = extractAllFields();
    const { unmatched } = matchAndFillFields(fields, sync.profile, sync.questionBank);
    const requiredUnmatched = unmatched.filter(isFieldRequired);

    for (const field of requiredUnmatched) {
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

    // Unlike LinkedIn Easy Apply, this never auto-submits -- an unknown
    // site's form isn't verified the way LinkedIn's own consistent Easy
    // Apply UI is, so blind auto-submission risks sending garbage or
    // mis-clicking something irreversible on a real employer's site. Every
    // external-apply application stops for the user's own review and final
    // submit click, regardless of the auto/review setting.
    const status = requiredUnmatched.length > 0 ? "blocked_needs_answer" : "filled_pending_review";
    await sendMessage({ type: "UPDATE_APPLICATION_STATUS", applicationId: application.id, status });

    return reportResult(requiredUnmatched.length > 0 ? "blocked" : "pending_review");
  } catch (err) {
    log("error:", err);
    return reportResult("failed");
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type !== "ARM_EXTERNAL_APPLY") return;
  sendResponse({ ok: true, data: null });
  log("armed for", message.jobTitle, "@", message.company);
  run(message.jobTitle, message.company);
});
