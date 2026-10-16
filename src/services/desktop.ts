// The desktop app (src-tauri, docs/desktop.md): the studio running in
// Tauri's window instead of a browser tab. Tauri puts its bridge on the page
// (window.__TAURI_INTERNALS__) before any of the app's code runs.

/** Whether the studio is running in the desktop app. */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
