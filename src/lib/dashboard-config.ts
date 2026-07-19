export interface DashboardConfig {
  dashboardUrl: string; // no trailing slash
  apiToken: string;
}

const STORAGE_KEY = "dashboardConfig";

export async function getDashboardConfig(): Promise<DashboardConfig | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as DashboardConfig | undefined) ?? null;
}

export async function setDashboardConfig(config: DashboardConfig): Promise<void> {
  const normalized: DashboardConfig = {
    dashboardUrl: config.dashboardUrl.replace(/\/+$/, ""),
    apiToken: config.apiToken.trim(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}

export async function clearDashboardConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
