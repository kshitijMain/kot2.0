# QA and hardening plan (the tracker)

This page tracks the QA and hardening audit of the whole system: for each part of the product and
each kind of risk, what tests already existed, what the audit adds, and how far it has got. The
findings themselves are in [QA_REPORT.md](QA_REPORT.md), the business decisions waiting for the
owner are in [DECISIONS_NEEDED.md](DECISIONS_NEEDED.md), and what only a person with real devices
can check is in [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md).

Branch: `qa/hardening` (local only; nothing pushed). Started 2026-10-27.

Status words: **todo** (not started), **in progress**, **done** (tested; findings recorded and the
Critical and High ones fixed), **n/a** (does not apply to this part).

## Resume here

> Session 1 (2026-10-27/28): plan written; Area 1 (server) nearly done: 21 findings, all fixed
> (QA_REPORT.md), 12 business decisions written (DECISIONS_NEEDED.md), the manual checklist
> started. Error boundaries were added to every app (part of Areas 2 to 7, category A).
>
> Resume with, in this order:
>
> 1. Area 1 leftovers (Medium/Low, listed, not yet tested): deadlock between a QR order's approval
>    and a staff order on the same table and dish; photo processing memory (three decodes at once,
>    four photos at once); a session's table re-checked after its lock; a second "original" bill
>    after a restart mid-print; the Control Plane taking "today" in UTC; override used up when the
>    action then fails; the unkeyed audit hash; Hindi photo names lost in a menu-file round trip;
>    menu-file photo names with "._" or a backslash; `wrap()` with width 0; unbounded update-agent
>    strings; recommendation rule ids taken from the client.
> 2. Area 1 category F on the server: mutation check of orders, billing, payments and auth (the
>    domain is done: 12 of 12 planted bugs caught).
> 3. Areas 2 to 7 in order, starting with the waiter app's bad answers, timeouts and lost network.
>
> Note for this machine (4.9 GB): the repo-wide `pnpm lint` runs out of memory; lint changed files
> with `node --max-old-space-size=3000 node_modules/eslint/bin/eslint.js <files>`.

## Risk categories

| Code | Category                  | In plain words                                                                                      |
| ---- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| A    | Unexpected input          | Wrong, missing, huge or strange input never crashes anything and always gets a clear answer.        |
| B    | Loopholes and false data  | Nobody (a dishonest staff member or an outsider) can enter false prices, money, records or rights.  |
| C    | Races and timing          | Two people at once, midnight, 04:00, 31 March, leap day or a clock change never corrupt anything.   |
| D    | Money and tax correctness | Totals, GST, rounding, discounts, splits and reports always add up, checked on thousands of orders. |
| E    | Failure and recovery      | Database, disk, printer, internet or a phone failing never loses work, and things recover.          |
| F    | Test quality              | The tests themselves would notice if the code were wrong (coverage, mutation testing).              |

## Area 1: local server API and real-time events

| Cat | Already tested (before the audit)                                                                                                                                                                                                                         | Added or still missing                                                                                                                                                                                       | Status      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| A   | `errors.int` (contract rejection, malformed JSON, body size), `body-limits.int`, `flood.int`, `menu-files.int`, `menu-import.int`, `photos.int`, `menu-file-reader` and `escpos` unit tests, `csv.test`, `report-files.test`, `data-export.int`           | A generated fuzz test over every endpoint of the route registry; socket event fuzzing; control characters in ESC/POS output; zip and Excel attacks on the menu file; image attacks; export formula injection | done        |
| B   | `authorisation-sweep.int` (~3,500 refused calls), `auth-guard.int` (matrix row by row), object-level tests (`order-approvals`, `table-sessions`, `payments`, `reports`, `notifications`), `orders.int` (client prices rejected), `audit.int` (hash chain) | Attacker walk-through of prices, quantities, money, records, duplicates and sign-in against the server; gaps get tests                                                                                       | done        |
| C   | `lock-order.int`, `order-outbox.int`, `day-end.int`, `dates-and-invoices.test` (business date, financial year)                                                                                                                                            | Concurrent payment vs. add items, two devices on one bill, day-end with open orders, 04:00 cut-off, 31 March / 1 April, leap day, clock jumps, restart mid-payment                                           | mostly done |
| D   | `tax-and-bill.test`, `money.test`, `bill-split.test`, `payments.test`, `z-report.test`, `reports.test` (example-based)                                                                                                                                    | Property-based tests (fast-check): totals, CGST/SGST split, rounding, discounts, splits, day-end and report totals                                                                                           | done        |
| E   | `backups.int`, `restore.int`, `print-queue.int`, `printing.int`, `continuous-backup.int`, `load-rush.int`, `database.int`                                                                                                                                 | Database down mid-request, disk nearly full, printer offline during a rush, internet down                                                                                                                    | done        |
| F   | Coverage thresholds (domain ≥ 85 %, backend ≥ 70 %)                                                                                                                                                                                                       | Coverage per package; mutation testing of domain money/tax/bill and server orders, billing, payments and auth                                                                                                | in progress |

## Area 2: waiter app (with mobile-core, mobile-shell, ordering)

| Cat | Already tested                                                                                                                     | Added or still missing                                                                                | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| A   | `waiter-app/test/*` (app, orders, tables, serving, notifications), `mobile-shell` (pairing, shell), `mobile-core` (device session) | Error boundary (none existed); bad server answers, timeouts and lost network on each screen; odd text | todo   |
| B   | Server-side (Area 1); `ordering` cart logic                                                                                        | Stale cart after a price change; server checks on every action the phone offers                       | todo   |
| C   | `order-outbox.test` (mobile-core)                                                                                                  | App killed with an outbox, two phones on one table, resend after a long time offline                  | todo   |
| D   | `order-logic.test` (ordering)                                                                                                      | Cart estimate vs. server bill on random carts                                                         | todo   |
| E   | `order-outbox.test`, `device-session.test`                                                                                         | Long offline period then sync; server restart while the app is open                                   | todo   |
| F   | Jest suites                                                                                                                        | Coverage of mobile-core, mobile-shell, ordering                                                       | todo   |

## Area 3: kitchen display (console, KDS mode)

| Cat | Already tested                                      | Added or still missing                                                           | Status |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| A   | `kds-screen.test`, `kds-view.test`, `kds.int`       | Error boundary; long and odd dish names and notes on tickets; bad server answers | todo   |
| B   | `authorisation-sweep.int` (station mode), `kds.int` | A KDS acting on another station's tickets; billing from a KDS                    | todo   |
| C   | `kds.int`                                           | Two screens bumping one ticket; order voided while being cooked                  | todo   |
| D   | n/a                                                 |                                                                                  | n/a    |
| E   | `realtime.int`, `flood.int`                         | Socket drop and resync; server restart                                           | todo   |
| F   | Vitest                                              | Coverage of `kds/`                                                               | todo   |

## Area 4: billing / POS (console, POS mode; managers, ADR-0023)

| Cat | Already tested                                                              | Added or still missing                                                                                     | Status |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| A   | `order-entry.test`, `pos.test`, `billing-screens.test`, `console.e2e`       | Error boundary; bad answers on each screen                                                                 | todo   |
| B   | `billing.int`, `payments.int`, `bill-split.int`, `day-end.int`, `audit.int` | Over- and under-payment, double payment, refunds above paid, discount above limit, voids without approval  | todo   |
| C   | `lock-order.int`                                                            | Pay while a waiter adds items; two tills on one bill; day-end with open bills; invoice numbers at 31 March | todo   |
| D   | `billing-logic.test`, domain bill tests                                     | Property tests (Area 1 D) cover the shared logic                                                           | todo   |
| E   | `print-queue.int`                                                           | Printer offline at billing; restart mid-payment                                                            | todo   |
| F   | Vitest                                                                      | Coverage of `pos/`, `billing/`                                                                             | todo   |

## Area 5: manager dashboard (console, Manage)

| Cat | Already tested                                                                                                                           | Added or still missing                                                                            | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| A   | `menu-editor.test`, `menu-file.test`, `bulk-photos.test`, `staff.test`, `devices.test`, `settings.test`, `reports.test`, `menu-file.e2e` | Error boundary; odd text in dish names shown back; menu file attacks (Area 1 A); export injection | todo   |
| B   | `staff.int`, `roles.int`, `settings.int`, `menu-admin.int`                                                                               | Waiter changing prices; manager doing Owner-only things; settings out of range                    | todo   |
| C   | `menu-publish.int`                                                                                                                       | Menu published while carts are open; two managers editing one dish                                | todo   |
| D   | `reports.int`, `report-suite.int`                                                                                                        | Report totals equal invoices and payments (property test in Area 1 D)                             | todo   |
| E   | `backups.int`, `restore.int`                                                                                                             | Disk full during export or backup                                                                 | todo   |
| F   | Vitest                                                                                                                                   | Coverage of `manage/`                                                                             | todo   |

## Area 6: vendor cloud (control-plane and control-plane-web)

| Cat | Already tested                                                                                                                               | Added or still missing                                                         | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| A   | `request-limits.int`, `request-limits.test`, `error-mapping.test`                                                                            | Generated fuzz test over the Control Plane registry; vendor web error boundary | todo   |
| B   | `authorisation-sweep.int`, `tenant-isolation.int`, `signed-requests.int` (replay, window), `vendor-staff.int`, `step-up.int`, `licences.int` | Licence tampering, clock moved back, replayed signed requests (review gaps)    | todo   |
| C   | `rollouts.int`, `heartbeats.int`                                                                                                             | Concurrent licence changes                                                     | todo   |
| D   | `billing.int` (subscription)                                                                                                                 | Property tests on subscription billing                                         | todo   |
| E   | `cloud-backups.int`                                                                                                                          | Cloud down: the restaurant keeps working (Area 1 E)                            | todo   |
| F   | Vitest                                                                                                                                       | Coverage                                                                       | todo   |

## Area 7: table tablet and QR menu (if time allows)

| Cat | Already tested                                                                          | Added or still missing                                    | Status |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------ |
| A   | `table-tablet/test/*`, `qr-menu/test/*`, `infra/supabase/test/*`, DAST scans            | Error boundaries; odd text in dish names on the QR site   | todo   |
| B   | `tablet.int`, `tablet-session.int`, `devices.int` (own table), `isolation.test` (relay) | A tablet ordering for another table (covered; re-checked) | todo   |
| C-F | `relay-orders.int`, `relay-sync.int`                                                    | As time allows                                            | todo   |

## Out of scope (listed in the manual checklist instead)

Pager firmware, the Windows installer and service, real printers, real phones and tablets, kiosk
mode, Wi-Fi drops, camera QR scanning and real cloud hosting.
