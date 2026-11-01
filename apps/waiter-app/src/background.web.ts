/**
 * A browser has no background service (P9-28): the page listens while it is open, with the screen
 * kept on while someone is signed in (`WebAlertNotifier`).
 */
export function registerBackgroundTasks(): void {
  // Nothing to register in a browser.
}
