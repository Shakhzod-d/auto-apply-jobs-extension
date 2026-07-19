// Indeed content script.
// Built out fully in the "Indeed content script" pass, on top of the shared
// field-matching/autofill engine (src/lib/autofill-engine.ts): extracts
// apply-form fields from the Indeed DOM and hands them to the shared engine
// for matching, filling, and pause-on-unknown handling.

console.log("[auto-apply-jobs] indeed content script loaded");
