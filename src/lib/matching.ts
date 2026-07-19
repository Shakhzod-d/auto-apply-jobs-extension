import { normalize } from "./normalize";
import type { Profile, QuestionBankEntry } from "./types";

const MATCH_THRESHOLD = 0.6;

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter(Boolean));
}

// Jaccard-style token overlap. Screening questions get rephrased slightly
// between platforms/postings ("Are you legally authorized to work in the
// US?" vs "Are you legally authorized to work in this country?"), so exact
// string matching would miss most of them -- this tolerates that while still
// rejecting genuinely different questions.
function similarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

export function matchQuestion(
  label: string,
  questionBank: QuestionBankEntry[],
): { entry: QuestionBankEntry; score: number } | null {
  const normalizedLabel = normalize(label);
  if (!normalizedLabel) return null;

  // Exact match short-circuits -- common case, and avoids token-overlap
  // ties between near-duplicate seeded questions.
  const exact = questionBank.find((q) => q.questionText === normalizedLabel);
  if (exact) return { entry: exact, score: 1 };

  let best: { entry: QuestionBankEntry; score: number } | null = null;
  for (const entry of questionBank) {
    const score = similarity(normalizedLabel, entry.questionText);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { entry, score };
    }
  }
  return best;
}

export type IdentityFieldKey = "fullName" | "email" | "phone" | "linkedinUrl" | "portfolioUrl";

const IDENTITY_PATTERNS: { key: IdentityFieldKey; keywords: string[] }[] = [
  { key: "fullName", keywords: ["full", "name"] },
  { key: "email", keywords: ["email"] },
  { key: "email", keywords: ["e", "mail"] },
  { key: "phone", keywords: ["phone"] },
  { key: "phone", keywords: ["mobile", "number"] },
  { key: "phone", keywords: ["telephone"] },
  { key: "linkedinUrl", keywords: ["linkedin"] },
  { key: "portfolioUrl", keywords: ["portfolio"] },
  { key: "portfolioUrl", keywords: ["website"] },
  { key: "portfolioUrl", keywords: ["personal", "site"] },
];

// Identity fields (name/email/phone/links) come straight from Profile, not
// the question bank -- checked before matchQuestion so e.g. "Email" doesn't
// need its own seeded question-bank entry.
export function matchIdentityField(label: string, profile: Profile): string | null {
  const tokens = tokenSet(label);
  if (tokens.size === 0) return null;

  for (const pattern of IDENTITY_PATTERNS) {
    const hit = pattern.keywords.every((kw) => tokens.has(kw));
    if (!hit) continue;

    switch (pattern.key) {
      case "fullName":
        return profile.fullName || null;
      case "email":
        return profile.email || null;
      case "phone":
        return profile.phone || null;
      case "linkedinUrl":
        return profile.linkedinUrl || null;
      case "portfolioUrl":
        return profile.portfolioUrl || null;
    }
  }
  return null;
}
