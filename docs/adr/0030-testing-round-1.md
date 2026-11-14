# ADR-0030: Fixes from testing, round 1 (dashboard, sign-in, waiter app)

Status: Accepted
Date: 2026-11-14
Work package: none (fixes from the Business Owner's testing, branch `fix/testing-round-1`)
Requirements: AUTH-005, AUTH-010, MGR-001, KDS-001, TBL-003, TBL-008, WTR-008, WTR-013, BILL-001

## Context

The Business Owner tested the pilot and asked for a set of changes to who does what and how
sign-in behaves. Several change rules the BRD and earlier ADRs set, so they are recorded here. Each
section names the item of the brief it comes from.

## B. No automatic sign-out

**Before.** AUTH-005 signed a person out after 10 idle minutes on the POS and waiter phones and 30
on manager browsers (`auth.inactivityMinutes`, `auth.managerBrowserInactivityMinutes`), with a
countdown on the console. Every session also ended after 16 hours (`auth.sessionMaxHours`).

**Decision.**

- Nobody is signed out for being idle, on the manager dashboard, the kitchen display or the waiter
  app. The two inactivity settings, their help text and the console's countdown are gone.
- A session ends when the person signs out, when they are deactivated, when their device is
  unpaired and when their PIN changes, as before.
- `auth.sessionMaxHours` stays, for a restaurant that wants everyone to sign in again each day,
  but its default is now **0: no limit**. Its range is 0 to 24 hours.
- **Sign out** is always in view: in the console's header, as before, and now on the waiter app's
  home screen instead of behind its Menu.
- `LoginResponse.session.inactivityTimeoutSeconds` and the `x-rp-idle-seconds` header stay in the
  API so apps already installed keep working. The server now sends 20 days, under the 24.8 days a
  32-bit timer can hold, and ignores idle time.

**Consequences.** A phone or browser left signed in stays usable by whoever picks it up until
someone signs out. Restaurants that worry about this can set a session length or lock the device.
This is decision D-34.
