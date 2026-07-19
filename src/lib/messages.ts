import type {
  Application,
  ApplicationStatus,
  FieldType,
  FlowResult,
  Platform,
  SubmitMode,
  SyncPayload,
} from "./types";

export type ExtensionMessage =
  | { type: "TEST_CONNECTION"; dashboardUrl: string; apiToken: string }
  | { type: "GET_SYNC_DATA"; forceRefresh?: boolean }
  | { type: "GET_CONNECTION_STATUS" }
  | {
      type: "REPORT_APPLICATION";
      platform: Platform;
      jobTitle: string;
      company: string;
      url: string;
    }
  | {
      type: "UPDATE_APPLICATION_STATUS";
      applicationId: string;
      status: ApplicationStatus;
      failureReason?: string;
      submittedAt?: string;
    }
  | {
      type: "REPORT_PENDING_QUESTION";
      applicationId: string;
      questionText: string;
      fieldType: FieldType;
      options?: string[];
    }
  | { type: "START_BULK_APPLY"; platform: Platform }
  | { type: "STOP_BULK_APPLY" }
  | { type: "GET_BULK_RUN_STATE" }
  | { type: "UPDATE_SETTINGS"; submitMode?: SubmitMode }
  // Driver -> background, just before clicking an external "Apply" button --
  // the new tab it opens has no way to know the job title/company itself.
  | { type: "PREPARE_EXTERNAL_APPLY"; jobTitle: string; company: string; url: string }
  // Background -> a specific off-platform ATS tab, via chrome.tabs.sendMessage:
  // "you're the tab a LinkedIn Apply click opened, go ahead."
  | { type: "ARM_EXTERNAL_APPLY"; jobTitle: string; company: string }
  // That tab -> background, once it's done (via the normal
  // chrome.runtime.sendMessage path), and background's relay of it back to
  // the LinkedIn driver tab (via chrome.tabs.sendMessage).
  | { type: "REPORT_EXTERNAL_APPLY_RESULT"; result: FlowResult }
  | { type: "EXTERNAL_APPLY_DONE"; result: FlowResult };

export type ExtensionResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ConnectionStatus {
  connected: boolean;
  dashboardUrl: string | null;
  lastSyncAt: number | null;
}

// Thin typed wrapper around chrome.runtime.sendMessage -- every response
// follows the { ok, data | error } shape so callers don't need try/catch
// around chrome.runtime.lastError plumbing.
export function sendMessage<T = unknown>(
  message: ExtensionMessage,
): Promise<ExtensionResponse<T>> {
  return chrome.runtime.sendMessage(message).catch(
    (err): ExtensionResponse<T> => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

export type { Application, SyncPayload };
