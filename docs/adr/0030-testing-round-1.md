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

## D. More guests than seats

**Decision.**

- Opening a table for more guests than its seats asks first, on the POS, the manager's Take order
  screen and the waiter app: "Table 3 seats 4. Open it for 5 guests anyway?" with **Yes, open it**
  and **Change**. The wording comes from one place (`@rp/ordering` `coversWarning`).
- The server accepts any whole number from 1 to `MAX_COVERS` (99, `@rp/contracts`) and refuses 0,
  negative, fractional or larger numbers with `VALIDATION_FAILED`, as before. It does not check the
  seats itself: the person confirmed on their screen. This is decision D-35.
- No screen changes the guests of a table already open, so there is nothing to warn about there.
  Merging two tables adds their guests together without asking, as before.

## F. The waiter asks for the bill

**Decision.**

- A waiter's table shows **Request bill for this table** while it is occupied, on the waiter app
  and on the POS order screen. On the POS order screen it replaces the **Bill** button, which only
  people who print bills and take payment may open: a waiter used to tap it and be refused.
- Once asked, the table shows "Bill requested at 21:42" and offers nothing more. A second request
  (another phone, a slow tap) is answered with the same request, without a second alert. Before,
  the server refused it as an invalid move (`INVALID_TRANSITION`).
- The time is kept on the table session (`table_sessions.bill_requested_at`, migration
  `20261114100000_bill_requested_at`) and shown in the overview as `session.billRequestedAt` while
  the table waits for its bill. Ordering more puts the table back to Occupied, which hides it.
- When the bill is printed the waiter's table says **Bill printed** (a manager signed in on a
  phone sees **Take payment** instead).

**The sweep for other refused buttons.** Every call the waiter app, the kitchen display and the
manager dashboard make was checked against what each role may do (BRD §4.2 with ADR-0023 and this
ADR). What was found and changed:

| Screen           | Button            | Was                                          | Now                                        |
| ---------------- | ----------------- | -------------------------------------------- | ------------------------------------------ |
| POS order screen | Bill (waiter)     | Refused: waiters may not open bills          | Request bill for this table                |
| Kitchen display  | Menu availability | Refused when `stock.kitchenMayManage` is off | Hidden then (`KdsSettings.mayManageStock`) |

Everything else was already shown only to people allowed to use it: the waiter app's Take payment
and Print bill, the alert centre's Approve, Reject and Nudge, and the Owner-only parts of the
dashboard (tax groups, invoice series, backups and restore, data export, the licence). A manager's
approval on a waiter's phone (voiding a dish) is asked for on the phone, as designed.

## E. Takeaway is taken by waiters

**Was.** A waiter could send a takeaway order from the phone (WTR-013), but its bill could only be
started at the POS, and the "food ready" alert for a takeaway went to the expo, not to the waiter
who took the order. Managers could also make takeaway orders from their screens.

**Now.**

- The waiter takes the order on the phone: the customer's name and phone (both optional), the
  dishes, **Send to kitchen**. The order gets the day's next takeaway number (TBL-008).
- The kitchen display shows `TAKEAWAY #12` where a table would be, and so does the printed KOT.
  The app and the dashboard call it "Takeaway #12".
- When a dish of a takeaway order is ready, the alert **Takeaway ready** (`TAKEAWAY_READY`, rule
  `KOT_SENDER` on pager and phone) goes to the waiter who sent the KOT, with the pager text
  `TAKEAWAY #12 READY`. It clears when nothing in the order is still waiting at the pass.
- Each open takeaway order on the phone has **Request bill**. It records when it was asked
  (`orders.bill_requested_at`, `POST /api/v1/orders/:orderId/request-bill`, capability
  `BILL_REQUEST`) and tells the managers (`BILL_REQUEST`, as for a table). Asking again changes
  nothing. The order then shows "Bill requested at 14:05" and appears in the manager's **Pending
  bills** (item A). Printing the bill clears the alert.
- Taking a takeaway order is the waiter's job: the phone offers **New takeaway** only to a
  waiter, and the manager dashboard has no takeaway screen (item A). Takeaway orders from the
  QR menu are not affected.

**Changed tests.** Tests that read "Token 7" now read "Takeaway #7" (or `TAKEAWAY #7` on the
kitchen display), because this brief renames it.
