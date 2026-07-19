import { getDashboardConfig } from "../lib/dashboard-config";
import { getBulkRunState, newBulkRunState, setBulkRunState } from "../lib/bulk-run-state";
import type { ExtensionMessage, ExtensionResponse, ConnectionStatus } from "../lib/messages";
import type { SyncPayload } from "../lib/types";
import {
  fetchSyncPayload,
  reportApplication,
  reportPendingQuestion,
  updateApplicationStatus,
  updateSettingsRemote,
} from "./dashboard-api";

const SEARCH_URLS = {
  linkedin: (keywords: string) =>
    `https://www.linkedin.com/jobs/search/?${new URLSearchParams({ keywords, f_AL: "true" }).toString()}`,
  indeed: (keywords: string) =>
    `https://www.indeed.com/jobs?${new URLSearchParams({ q: keywords }).toString()}`,
} as const;

async function openOrNavigateTab(url: string, hostMatch: string): Promise<number> {
  const tabs = await chrome.tabs.query({ url: `*://*.${hostMatch}/*` });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { url, active: true });
    return tabs[0].id;
  }
  const created = await chrome.tabs.create({ url, active: true });
  return created.id!;
}

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

      case "START_BULK_APPLY": {
        const config = await getDashboardConfig();
        if (!config) throw new Error("Not connected to a dashboard");

        const sync = await refreshSync(true);
        if (!sync.settings.searchKeywords.trim()) {
          throw new Error("Set job search keywords on the dashboard's Settings page first");
        }

        const buildUrl = SEARCH_URLS[message.platform];
        const host = message.platform === "linkedin" ? "linkedin.com" : "indeed.com";
        const driverTabId = await openOrNavigateTab(buildUrl(sync.settings.searchKeywords), host);
        await setBulkRunState({ ...newBulkRunState(message.platform), driverTabId });

        return { ok: true, data: null };
      }

      case "STOP_BULK_APPLY": {
        const current = await getBulkRunState();
        if (current) {
          await setBulkRunState({ ...current, active: false, lastMessage: "Stopped by user" });
        }
        return { ok: true, data: null };
      }

      case "GET_BULK_RUN_STATE": {
        const state = await getBulkRunState();
        return { ok: true, data: state };
      }

      case "UPDATE_SETTINGS": {
        const config = await getDashboardConfig();
        if (!config) throw new Error("Not connected to a dashboard");
        await updateSettingsRemote(config, { submitMode: message.submitMode });
        const data = await refreshSync(true);
        return { ok: true, data };
      }

      case "PREPARE_EXTERNAL_APPLY": {
        const current = await getBulkRunState();
        if (current) {
          await setBulkRunState({
            ...current,
            pendingExternalJobInfo: {
              jobTitle: message.jobTitle,
              company: message.company,
              url: message.url,
            },
          });
        }
        return { ok: true, data: null };
      }

      case "REPORT_EXTERNAL_APPLY_RESULT": {
        const current = await getBulkRunState();
        if (current?.driverTabId) {
          chrome.tabs.sendMessage(current.driverTabId, {
            type: "EXTERNAL_APPLY_DONE",
            result: message.result,
          });
        }
        return { ok: true, data: null };
      }

      // Sent by background *to* a content script via chrome.tabs.sendMessage,
      // not something background itself should ever receive -- these two
      // cases exist only so the switch stays exhaustive.
      case "ARM_EXTERNAL_APPLY":
      case "EXTERNAL_APPLY_DONE":
        return { ok: true, data: null };

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

// A LinkedIn "Apply" (non-Easy-Apply) button opens the employer's own
// application page in a new tab. We can't know that domain ahead of time,
// so instead of a static content_scripts match we watch for a tab opened by
// our own driver tab and arm external-apply.ts (already present on the page
// via the <all_urls> content script, but passive until told) once it's
// loaded.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !tab.openerTabId) return;
  const bulkRun = await getBulkRunState();
  if (!bulkRun?.active || bulkRun.driverTabId !== tab.openerTabId) return;
  await setBulkRunState({ ...bulkRun, pendingExternalTabId: tab.id });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const bulkRun = await getBulkRunState();
  if (!bulkRun?.active || bulkRun.pendingExternalTabId !== tabId) return;

  const jobInfo = bulkRun.pendingExternalJobInfo;
  await setBulkRunState({ ...bulkRun, pendingExternalTabId: undefined, pendingExternalJobInfo: undefined });
  if (!jobInfo) return;

  chrome.tabs.sendMessage(tabId, {
    type: "ARM_EXTERNAL_APPLY",
    jobTitle: jobInfo.jobTitle,
    company: jobInfo.company,
  }).catch(() => {
    // The tab may not have a content script ready yet on the very first
    // update event (e.g. about:blank before the real navigation) -- a
    // later "complete" event for the same tab will retry.
  });
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
