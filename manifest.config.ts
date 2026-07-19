import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Auto Apply Jobs",
  description:
    "Autofills and (optionally) submits LinkedIn job applications -- Easy Apply and off-platform ATS pages alike -- syncing every application to your admin dashboard.",
  version: pkg.version,
  icons: {
    16: "public/icon16.png",
    32: "public/icon32.png",
    48: "public/icon48.png",
    128: "public/icon128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "public/icon16.png",
      32: "public/icon32.png",
      48: "public/icon48.png",
      128: "public/icon128.png",
    },
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
      // Off-platform ATS pages a LinkedIn "Apply" button opens aren't a
      // known domain ahead of time, so this matches everywhere -- but Chrome
      // only actually injects it on origins the extension currently has
      // host permission for, which starts as none (see
      // optional_host_permissions below) and is granted only when the user
      // clicks "Start applying". The script itself additionally stays
      // completely passive until the background sends it a targeted
      // ARM_EXTERNAL_APPLY message for that exact tab, so it never runs on
      // a page the user just happens to be browsing.
      matches: ["<all_urls>"],
      js: ["src/content/external-apply.ts"],
      run_at: "document_idle",
    },
  ],
  // "tabs" lets the background worker reliably notice the new tab a
  // LinkedIn "Apply" click opens and read its load-completion status.
  permissions: ["storage", "notifications", "alarms", "tabs"],
  host_permissions: ["https://www.linkedin.com/*"],
  // Two different runtime-requested grants, both via chrome.permissions.request():
  // (1) the dashboard's own origin (requested when the user saves it in
  //     Options) so the background worker can call its /api/*.
  // (2) all-sites access (requested when the user clicks "Start applying",
  //     a user gesture) so external-apply.ts is allowed to run on whatever
  //     off-platform ATS domain a job happens to redirect to.
  optional_host_permissions: ["*://*/*"],
});
