import { useEffect, useState } from "react";
import { sendMessage } from "../lib/messages";
import type { ConnectionStatus } from "../lib/messages";

export function Popup() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    sendMessage<ConnectionStatus>({ type: "GET_CONNECTION_STATUS" }).then((res) => {
      if (res.ok) setStatus(res.data);
    });
  }, []);

  return (
    <div style={{ width: 280, padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Auto Apply Jobs</h1>

      {status === null && (
        <p style={{ fontSize: 13, color: "#666" }}>Checking connection…</p>
      )}

      {status && !status.connected && (
        <>
          <p style={{ fontSize: 13, color: "#666" }}>Not connected yet.</p>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            style={{
              marginTop: 8,
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Connect to dashboard
          </button>
        </>
      )}

      {status && status.connected && (
        <div style={{ fontSize: 13, color: "#0a7d2c", marginTop: 4 }}>
          Connected to {status.dashboardUrl}
          <div style={{ color: "#666", marginTop: 4 }}>
            Last synced:{" "}
            {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : "never"}
          </div>
        </div>
      )}
    </div>
  );
}
