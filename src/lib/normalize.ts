// Mirrors dashboard/src/lib/normalize.ts exactly -- must stay in sync so a
// question normalized here matches the same QuestionBankEntry.questionText
// the dashboard stored.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
