import { useEffect, useState } from "react";
import { getDashboardConfig, setDashboardConfig, clearDashboardConfig } from "../lib/dashboard-config";
import { sendMessage } from "../lib/messages";
import type { SyncPayload } from "../lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "connected"; payload: SyncPayload }
  | { kind: "error"; message: string };

function originPatternFor(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

export function Options() {
  const [dashboardUrl, setDashboardUrl] = useState("http://localhost:3000");
  const [apiToken, setApiToken] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    getDashboardConfig().then((config) => {
      if (config) {
        setDashboardUrl(config.dashboardUrl);
        setApiToken(config.apiToken);
        setStatus({ kind: "testing" });
        sendMessage<SyncPayload>({ type: "GET_SYNC_DATA", forceRefresh: true }).then((res) => {
          setStatus(res.ok ? { kind: "connected", payload: res.data } : { kind: "error", message: res.error });
        });
      }
    });
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "testing" });

    const origin = originPatternFor(dashboardUrl);
    if (!origin) {
      setStatus({ kind: "error", message: "That doesn't look like a valid URL." });
      return;
    }

    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      setStatus({
        kind: "error",
        message: "Permission was denied -- the extension can't reach the dashboard without it.",
      });
      return;
    }

    const testResult = await sendMessage<SyncPayload>({
      type: "TEST_CONNECTION",
      dashboardUrl,
      apiToken,
    });

    if (!testResult.ok) {
      setStatus({ kind: "error", message: testResult.error });
      return;
    }

    await setDashboardConfig({ dashboardUrl, apiToken });
    // Warm the background worker's cache now that config is saved.
    await sendMessage({ type: "GET_SYNC_DATA", forceRefresh: true });
    setStatus({ kind: "connected", payload: testResult.data });
  }

  async function handleDisconnect() {
    await clearDashboardConfig();
    setStatus({ kind: "idle" });
  }

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Auto Apply Jobs — Settings</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Connect this extension to your dashboard. Find your dashboard URL and
        API token on the dashboard&apos;s own Settings page.
      </p>

      <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          Dashboard URL
          <input
            value={dashboardUrl}
            onChange={(e) => setDashboardUrl(e.target.value)}
            placeholder="https://your-dashboard.vercel.app"
            style={{ padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          API token
          <input
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            type="password"
            style={{ padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <button
          type="submit"
          disabled={status.kind === "testing"}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "none",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          {status.kind === "testing" ? "Connecting…" : "Connect"}
        </button>
      </form>

      <div style={{ marginTop: 16, fontSize: 13 }}>
        {status.kind === "connected" && (
          <div style={{ color: "#0a7d2c" }}>
            Connected as {status.payload.profile.fullName || "(no name set yet)"} — question
            bank has {status.payload.questionBank.length} saved answers.
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={handleDisconnect} style={{ fontSize: 12 }}>
                Disconnect
              </button>
            </div>
          </div>
        )}
        {status.kind === "error" && <div style={{ color: "#c0392b" }}>{status.message}</div>}
      </div>
    </div>
  );
}
