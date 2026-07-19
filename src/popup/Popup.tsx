// Placeholder popup UI. Built out fully in the "pacing, caps, popup UI" pass:
// submit-mode toggle, today's application count, quick links to the dashboard.
export function Popup() {
  return (
    <div style={{ width: 280, padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Auto Apply Jobs</h1>
      <p style={{ fontSize: 13, color: "#666" }}>
        Connect this extension to your dashboard from the Options page to get
        started.
      </p>
    </div>
  );
}
