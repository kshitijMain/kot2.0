# The waiter app in a phone's browser (iPhone, or any phone without the app)

Staff, managers and the Owner with an iPhone use the waiter app in the phone's browser (P9-28,
ADR-0028). It is the same app as the Android APK, served by the restaurant PC at
`https://<PC address>:8080/phone/`. Chrome or Safari both work. On an iPhone every browser runs on
Apple's engine, so they behave the same.

Manage → Devices on the PC shows the address and a QR code for it, under "iPhone, or a phone
without the app".

## Once per phone: trust the PC's certificate

The PC makes its own certificate (ADR-0011). Until the phone trusts it, the browser warns "not
private", and notifications cannot be turned on.

**iPhone** (use Safari for this step; Chrome on an iPhone cannot install certificates):

1. On the staff Wi-Fi, open Safari and go to `https://<PC address>:8080/ca.crt`. Safari warns
   first: tap **Show Details → visit this website**.
2. Tap **Allow** to download the configuration profile.
3. Open **Settings**. Tap **Profile Downloaded** (or Settings → General → VPN & Device Management),
   then **Install**, and enter the phone's passcode.
4. Open **Settings → General → About → Certificate Trust Settings** and turn on the switch for
   **Restaurant Operations Platform Local CA**.

**Android** (only for a phone without the APK): Settings → Security → Encryption & credentials →
Install a certificate → CA certificate. Choose the downloaded `ca.crt`. The names differ a little
between phone makers.

## Open the app

1. Scan the QR code in Manage → Devices with the camera, or type `https://<PC address>:8080/phone/`
   in Chrome or Safari.
2. The app connects to the PC by itself. Tap your name and enter your PIN.
3. To open it full screen like an app, add it to the Home Screen:
   - iPhone: **Share → Add to Home Screen**;
   - Android Chrome: **⋮ → Add to Home screen**.

Waiters, managers and the Owner can sign in; the kitchen stays at its screen. Managers and the
Owner have **Menu → Open the full dashboard** for reports, staff, menu and settings. It opens in
a new tab and asks for the PIN there.

## What works differently from the Android app

|                              | Android app                                                    | In the browser                                                                                                   |
| ---------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Alerts with the app open     | Ring, vibrate, notification                                    | Chime; vibration on Android only; notification when the page is in the background and notifications are on       |
| Alerts with the phone locked | Ring (alert service)                                           | **No.** The phone stops the page. The page keeps the screen on while someone is signed in; the pager still rings |
| Finding the PC               | By itself (mDNS), or the Connect QR                            | The link or its QR code                                                                                          |
| Wi-Fi without internet       | The app uses the Wi-Fi; the rest of the phone uses mobile data | The phone decides; use a staff Wi-Fi with internet (`restaurant-network.md`)                                     |
| Updates                      | From the PC (APK)                                              | Reloading the page loads the PC's newest version                                                                 |
| Back                         | Android's back button                                          | The browser's back, or a swipe from the left edge on an iPhone                                                   |

Keep the app in **one tab**. If it is opened again in another tab, the older tab steps aside and
offers "Use it here".

## If something is wrong

- **"Your connection is not private"**: the certificate is not trusted yet. Do the steps above.
  "Proceed" works for a test, but notifications will not.
- **The page says it is out of date**: tap **Reload**. The PC was updated while the page was
  open.
- **The PC's address changed** (no reserved address in the router): open the new address. The
  phone connects again as a new device; reserve the PC's address so it does not change
  (`restaurant-network.md`).
- **"Open in another tab"**: the app is open in another tab on this phone. Use that one, or tap
  **Use it here**.
