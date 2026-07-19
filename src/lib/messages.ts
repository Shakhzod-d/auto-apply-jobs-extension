import type {
  Application,
  ApplicationStatus,
  FieldType,
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
  | { type: "UPDATE_SETTINGS"; submitMode?: SubmitMode };

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
