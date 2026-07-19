import type { DashboardConfig } from "../lib/dashboard-config";
import type {
  Application,
  ApplicationStatus,
  FieldType,
  Platform,
  SyncPayload,
} from "../lib/types";

class DashboardApiError extends Error {}

async function request<T>(
  config: DashboardConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
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
    throw new DashboardApiError(
      `${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`,
    );
  }

  return res.json() as Promise<T>;
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
