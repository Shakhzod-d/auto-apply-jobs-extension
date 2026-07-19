import type { DashboardConfig } from "../lib/dashboard-config";
import type {
  Application,
  ApplicationStatus,
  FieldType,
  Platform,
  Settings,
  SubmitMode,
  SyncPayload,
} from "../lib/types";

class DashboardApiError extends Error {}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;

// A single transient blip (a Vercel serverless function cold-starting after
// sitting idle through the pacing delay between jobs is the likely everyday
// case, but any network hiccup counts) was previously enough to end an
// entire bulk run outright -- "Failed to fetch" from one flaky request,
// full stop. Retries with backoff on network errors and 5xx responses;
// 4xx (bad token, bad request) fails immediately since retrying won't fix
// those.
async function request<T>(
  config: DashboardConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s

    try {
      const res = await fetch(`${config.dashboardUrl}${path}`, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const error = new DashboardApiError(
          `${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`,
        );
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          lastError = error;
          continue;
        }
        throw error;
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof DashboardApiError) throw err;
      // fetch() itself threw -- network error, likely "Failed to fetch".
      lastError = err;
      if (attempt >= MAX_RETRIES) throw err;
    }
  }

  throw lastError;
}

export function fetchSyncPayload(config: DashboardConfig): Promise<SyncPayload> {
  return request<SyncPayload>(config, "/api/sync");
}

export function reportApplication(
  config: DashboardConfig,
  data: { platform: Platform; jobTitle: string; company: string; url: string },
): Promise<{ application: Application }> {
  return request(config, "/api/applications", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateApplicationStatus(
  config: DashboardConfig,
  applicationId: string,
  data: { status: ApplicationStatus; failureReason?: string; submittedAt?: string },
): Promise<{ application: Application }> {
  return request(config, `/api/applications/${applicationId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function updateSettingsRemote(
  config: DashboardConfig,
  data: { submitMode?: SubmitMode; linkedinEnabled?: boolean; indeedEnabled?: boolean },
): Promise<{ settings: Settings }> {
  return request(config, "/api/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function reportPendingQuestion(
  config: DashboardConfig,
  data: {
    applicationId: string;
    questionText: string;
    fieldType: FieldType;
    options?: string[];
  },
): Promise<{ pendingQuestion: unknown }> {
  return request(config, "/api/questions/pending", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
