import { fillCheckbox, fillRadioGroup, fillSelect, fillTextInput } from "./dom-fill";
import { matchIdentityField, matchQuestion } from "./matching";
import { sendMessage } from "./messages";
import type { FieldType, Profile, QuestionBankEntry, SyncPayload } from "./types";

export interface ExtractedField {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  label: string;
  fieldType: FieldType;
  /** For fieldType "radio": every radio input in the group (element is the first). */
  radioGroup?: HTMLInputElement[];
}

export interface FillResult {
  field: ExtractedField;
  filled: boolean;
  matchedEntry?: QuestionBankEntry;
}

export function fillField(field: ExtractedField, value: string): boolean {
  switch (field.fieldType) {
    case "text":
    case "textarea":
      return fillTextInput(field.element as HTMLInputElement | HTMLTextAreaElement, value);
    case "select":
      return fillSelect(field.element as HTMLSelectElement, value);
    case "radio":
      return field.radioGroup ? fillRadioGroup(field.radioGroup, value) : false;
    case "checkbox":
      return fillCheckbox(field.element as HTMLInputElement, value);
    default:
      return false;
  }
}

// Runs one matching+filling pass over every extracted field on the current
// form step. Identity fields (name/email/phone/links) are checked against
// Profile first; everything else against the question bank. Fields that
// match nothing come back in `unmatched` for the caller to pause on.
export function matchAndFillFields(
  fields: ExtractedField[],
  profile: Profile,
  questionBank: QuestionBankEntry[],
): { results: FillResult[]; unmatched: ExtractedField[] } {
  const results: FillResult[] = [];
  const unmatched: ExtractedField[] = [];

  for (const field of fields) {
    const identityValue = matchIdentityField(field.label, profile);
    if (identityValue) {
      const filled = fillField(field, identityValue);
      results.push({ field, filled });
      if (!filled) unmatched.push(field);
      continue;
    }

    const match = matchQuestion(field.label, questionBank);
    if (match) {
      const filled = fillField(field, match.entry.answerValue);
      results.push({ field, filled, matchedEntry: match.entry });
      if (!filled) unmatched.push(field);
      continue;
    }

    unmatched.push(field);
  }

  return { results, unmatched };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the dashboard (via the background worker) until the question bank
 * has an entry matching `questionText` -- i.e. until the user answers it
 * from the Needs-your-input queue -- or `timeoutMs` elapses.
 * Returns the answer, or null on timeout.
 */
export async function waitForAnswer(
  questionText: string,
  { pollIntervalMs = 15_000, timeoutMs = 30 * 60_000 } = {},
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await sendMessage<SyncPayload>({ type: "GET_SYNC_DATA", forceRefresh: true });
    if (res.ok) {
      const match = matchQuestion(questionText, res.data.questionBank);
      if (match) return match.entry.answerValue;
    }
    await sleep(pollIntervalMs);
  }

  return null;
}

export function randomDelayMs(minSeconds: number, maxSeconds: number): number {
  const min = Math.min(minSeconds, maxSeconds);
  const max = Math.max(minSeconds, maxSeconds);
  return Math.floor((min + Math.random() * (max - min)) * 1000);
}
