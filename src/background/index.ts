// MV3 background service worker.
// Built out fully in the "background service worker + dashboard sync" pass:
// pulls Profile/QuestionBank/Settings from the dashboard's /api/sync on
// startup + on an alarm interval, caches them in chrome.storage.local, and
// relays messages between content scripts and the dashboard API.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[auto-apply-jobs] background service worker installed");
});
