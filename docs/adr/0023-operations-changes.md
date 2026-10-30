# ADR-0023: Operations changes: no cashier, live stock, any waiter on any table, per-line alerts

Status: Accepted
Date: 2026-10-30
Work package: none (operations changes the Business Owner asked for on 2026-10-30, branch
`feature/ops-changes`)
Requirements: AUTH-010, AUTH-011, AUTH-012, BILL-005, BILL-010, BILL-015, MENU-006, NTF-002,
NTF-003, NTF-005, TBL-002, KDS-006, ORD-011, AUD-001, AUD-006

## Context

The Business Owner changed several business rules of the signed-off BRD at once. Each part below
changes a rule of the BRD; an ADR records it because CLAUDE.md lets an ADR override the BRD's
technology choices, and the owner asked for one record of these rule changes. Where a corner case
needed a business choice, the safest behaviour was built and the choice is in
`docs/testing/DECISIONS_NEEDED.md` (D-13 onwards).

## Decision

### Part 1: no cashier role (BRD §4.2 roles, Appendix C)

- The built-in roles are Owner, Manager, Waiter and Kitchen (`@rp/domain` `ROLES`). Managers
  already held every cashier capability; managers and the Owner bill, take payments, run cash
  shifts and the drawer from the POS. The §4.2 matrix loses its cashier column.
- Custom roles build on the waiter or kitchen role only (`CUSTOM_ROLE_BASES`).
- Discounts (BILL-005): the Owner, managers and anyone allowed `DISCOUNT_ABOVE_LIMIT` give any
  discount; a custom role allowed `DISCOUNT_WITHIN_LIMIT` gives up to `billing.discountLimitBp`
  (was `billing.cashierDiscountLimitBp`, same default 10 %) and above it with a manager's PIN.
- Alerts that went to the cashier go to the managers on duty: a bill request names
  `RESPONSIBLE_WAITER` and `MANAGERS_ON_DUTY`; "printer offline" names the managers on duty. The
  recipient kind `CASHIER` is gone.
- Migration `20261030100000_no_cashier_role`: everyone on the built-in Cashier role becomes a
  Manager and signs in again; custom roles on the cashier move to the waiter base (D-13) and their
  people sign in again; the built-in Cashier role is archived; the two settings follow; the
  `StaffRole` type loses `CASHIER`. The audit chain's hashes are computed by the server, so the
  migration queues one entry per change in `pending_audit_entries` and `PendingAuditService`
  writes them into the chain at start-up (no actor: the system did it).
- The development seed has no cashier: PIN 3333 is a second manager, "Neha (Manager)".

## Alternatives considered

- Keep CASHIER in the database type and only stop offering it: rejected, the role would linger in
  every enum and API and could come back through a stored setting.
- Delete the built-in Cashier role row: rejected, master data is archived, never deleted.
- Write the audit entries in SQL: the hash chain (AUD-002) is computed in the server with
  canonical JSON; reproducing it in PL/pgSQL would be a second implementation to keep identical.

## Consequences

- A restaurant that had cashiers now has more managers: they can open the dashboard, edit the
  menu and manage waiters. The Owner should review them after the update (D-13 asks).
- The OWN grant stays in the permission model for custom rules, but no built-in role uses it for
  shifts or reports any more.
