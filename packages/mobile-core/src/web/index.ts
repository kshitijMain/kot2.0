/**
 * The waiter app in a phone's browser (P9-28): what the Android app gets from its native modules,
 * from the browser instead. For iPhones, whose browsers all run on WebKit, and any phone without
 * the app.
 */
export { BrowserDatabase } from './browser-database.js';
export {
  browserAlertEnvironment,
  OPEN_TABLE_MESSAGE,
  TABLE_PARAMETER,
  WORKER_POLICY,
} from './browser-environment.js';
export { IndexedDbStore, WebCryptoDeviceKeys, WebStorageStore } from './browser-stores.js';
export {
  type WebAlertEnvironment,
  WebAlertNotifier,
  type WebAlertText,
  type WebNotificationState,
} from './web-alerts.js';
