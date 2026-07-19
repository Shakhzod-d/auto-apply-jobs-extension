import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Auto Apply Jobs",
  description:
    "Autofills and (optionally) submits job applications on LinkedIn and Indeed, syncing every application to your admin dashboard.",
  version: pkg.version,
  action: {
    default_popup: "src/popup/index.html",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://www.linkedin.com/jobs/*"],
      js: ["src/content/linkedin.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://www.indeed.com/*"],
      js: ["src/content/indeed.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: ["storage", "notifications", "alarms"],
  host_permissions: [
    "https://www.linkedin.com/*",
    "https://www.indeed.com/*",
  ],
  // The dashboard runs at a user-configured URL (localhost while developing,
  // a Vercel domain once deployed). We request just that origin at runtime
  // via chrome.permissions.request() when the user saves it in Options,
  // rather than declaring a fixed/broad host permission up front.
  optional_host_permissions: ["*://*/*"],
});
