# ADR-0025: PIN-only sign-in for pilots and trials

Status: Accepted
Date: 2026-10-31
Work package: P9-14
Requirements: AUTH-007, AUTH-005, AUTH-001, AUTH-003, AUTH-010

## Context

AUTH-007 requires every device to be paired by a manager before it talks to the server: the
manager makes a one-time code on a screen that is already paired, and the new device presents
it. On a real installation that is right: a device is trusted, then a person signs in on it.

The Mannat pilot runs on one Mac with browsers opening and closing all day (a POS window, an
Incognito kitchen screen, a phone). Every new browser landed on `/pair` and needed a code from
another, already paired screen. That blocked the owner from testing at all. The kitchen also ran in
station mode (AUTH-005), so the Kitchen PIN 6666 could not be used.

## Decision

An installation flag `RP_AUTH_PIN_ONLY` (off by default):

- **The flag is off by default.** Nothing changes: the bootstrap code is still only for the server
  PC while no device is paired, and pairing works as AUTH-007 says.
- **With the flag on, browsers pair themselves.** `POST /api/v1/devices/pairing-codes/bootstrap`
  gives a code to any client on the restaurant's network:
  - loopback, RFC 1918, link-local or IPv6 unique-local, never a public address;
  - at most 5 a minute per address;
  - whether or not devices are paired already.

  The code pairs a POS device named "Browser N" through the usual `POST /devices/pair` (a
  device key, the proof, an audited DEVICE_PAIRED).

- **The console learns the mode from `GET /api/v1/first-run`** (`pinOnly: true`). With no stored
  device, it pairs itself with that code and goes to `/login`; the pairing screen remains only as
  a fallback if that fails.
- **Kitchen staff sign in with their PIN** (`auth.kitchenIndividualLogins` is treated as on). A
  kitchen person on `/kds` sees every station.
- **The pilot turns it on.** `scripts/pilot/mannat-local.sh` writes `RP_AUTH_PIN_ONLY=1`;
  `mannat-ngrok.sh` adds it to a pilot set up earlier; the Mannat seed sets
  `auth.kitchenIndividualLogins`.

What stays:

- **Every session is a person with a PIN.** Lockouts apply per credential (AUTH-003), so a new
  browser does not get fresh attempts at someone's PIN.
- **The server checks every call** (AUTH-010).
- **Devices can be unpaired** from Manage → Devices.

## Alternatives considered

- **Remove pairing.** That breaks AUTH-007 for real installations and loses device-bound tokens
  and per-device revocation.
- **A new auto-register endpoint.** It would duplicate the bootstrap code and pairing; reusing them
  keeps one audited path for devices to come in.
- **A setting in the registry instead of an environment flag.** A setting can be switched from the
  dashboard. Dropping device trust should take access to the PC, not a manager's click; the flag
  sits with the other installation flags.

## Consequences

- **On the restaurant's network, the PIN becomes the only factor**, and anyone there can create
  devices (rate-limited). This is acceptable for a pilot or trial on a private network. A real
  installation must not set the flag. The kitchen screen in station mode, binding devices to
  tables or staff, and waiter-phone limits are lost for browsers paired this way.
- **Devices pile up.** Each browser profile (or cleared storage) becomes a new "Browser N" POS
  device; unpair old ones from Manage → Devices.
- **Mobile apps still pair as before.** The waiter app and table tablet still pair with a code;
  extending PIN-only to them is a follow-up if a pilot needs it.
- **To revisit before a paying restaurant:** remove the flag from its environment, pair its
  screens as AUTH-007 says, and turn kitchen station mode back on if wanted.
