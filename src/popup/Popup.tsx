import { useEffect, useState } from "react";
import { sendMessage } from "../lib/messages";
import type { ConnectionStatus } from "../lib/messages";
import type { BulkRunState } from "../lib/bulk-run-state";
import type { SyncPayload } from "../lib/types";

function useInterval(callback: () => void, ms: number) {
  useEffect(() => {
    const id = setInterval(callback, ms);
    return () => clearInterval(id);
  }, [callback, ms]);
}

export function Popup() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [sync, setSync] = useState<SyncPayload | null>(null);
  const [bulkRun, setBulkRun] = useState<BulkRunState | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [statusRes, syncRes, bulkRes] = await Promise.all([
      sendMessage<ConnectionStatus>({ type: "GET_CONNECTION_STATUS" }),
      sendMessage<SyncPayload>({ type: "GET_SYNC_DATA" }),
      sendMessage<BulkRunState | null>({ type: "GET_BULK_RUN_STATE" }),
    ]);
    if (statusRes.ok) setStatus(statusRes.data);
    if (syncRes.ok) setSync(syncRes.data);
    if (bulkRes.ok) setBulkRun(bulkRes.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Cheap polling while the popup is open -- the bulk loop runs in a
  // different tab's content script, so this is how the popup sees progress
  // without a dedicated push channel.
  useInterval(refresh, 2000);

  async function toggleSubmitMode() {
    if (!sync) return;
    setBusy(true);
    const nextMode = sync.settings.submitMode === "auto" ? "review" : "auto";
    const res = await sendMessage<SyncPayload>({ type: "UPDATE_SETTINGS", submitMode: nextMode });
    if (res.ok) setSync(res.data);
    setBusy(false);
  }

  async function startBulkApply() {
    setBusy(true);
    // Needed so external-apply.ts is allowed to run on whatever off-platform
    // ATS domain a "managed off LinkedIn" job happens to redirect to --
    // requested here (not up front) since it must follow a user gesture.
    await chrome.permissions.request({ origins: ["*://*/*"] });
    await sendMessage({ type: "START_BULK_APPLY", platform: "linkedin" });
    await refresh();
    setBusy(false);
  }

  async function stopBulkApply() {
    setBusy(true);
    await sendMessage({ type: "STOP_BULK_APPLY" });
    await refresh();
    setBusy(false);
  }

  if (!status) {
    return (
      <div style={{ width: 300, padding: 16, fontFamily: "system-ui, sans-serif" }}>
        <p style={{ fontSize: 13, color: "#666" }}>Checking connection…</p>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div style={{ width: 300, padding: 16, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Auto Apply Jobs</h1>
        <p style={{ fontSize: 13, color: "#666" }}>Not connected yet.</p>
        <button type="button" onClick={() => chrome.runtime.openOptionsPage()} style={buttonStyle("#111")}>
          Connect to dashboard
        </button>
      </div>
    );
  }

  const running = bulkRun?.active ?? false;

  return (
    <div style={{ width: 300, padding: 16, fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Auto Apply Jobs</h1>

      {sync && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
          <span>Submit mode</span>
          <button type="button" onClick={toggleSubmitMode} disabled={busy} style={toggleStyle(sync.settings.submitMode === "auto")}>
            {sync.settings.submitMode === "auto" ? "Auto-submit" : "Review first"}
          </button>
        </div>
      )}

      {sync && (
        <div style={{ fontSize: 12, color: "#666" }}>
          Today: {sync.stats.appliedToday} / {sync.settings.dailyCap} overall &middot; LinkedIn{" "}
          {sync.stats.linkedinAppliedToday} / {sync.settings.linkedinDailyCap}
        </div>
      )}

      {sync && !sync.settings.searchKeywords && (
        <p style={{ fontSize: 12, color: "#c0392b" }}>
          Set job search keywords on the dashboard&apos;s Settings page before starting.
        </p>
      )}

      <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
        {!running ? (
          <button
            type="button"
            onClick={startBulkApply}
            disabled={busy || !sync?.settings.searchKeywords}
            style={buttonStyle("#111")}
          >
            Start applying on LinkedIn
          </button>
        ) : (
          <button type="button" onClick={stopBulkApply} disabled={busy} style={buttonStyle("#c0392b")}>
            Stop
          </button>
        )}

        {bulkRun && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#666", display: "flex", flexDirection: "column", gap: 2 }}>
            <span>
              This run: {bulkRun.processedCount} processed &middot; {bulkRun.submittedCount} submitted
              {bulkRun.pendingReviewCount > 0 && ` · ${bulkRun.pendingReviewCount} awaiting review`}
              {bulkRun.blockedCount > 0 && ` · ${bulkRun.blockedCount} need your input`}
              {bulkRun.failedCount > 0 && ` · ${bulkRun.failedCount} failed`}
            </span>
            {bulkRun.lastMessage && <span>{bulkRun.lastMessage}</span>}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#999" }}>Connected to {status.dashboardUrl}</div>
    </div>
  );
}

function buttonStyle(bg: string): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "none",
    background: bg,
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };
}

function toggleStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid " + (active ? "#c0392b" : "#0a7d2c"),
    background: active ? "#fdecea" : "#eafaf0",
    color: active ? "#c0392b" : "#0a7d2c",
    cursor: "pointer",
    fontSize: 12,
  };
}
