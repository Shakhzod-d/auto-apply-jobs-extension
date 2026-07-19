// Placeholder options UI. Built out fully in the "background service worker +
// dashboard sync" pass: dashboard URL + API token fields, which trigger a
// chrome.permissions.request() for that origin (declared as an optional host
// permission in manifest.config.ts) before the background worker starts syncing.
export function Options() {
  return (
    <div style={{ maxWidth: 480, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Auto Apply Jobs — Settings</h1>
      <p style={{ color: "#666" }}>
        Dashboard connection settings will go here.
      </p>
    </div>
  );
}
