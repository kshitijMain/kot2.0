# ADR-0026: The Owner signs in and acts by PIN only; no password or authenticator

Status: Accepted
Date: 2026-11-01
Work package: P9-25
Requirements: AUTH-006 (overridden), AUTH-001, AUTH-003, AUTH-012, MGR-004, ONB-004

## Context

AUTH-006 asked for the Owner to confirm a password and an authenticator code (or a recovery code)
before Owner-only actions: tax and invoice settings, data administration (restore, archive and
purge, exports, the uninstaller's data deletion), the licence, custom roles and creating or
removing managers. The local system built it as a 5-minute "step-up" on top of the Owner's PIN
session, with a Security page to set the password, enrol the authenticator and keep recovery codes.

On 2026-11-01 the Business Owner decided to drop it: the Owner signs in with their PIN like
everyone else, and that session is enough for everything only the Owner may do. This changes a
business rule of the signed-off BRD, so it is recorded here.

## Decision

- The local restaurant system has no Owner password, authenticator, recovery codes or step-up. The
  endpoints `owner-login`, `step-up`, `owner/totp/enroll`, `owner/totp/confirm`, `owner/security`
  and `owner/password` are gone, with their contracts, the console's Security page and its
  confirmation dialog, the `auth.stepUpMinutes` setting and the `SECOND_FACTOR_REQUIRED` error.
- Owner-only stays Owner-only. `OWNER_SECOND_FACTOR_CAPABILITIES` is renamed
  `OWNER_ONLY_CAPABILITIES` (DATA_ADMIN, LICENSE_MANAGE, TAX_AND_INVOICE_SETTINGS): granted to the
  Owner alone by the §4.2 matrix and never grantable to a custom role. Creating, promoting,
  demoting, deactivating or reactivating a manager, and managing custom roles, are the Owner's
  alone (`decideStaffChange`, `RolesService`). A manager is refused all of them.
- The first-run setup's "Owner and managers" step is done when there is at least one manager.
- The database keeps its columns and tables (`credentials` of kind PASSWORD and TOTP,
  `recovery_codes`, `sessions.second_factor_at`); nothing writes or reads them any more. No
  migration.
- The vendor Control Plane's own staff sign-in and step-up (VCP-001) are a different thing and
  stay as they are; `@rp/totp` remains for it.

## Alternatives considered

- Keep the step-up behind a setting, off by default: more code and screens to keep working for a
  rule the Business Owner removed; rejected.
- Ask for the Owner's PIN again before Owner-only actions: the Business Owner asked for no extra
  prompt; the signed-in Owner is already identified by their PIN on a paired device.

## Consequences

- Someone who learns the Owner's PIN can act as the Owner (threat PC-E4, now Accepted). The PIN
  lockout (5 tries, also counted per device, with alerts), the optional 6-digit PIN
  (`auth.pinLength`) and the audit trail of every Owner action limit and expose it.
- Simpler sign-in and fewer screens; the Owner-only checks are pure role checks on the server.
- To bring a second factor back, a new ADR would add a step-up again; the unused columns are still
  there.
