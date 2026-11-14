# ADR-0028: The waiter app in phones' browsers, from the same code

Status: Accepted
Date: 2026-11-01
Work package: P9-28
Requirements: WTR-001, WTR-002, WTR-003, WTR-005, WTR-006, MGR-001, AUTH-005, AUTH-007, SEC-017, NFR-A01

## Context

The waiter app is an Android app (React Native with Expo). Staff, managers and the Owner who
carry an iPhone have no app. The Business Owner asked (2026-11-01) that they get every function
the APK has, for waiters, managers and the Owner, from a link in their phone's browser. They
will use Chrome on the iPhone.

Every iPhone browser, Chrome included, runs on Apple's WebKit (outside the EU). So "Chrome on an
iPhone" behaves as Safari does: what a page may do there is what Safari allows.

We considered two ways:

1. **Write the phone screens again for the web console** (React DOM, `@rp/ui-web`). The console
   already fits a phone for Manage, but the waiter's working screens (tables, ordering, the
   kitchen's progress, requests, approvals, payment, move, takeaway, break, pager) exist only in
   the APK. Writing them twice means two copies that drift apart with every change.
2. **Build the APK's own screens for the browser** with React Native Web (`react-native-web`,
   Expo's web export). Same components, same logic, same strings. What the APK takes from Android
   (Keystore keys, mDNS, the alert service, the Wi-Fi binding) comes from the browser instead.

## Decision

The second. `apps/waiter-app` builds for the web as well (`pnpm --filter @rp/waiter-app build`,
`expo export --platform web` into `dist/`). The restaurant PC serves it at `/phone/`
(`RP_PHONE_DIR`, `phoneMiddleware`), on the same origin as the API and the socket. The installer
puts it at `<install>\phone\`.

- **One codebase.** Only the wiring differs: `session.web.ts` (Metro picks it for the web)
  against `session.ts`, plus `background.web.ts`, `web-setup.web.ts` and `OneTab.web.tsx`.
- **The browser's parts** are in `@rp/mobile-core/web`:
  - `WebCryptoDeviceKeys`: the device key is a WebCrypto ECDSA P-256 pair whose private half
    cannot be exported, kept in IndexedDB. This is how the web console keeps its key.
  - `IndexedDbStore` holds the tokens; `WebStorageStore` holds the address and the resume point.
  - `WebAlertNotifier` handles alerts. Each alert plays a chime and vibrates where the browser
    can (Android's Chrome; never an iPhone). It also shows a notification through the service
    worker when the page is not on screen and the person has allowed notifications. The screen
    is kept on (Screen Wake Lock) while someone is signed in.
- **The PC is the server that served the page**, so there is nothing to find or scan. The
  browser, not the app, checks the PC's certificate, so each phone trusts the PC's CA once
  (`docs/runbooks/phone-web-app.md`).
- **The Owner signs in on a phone** (`SIGN_IN_ROLES.WAITER_PHONE` now includes `OWNER`), with what
  a manager has there. For managers and the Owner, "Open the full dashboard" opens the console in
  a new tab.
- **Browser back** (the iPhone's swipe, Android's back) does what Android's back button does in
  the app: it closes the newest screen. While a screen handles back, the app keeps one history
  entry of its own in front of the page (`onBackPress`).
- **One tab at a time.** The newest tab takes over (BroadcastChannel). Two tabs would be one
  device twice, each with its own connection and its own token refreshes.

### The page's security headers

They are the console's (SEC-017), with two changes:

- `style-src 'self' 'unsafe-inline'`. React Native Web writes the app's styles into a style sheet
  at run time. This allows styles only: scripts remain this server's own files, with no inline
  script and no eval.
- `trusted-types rp-phone-worker` instead of `'none'`. Registering the service worker passes a
  script URL to a Trusted Types sink. The one policy lets through exactly `/phone/sw.js`.

Zod runs jitless, as in the console, so no eval is attempted.

## Consequences

- An iPhone gets every screen and function of the APK in Chrome or Safari. A change to a screen
  reaches both at once. CI runs the phone e2e on WebKit at iPhone size and on Chrome at Android
  size (`apps/console/e2e/phone.e2e.ts`).
- **What a browser cannot do** (Business Owner told):
  - **Alerts with the phone locked or the page closed.** An iPhone stops a page's scripts when the
    screen locks or the page goes to the background, so nothing can ring. The page keeps the screen
    on while someone is signed in. With the page open, alerts ring and show as they do in the app;
    the pager still rings as ever.
  - Web Push could wake a locked iPhone. It goes through Apple's servers, so it needs the internet
    and a push service of the vendor's, against NFR-A01 for an in-restaurant alert. It is not
    built; it is a later choice for the Business Owner.
  - No vibration on an iPhone.
  - No finding the PC by mDNS: the link (or its QR code in Manage → Devices) is how a phone gets
    there.
  - No binding to a Wi-Fi without internet: the phone's own settings decide.
- **Storage belongs to the address.** A phone that opens the PC at a new address is a new device.
  It connects by itself again in PIN-only mode. A reserved address, or the PC's `.local` name
  where the certificate covers it, keeps it the same.
- **The certificate.** Until a phone trusts the PC's CA, the browser warns. The page works after
  "Proceed", but service workers (notifications) refuse an untrusted certificate. The runbook
  installs the CA once per phone.
