# @rp/mobile-native

The Android pieces shared by the waiter app and the table tablet (P2-01c, P2-01d, P2-06b):

- `RpDeviceKeyModule.kt`, a local Expo module (autolinked through `expo-module.config.json`): the
  device key is an ECDSA P-256 key created inside the Android Keystore (StrongBox when the phone
  has it) and never leaves it (AUTH-007, SEC-006, SEC-010). JavaScript sees only the public key
  and signatures.
- `KeystoreDeviceKeys`: that key as `@rp/api-client`'s `DeviceKey`. Android signs in DER; the
  server verifies raw `r‖s` (as WebCrypto gives), so `derToRawEcdsa` converts.
- `LanTrust.kt` with `RpLanTrustModule.kt` and `RpLanTrustPackage.kt` (P2-01d, ADR-0011, SEC-010):
  the restaurant's LAN CA pinned at pairing. `RpLanTrustPackage` installs it as the application
  starts, before React Native's first request: Expo's `fetch` and images take their OkHttp client
  from `OkHttpClientProvider`'s factory, XHR and WebSocket (Socket.io) apply the custom client
  builders, and all of them check TLS with one trust manager. For the paired server's host only
  the pinned CA is trusted (a user-installed or public CA cannot stand in); other hosts keep the
  phone's trust store, which development tools need. The pin lives in the app's private
  preferences; a pin that cannot be read trusts nothing for that host. `fetchAuthority` downloads
  `GET /api/v1/tls/ca` with a client that checks no certificate, because nothing is trusted yet:
  it never carries credentials, and the CA it returns is pinned only once its fingerprint,
  computed on the device, matches the QR code or a person has compared it.
- `AndroidServerTrust`: that module as `@rp/mobile-core`'s `ServerTrust`. The pin is bound to
  the PC's host; when the PC gets a new address (P9-27), `DeviceSession` downloads the CA there,
  and re-pins it for the new host only when its fingerprint is the one already trusted.
- Finding the restaurant PC and a Wi-Fi without internet (P9-27, AUTH-007, NFR-A01):
  - `RpLanDiscoveryModule.kt` and `AndroidLanDiscovery`: Android's `NsdManager` browses
    `_parossa-pos._tcp` (`MDNS_SERVICE_TYPE` in `@rp/contracts`) while a Wi-Fi `MulticastLock` is
    held, resolves each answer one at a time (IPv4 only) and stops after the timeout (4 s) or
    0.6 s after the last answer. It returns `{ name, host, port, txt }`; `@rp/mobile-core` keeps
    only answers whose `ca` TXT record is the CA it trusts and still checks the certificate.
  - `WifiRoute.kt`, `RpWifiRouteModule.kt` and `AndroidWifiRoute`: `requestNetwork` for Wi-Fi
    without requiring INTERNET. While that Wi-Fi lacks `NET_CAPABILITY_VALIDATED` and the PC
    accepts a TCP connection through it (or no PC address is known yet), the app's process is
    bound to it (`bindProcessToNetwork`): the app reaches the PC over Wi-Fi while the rest of the
    phone uses mobile data. It is unbound when the Wi-Fi has internet or goes away; `onChange`
    tells JavaScript `wifiWithoutInternet`, which the connect screen turns into a hint.
  - Permissions: `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, `CHANGE_NETWORK_STATE`
    (and `ACCESS_NETWORK_STATE`), in the library's manifest.
- `secureStore()`: `expo-secure-store` (values encrypted with a Keystore key) for credentials.
- `plainStore()`: AsyncStorage for the outbox, the menu cache and the server address.
- `installRandomValues()`: gives Hermes the `crypto.getRandomValues` that `@rp/api-client` builds
  correlation ids and idempotency keys from (ORD-013), from `expo-crypto` (Android
  `SecureRandom`). Each app calls it before creating the device session (P2-02b).
- The waiter phone's background alerts (P2-06b, WTR-005):
  - `RpAlertService.kt`: a foreground service of Android 14's `specialUse` type (a `dataSync`
    service is stopped after 6 hours) that runs while the phone has a holder. It keeps the process,
    and in Doze its network, and runs the headless JavaScript task `RpAlertKeepAlive`, which never
    finishes by itself: while a headless task runs, React Native keeps JavaScript timers going
    with no screen (Socket.io's heartbeats and reconnects), and `HeadlessJsTaskService` holds a
    partial wake lock. Only `stop` ends it. `START_STICKY`: if Android stops the process, the
    service comes back with the saved words and the task starts JavaScript and the device session
    again; a restart Android refuses in the background just ends it.
  - `AlertNotifications.kt`: the high-importance alerts channel (sound, vibration, lock screen)
    and the silent channel of the service's own notification ("Alerts for Ravi"). Each alert is a
    notification, with the app on screen too: it pops up and goes, tagged with its id and posted
    again on each repeat, which alerts again. Nobody acknowledges it (2026-10-25): it stays in the
    shade until its cause is dealt with, and a tap opens the app at its table and takes it off the
    shade. With notifications off the phone only rings and vibrates as the ringer mode allows.
  - `RpAlertsModule.kt`: `start` and `stop` the service, `announce` and `dismiss` alerts, the
    table a tapped notification asks for (`onOpenTable` while the app runs, `takeOpenedTable` when
    the tap started it), and `POST_NOTIFICATIONS` (Android 13 and later): whether notifications
    can show, asking for them, and opening their settings.
  - `AndroidAlertNotifier`: that module as `@rp/mobile-core`'s `AlertNotifier`, with the words
    from the app's catalogue (`AlertNotificationText`), as `NotificationPermission` for the
    screens and as `AlertTableOpener` for the waiter app. `registerAlertKeepAlive` registers the
    keep-alive task where the app registers its root.
  - The library's manifest adds the service, the receivers and their permissions to both apps; the
    table tablet blocks the permissions in its app config, and the Android CI job checks both APKs.

- The table tablet's kiosk and health (P3-01b, TAB-001, TAB-015):
  - `RpKioskModule.kt`: lock-task mode, with what Android allows and the mode it is in; the screen
    kept on; battery, charging, network and Wi-Fi signal (no extra permission beyond the normal
    network state); and a tone on the alarm stream for "Locate".
  - As device owner, entering kiosk mode first allows its own package to lock, takes away the lock
    screen and the status bar, and keeps the screen on while plugged in.
  - `RpDeviceAdminReceiver.kt`: the device-admin component MDM (or `dpm set-device-owner`)
    activates. Only the system may bind it, and it uses no admin policies. It is in both apps'
    manifests and never activated on a waiter phone.
  - `AndroidKiosk`: that module as `@rp/mobile-core`'s `Kiosk` and `DeviceHealthSource`.

- `ExpoOtaUpdates` (P7-04e1, UPD-001, UPD-007): `expo-updates` as `@rp/mobile-core`'s
  `OtaUpdateSource`. It reads the client API an update was published with from its manifest
  (`extra.expoClient.extra.clientApi`), and says when a downloaded update failed to start.
  `expo-updates` checks each update's code signature against the certificate in the APK.
- The in-app APK updater (P7-04e2, WTR-001, UPD-007), a local Expo module:
  - `ApkInstalls.kt`: downloads the APK from the restaurant PC with the device's token over the
    pinned CA (`LanTrust`), keeps it only if its size, SHA-256, package and `versionName` are the
    expected ones, and hands it to Android's `PackageInstaller` (`REQUEST_INSTALL_PACKAGES`).
    Android installs it only over an app signed with the same key.
  - `RpApkInstallReceiver.kt`: Android's answer; it opens Android's confirmation on a phone and
    passes on a cancel or a refusal. `RpPackageReplacedReceiver.kt`: after the update a
    device-owner tablet opens the app again, in kiosk mode. Neither is exported.
  - `RpApkInstallerModule.kt` and `AndroidApkInstaller`: the app's own version, whether it owns
    its device, Android's "Install unknown apps" setting, as `@rp/mobile-core`'s `ApkInstaller`.

Tests run with Vitest and fake native modules; the Kotlin is compiled by the Android CI job.
Background alerts are checked on a phone or emulator with the waiter app's Maestro flow
`background-alert.yaml`; `docs/runbooks/waiter-phone.md` covers setting a phone up.
