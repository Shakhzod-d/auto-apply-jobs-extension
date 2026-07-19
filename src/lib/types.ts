// Mirrors dashboard/prisma/schema.prisma. Kept as plain hand-written types
// since the extension is a separate project and can't import the dashboard's
// generated Prisma client.

export type Platform = "linkedin" | "indeed";

export type FieldType = "text" | "textarea" | "select" | "radio" | "checkbox";

export type ApplicationStatus =
  | "queued"
  | "filled_pending_review"
  | "submitted"
  | "blocked_needs_answer"
  | "failed";

export type SubmitMode = "auto" | "review";

export interface Profile {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  resumeFileUrl: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  workAuthState: string | null;
  updatedAt: string;
}

export interface QuestionBankEntry {
  id: string;
  questionText: string;
  fieldType: FieldType;
  answerValue: string;
  matchKeywords: string;
  isSensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  id: number;
  submitMode: SubmitMode;
  dailyCap: number;
  linkedinDailyCap: number;
  indeedDailyCap: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  linkedinEnabled: boolean;
  indeedEnabled: boolean;
  searchKeywords: string;
  updatedAt: string;
}

export interface SyncStats {
  appliedToday: number;
  linkedinAppliedToday: number;
  indeedAppliedToday: number;
}

export interface SyncPayload {
  profile: Profile;
  questionBank: QuestionBankEntry[];
  settings: Settings;
  stats: SyncStats;
}

export interface Application {
  id: string;
  platform: Platform;
  jobTitle: string;
  company: string;
  url: string;
  status: ApplicationStatus;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

// Outcome of one application attempt, whether it ran inside a LinkedIn Easy
// Apply modal or on an off-platform ATS page opened via external-apply.
export type FlowResult = "submitted" | "pending_review" | "blocked" | "failed";
