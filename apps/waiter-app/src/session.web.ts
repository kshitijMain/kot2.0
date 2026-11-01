import { createTranslator } from '@rp/i18n';
import {
  type ApkUpdater,
  createDeviceErrorReporting,
  DeviceSession,
  type OtaUpdater,
} from '@rp/mobile-core';
import {
  BrowserDatabase,
  browserAlertEnvironment,
  IndexedDbStore,
  WebAlertNotifier,
  WebCryptoDeviceKeys,
  WebStorageStore,
} from '@rp/mobile-core/web';
import Constants from 'expo-constants';
import { alertNotificationText } from './notifications';
import type { RestaurantPc } from './session';

/*
 * The waiter app in a phone's browser (P9-28): the same screens as the Android app, served by the
 * restaurant PC at /phone/ for iPhones, whose browsers all run on WebKit, and any phone without the
 * app. What the APK gets from its native modules comes from the browser here (session.ts is the
 * Android wiring; Metro picks this file for the web build).
 */

/** Where the PC serves the phone web app; the service worker's scope. */
export const PHONE_PATH = '/phone/';

export const translator = createTranslator();

/**
 * The restaurant PC is the server that served this page: nothing to find, and its certificate is
 * the one the phone already trusts to show the page at all (the browser checks it, not the app).
 */
export const restaurantPc: RestaurantPc = { servers: [globalThis.location.origin] };

/**
 * Alerts as the browser allows (WTR-005): a chime and vibration, a notification when the page is
 * not on screen (an iPhone shows them only for a page added to the Home Screen), and the screen
 * kept on while someone is signed in so the page keeps hearing the PC.
 */
export const notifier = new WebAlertNotifier(
  alertNotificationText(translator),
  browserAlertEnvironment({ serviceWorkerUrl: `${PHONE_PATH}sw.js`, scope: PHONE_PATH }),
);

/** The browser's storage: one IndexedDB for the device key and tokens, on this origin only. */
function createSession(): Promise<DeviceSession> {
  const database = new BrowserDatabase('rp-phone');
  const session = new DeviceSession({
    secureStore: new IndexedDbStore(database),
    plainStore: new WebStorageStore(globalThis.localStorage),
    keys: new WebCryptoDeviceKeys(database),
    // The phone alerts the person who last signed in on it, like their pager (WTR-006).
    followAlerts: true,
    alertNotifier: notifier,
    appKind: 'waiter-app',
    ...(Constants.expoConfig?.version !== undefined && {
      appVersion: Constants.expoConfig.version,
    }),
  });
  // NFR-O02: errors the page does not catch reach the vendor through the PC, scrubbed.
  const report = createDeviceErrorReporting(
    session,
    'waiter-app',
    Constants.expoConfig?.version ?? null,
  );
  globalThis.addEventListener('error', (event) => {
    report(event.error);
  });
  globalThis.addEventListener('unhandledrejection', (event) => {
    report(event.reason);
  });
  return Promise.resolve(session);
}

let created: Promise<DeviceSession> | undefined;

/** The page's one device session, created and started on first use. */
export function deviceSession(): Promise<DeviceSession> {
  created ??= createSession().then(
    (session) => {
      void session.start();
      return session;
    },
    (error: unknown) => {
      created = undefined;
      throw error;
    },
  );
  return created;
}

/** No over-the-air updates in a browser: the PC serves its newest build with every page load. */
export function appUpdater(): Promise<OtaUpdater> {
  return Promise.reject(new Error('A browser loads the newest app from the PC'));
}

/** No APKs in a browser. */
export function apkUpdater(): Promise<ApkUpdater> {
  return Promise.reject(new Error('A browser loads the newest app from the PC'));
}
