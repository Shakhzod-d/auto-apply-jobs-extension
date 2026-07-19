import type { Platform } from "./types";

export interface BulkRunState {
  active: boolean;
  platform: Platform;
  startedAt: number;
  processedCount: number;
  submittedCount: number;
  pendingReviewCount: number;
  blockedCount: number;
  failedCount: number;
  lastActivityAt: number;
  lastMessage?: string;
}

const STORAGE_KEY = "bulkRun";

export async function getBulkRunState(): Promise<BulkRunState | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as BulkRunState | undefined) ?? null;
}

export async function setBulkRunState(state: BulkRunState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export function newBulkRunState(platform: Platform): BulkRunState {
  const now = Date.now();
  return {
    active: true,
    platform,
    startedAt: now,
    processedCount: 0,
    submittedCount: 0,
    pendingReviewCount: 0,
    blockedCount: 0,
    failedCount: 0,
    lastActivityAt: now,
  };
}
