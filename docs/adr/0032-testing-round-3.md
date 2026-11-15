# ADR-0032: Fixes from testing, round 3 (the waiter app can't connect)

Status: Accepted
Date: 2026-11-15
Work package: none (fixes from the Business Owner's testing, branch `fix/testing-round-1`)
Requirements: AUTH-007, SEC-010, NFR-A01

## Context

The waiter app on the Business Owner's phone (`parossa-waiter-preview.apk`, built with
`scripts/pilot/build-waiter-apk.sh`) could not connect to the laptop. On the same phone, Chrome
opened `https://<laptop Wi-Fi address>:8080` after a certificate warning. The server runs inside
WSL on Windows 10, and Windows forwards ports to it.

The brief listed the possible causes. Each one was checked against the code and the laptop's set-up
(`.pilot/`, the APK's built-in addresses and certificate fingerprint):

| Possible cause                                            | Found                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The APK has WSL's address (172.x) or an old Wi-Fi address | No: the APK of 10 November names `https://192.168.1.2:8080`, the laptop's Wi-Fi address.                  |
| The certificate changed since the APK was built           | No: the APK's fingerprint is the server's CA (`5D:FD:00:C2:…`).                                           |
| mDNS cannot cross WSL's network                           | True: "find the PC by itself" cannot work from WSL. The built-in address and the Connect QR are the ways. |
| The Connect QR shows WSL's internal addresses             | True: it listed `172.30.x` first. Fixed below.                                                            |
| Android's network security rules, or another port         | No: the app uses TLS (cleartext is off, as it should be) and port 8080, as the server.                    |
| **The certificate does not cover the Wi-Fi address**      | **Yes, the cause.** See below.                                                                            |
| Windows port forwarding missing (WSL changes address)     | Also true on the day it was checked: `doctor` said forwarding for 8080, 3100 and 8787 was missing.        |

## The cause

The server's certificate named the laptop's Wi-Fi address only as a DNS name (`DNS:192.168.1.2`).
Inside WSL the server could not see the Wi-Fi address itself, so it came from `RP_TLS_HOSTNAMES`,
and every extra host name went into the DNS names. Android checks an address against the
certificate's **IP** entries only. The app pins the restaurant's CA (so the certificate was
trusted) and then refused it for not naming the address. Chrome only warned, because it does not
trust the CA at all and lets the person carry on. The app said only "could not connect".

## Now

- **The certificate.** A configured host name that is an IPv4 address goes into the certificate's
  IP addresses (`localServerNames`). On the next start the server reissues its certificate with the
  same CA, so a phone that already trusts the CA needs nothing new.
- **WSL's addresses.** Under WSL (`runningInWsl`), when `RP_TLS_HOSTNAMES` names an address, the
  Connect QR and the advertised addresses list only the configured ones, never WSL's own
  (`lanAddresses` with `wsl`).
- **The build.** `build-waiter-apk.sh` builds for the remembered Wi-Fi address (`PILOT_IP`, then
  `.pilot/pilot-ip`). It refuses `127.x`, `localhost`, `172.16–31.x` (WSL's own) and `169.254.x`
  with a plain reason, and refuses to build when the running server's certificate does not cover
  the address, saying to run `parosaa-local.sh wifi`. It names the file
  `parosaa-waiter-preview.apk` and copies it to Windows Downloads (as before). The checks are
  `scripts/pilot/apk-checks.mjs`.
- **`doctor`.** A "The waiter app" section: does the certificate cover the Wi-Fi address; is the APK
  built for `https://<Wi-Fi>:8080` with no WSL or local address; does its certificate match the
  server's now. It also says that "find the PC by itself" (mDNS) cannot work from WSL.
- **The app says exactly what failed**, in plain words, and offers "Scan the code on the PC" and
  typing the address:
  - "Can't reach 192.168.1.2:8080 – check the Wi-Fi and port forwarding." (the connection was
    refused or the network unreachable);
  - "No answer from 192.168.1.2:8080 – check that the restaurant PC is on and its server is
    running." (timed out);
  - "This PC's security certificate does not cover 192.168.1.2:8080 – restart the server on the PC,
    then try again." (the new check through the pinned CA, `RpLanTrust.check`: the reason of this
    round);
  - "This PC's security certificate has changed – scan the Connect QR on the PC again." (the
    certificate is not the one the app was built with or trusted).
- **A changed certificate.** A paired phone whose PC answers at its address with another
  certificate (the PC was set up again) shows the connect screen with that message and only
  "Scan the code on the PC". Nothing found by itself, built in or typed replaces a certificate the
  phone trusts: only the fingerprint in the PC's own Connect QR code, scanned by a person (Manage →
  Devices, behind a manager's sign-in). A scanned code whose fingerprint the PC does not match is
  still refused with "This restaurant PC can't be verified".

## Consequences

- A phone that scans the Connect QR trusts a new certificate without uninstalling the app (before,
  the guide said to uninstall). Whoever can show a phone a QR code from Manage → Devices can do
  this; D-42 asks whether a manager's PIN should also be needed.
- `RpLanTrust.check` is new native code: an app installed before it does not check, and connects
  as before. The new messages need a rebuilt APK.
- mDNS stays unavailable from WSL; the pilot relies on the built-in address and the Connect QR.

## Changed tests

None weakened. `connect.test.tsx` in `mobile-shell` and `waiter-app` now stop every session they
start, so Jest exits after the run (it waited on the sessions' timers before this change too).
