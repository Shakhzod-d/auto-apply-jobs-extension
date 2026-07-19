import { getDashboardConfig } from "../lib/dashboard-config";
import type { ExtensionMessage, ExtensionResponse, ConnectionStatus } from "../lib/messages";
import type { SyncPayload } from "../lib/types";
import {
  fetchSyncPayload,
  reportApplication,
  reportPendingQuestion,
  updateApplicationStatus,
} from "./dashboard-api";

const SYNC_ALARM = "periodic-sync";
const SYNC_CACHE_KEY = "syncCache";
const SYNC_STALE_MS = 60_000; // background alarm also runs every minute; this just bounds forced refreshes

interface SyncCache {
  data: SyncPayload;
  fetchedAt: number;
}

async function getCache(): Promise<SyncCache | null> {
  const result = await chrome.storage.local.get(SYNC_CACHE_KEY);
  return (result[SYNC_CACHE_KEY] as SyncCache | undefined) ?? null;
}

async function setCache(data: SyncPayload): Promise<SyncCache> {
  const cache: SyncCache = { data, fetchedAt: Date.now() };
  await chrome.storage.local.set({ [SYNC_CACHE_KEY]: cache });
  return cache;
}

async function refreshSync(forceRefresh: boolean): Promise<SyncPayload> {
  const config = await getDashboardConfig();
  if (!config) throw new Error("Extension is not connected to a dashboard yet");

  if (!forceRefresh) {
    const cached = await getCache();
    if (cached && Date.now() - cached.fetchedAt < SYNC_STALE_MS) {
      return cached.data;
    }
  }

  const data = await fetchSyncPayload(config);
  await setCache(data);
  return data;
}

async function handleMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse> {
  try {
    switch (message.type) {
      case "TEST_CONNECTION": {
        const data = await fetchSyncPayload({
          dashboardUrl: message.dashboardUrl.replace(/\/+$/, ""),
          apiToken: message.apiToken,
        });
        return { ok: true, data };
      }

      case "GET_SYNC_DATA": {
        const data = await refreshSync(message.forceRefresh ?? false);
        return { ok: true, data };
      }

      case "GET_CONNECTION_STATUS": {
        const config = await getDashboardConfig();
        const cache = await getCache();
        const status: ConnectionStatus = {
          connected: !!config,
          dashboardUrl: config?.dashboardUrl ?? null,
          lastSyncAt: cache?.fetchedAt ?? null,
        };
        return { ok: true, data: status };
      }

      case "REPORT_APPLICATION": {
        const config = await getDashboardConfig();
        if (!config) throw new Error("Not connected to a dashboard");
        const result = await reportApplication(config, {
          platform: message.platform,
          jobTitle: message.jobTitle,
          company: message.company,
          url: message.url,
        });
        return { ok: true, data: result.application };
      }

      case "UPDATE_APPLICATION_STATUS": {
        const config = await getDashboardConfig();
        if (!config) throw new Error("Not connected to a dashboard");
        const result = await updateApplicationStatus(config, message.applicationId, {
          status: message.status,
          failureReason: message.failureReason,
          submittedAt: message.submittedAt,
        });
        return { ok: true, data: result.application };
      }

      case "REPORT_PENDING_QUESTION": {
        const config = await getDashboardConfig();
        if (!config) throw new Error("Not connected to a dashboard");
        await reportPendingQuestion(config, {
          applicationId: message.applicationId,
          questionText: message.questionText,
          fieldType: message.fieldType,
          options: message.options,
        });

        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("public/icon128.png"),
          title: "Auto Apply Jobs — needs your input",
          message: `"${message.questionText}" — answer it on the dashboard to resume this application.`,
          priority: 2,
        });

        return { ok: true, data: null };
      }

      default: {
        const _exhaustive: never = message;
        throw new Error(`Unknown message type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  refreshSync(true).catch(() => {
    // not connected yet -- normal on first install, before Options is configured
  });
});

chrome.runtime.onStartup.addListener(() => {
  refreshSync(true).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    refreshSync(true).catch(() => {});
  }
});
