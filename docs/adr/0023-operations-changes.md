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

### Part 2: out of stock, live (MENU-006)

- Kitchen staff and managers have a Menu availability screen (KDS: "Menu availability" in the
  header; dashboard: Menu availability): search, category filter, one big "Out of stock" /
  "Mark as available" switch per dish, and the portions-left count kept. Every change is audited
  (`ITEM_AVAILABILITY_CHANGED`) and reaches every device at once (`ItemAvailabilityChanged`).
- Sold out and switched off both read "Out of stock" on the POS, waiter app, tablet and QR menu,
  and a combo is out of stock when a fixed part is, or every choice of a part is
  (`@rp/ordering` `unavailableReason`). The server refuses the dish as `OUT_OF_STOCK` in new
  orders, combos, approvals and when firing held dishes, whatever the app sends.
- Every KOT records who sent it (`kots.sent_by_id`, migration `20261030110000_kot_sender`): the
  waiter of a staff order, the approver of a diner's order, whoever fired held dishes.
- Marking a dish out of stock (a person, not a count running out) carries `markedOutBy` on the
  event; `StockOutService` (orders) applies `@rp/domain` `planStockOut`: units on tickets the
  kitchen has not started are cancelled at no charge, reason "Out of stock", audited in the
  marker's name, with a CANCELLED slip; lines of a diner's order still waiting are rejected the
  same way (an order left with nothing waiting is rejected, clearing its approval alert); started,
  ready and served units are untouched; a combo is cancelled whole only while none of its parts has
  started (D-16). Each line gets one `OUT_OF_STOCK` alert (new event) to the KOT's sender
  (`KOT_SENDER`, new recipient kind; for a waiting order, every waiter on duty).

### Part 3: any waiter, any table (TBL-002, BRD §4.2 OWN grants)

- No waiter assignment: the Today's sections page, `/api/v1/waiter-assignments`, the domain's
  `floor.ts` (responsible waiters, day plans), "My tables" by assignment and the change-waiter
  route are gone. Sections stay as floor areas. Pagers stay assigned to a person (Staff → Pagers).
  Old `shift_assignments` rows stay as history; nothing writes them.
- Waiters have ALLOW where §4.2 said OWN: approving diners' orders, cancelling before
  preparation, moving and merging tables (with sending KOTs, firing held dishes and asking for
  the bill, which they had). No built-in role has an OWN grant any more; OWN stays in the model.
  A void after cooking started still needs a manager's PIN. Every action records who did it.
- A table session's `waiterId` records who opened it (shown as "Opened by"); the open-table
  request takes covers only. Any waiter may print a table's bill when `bills.waiterMayPrint` is
  on.
- Alerts: the recipient kinds `RESPONSIBLE_WAITER` and `SECTION_WAITERS` are gone; `ALL_WAITERS`
  means every waiter on duty (D-17), not on break; the managers are called at once when none is
  there or none has a pager or app connected (NTF-007), but not because the asker is the only
  one. Approvals, water, waiter call and food ready go to all waiters on duty; a bill request to
  all waiters and the managers on duty (D-19). Migration `20261030120000_any_waiter_any_table`
  rewrites stored rules that named the old kinds.
- The waiter app's home shows every table by floor area with a filter "Tables I sent KOTs to
  today" (`GET /api/v1/tables/my-kots-today`, from `kots.sent_by_id` and the business day).

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
- Stock is per dish, not per size (D-15): marking a dish out takes off every size.
