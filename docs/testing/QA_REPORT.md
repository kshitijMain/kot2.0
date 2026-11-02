# QA and hardening report

Every problem the audit found, in plain words: how serious it is, how it was found, what was
fixed, and the test that now guards it. The tracker is [QA_PLAN.md](QA_PLAN.md); choices only the
owner can make are in [DECISIONS_NEEDED.md](DECISIONS_NEEDED.md).

**Severity:** **Critical**: money, data or security can be wrong or abused. **High**: a crash or
work that gets stuck. **Medium**: wrong but limited, or needs an unusual situation. **Low**: a
small flaw or a tidy-up.

**How found:** _fuzz_ = the generated test that sends hostile input to every endpoint; _review_ =
reading the code (often by an audit helper), then proved with a test that failed before the fix;
_race_ = a test that runs two actions at the same moment.

Every fix started with a test that failed, and the test now passes.

## Summary

| ID     | Severity | Area              | Problem                                                                                                                   | Status       |
| ------ | -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| QA-001 | Critical | Billing           | A flat (rupee) discount took nothing off the bill                                                                         | Fixed        |
| QA-002 | Critical | Orders / billing  | Dishes could be added, cancelled or voided after the bill was printed or paid                                             | Fixed        |
| QA-003 | High     | Server, phones    | A hidden NUL character in any text crashed the request (500)                                                              | Fixed        |
| QA-004 | Medium   | Server            | The date "0000-01-01" crashed the request (500)                                                                           | Fixed        |
| QA-005 | High     | Billing           | Payment taken while a bill was open for changes; part-paid bill could be reopened                                         | Fixed        |
| QA-006 | High     | Payments          | A payment and a void of the same bill at the same moment crashed one of them (500)                                        | Fixed        |
| QA-007 | High     | All apps          | A bug in one screen blanked the whole app (no error boundary)                                                             | Fixed        |
| QA-008 | Medium   | Phone, tablet     | If the app could not start, it showed a blank screen forever                                                              | Fixed        |
| QA-009 | Medium   | Phones            | One order the server keeps failing blocks every later order from that phone                                               | Fixed        |
| QA-010 | Critical | Day-end           | A payment or bill made while day-end runs could land on the closed day, outside its report                                | Fixed        |
| QA-011 | High     | Menu import       | A tiny Excel file could fill the memory and stop the whole server                                                         | Fixed        |
| QA-012 | Medium   | Billing           | Two tills opening the same bill at once: one got an error (500)                                                           | Fixed        |
| QA-013 | High     | Payments / shifts | Cash taken while the cashier's shift was being closed went into the closed shift                                          | Fixed        |
| QA-014 | Low      | Reports           | Feedback comments made in the same instant came out in a random order                                                     | Fixed        |
| QA-015 | Medium   | Menu / orders     | An add-on marked "not available" could still be ordered and charged                                                       | Fixed        |
| QA-016 | High     | Orders            | A dish taken off the menu could no longer be cancelled or reduced on an open order                                        | Fixed        |
| QA-017 | Medium   | Kitchen display   | A kitchen screen showing two stations could not mark the second station's dishes                                          | Fixed        |
| QA-018 | High     | Orders            | Any waiter could lower the dishes on another waiter's table, without a reason                                             | Fixed (D-3)  |
| QA-019 | Low      | Printing          | Curly quotes and dashes from phone keyboards printed as "?"                                                               | Fixed        |
| QA-020 | Low      | Billing           | A very large bill (about ₹9 lakh on one line) with a large discount could not be worked out                               | Fixed        |
| QA-021 | Medium   | Server            | A clash between two devices, a database outage or a value out of range answered "Something went wrong" (500)              | Fixed        |
| QA-022 | Critical | Billing           | Dishes ordered after the bill was printed could not be billed: no revised bill, and after payment they were never charged | Fixed        |
| QA-023 | High     | Manager dashboard | A table showing "Bill requested" offered no way to bill it from the dashboard; only the alert led there                   | Fixed        |
| QA-024 | High     | Tables            | A table that asked for the bill with nothing to bill could never be closed (blocking day-end)                             | Fixed (D-22) |
| QA-025 | High     | Orders / billing  | A diner's order placed after the bill was printed was left waiting for ever once the bill was paid                        | Fixed        |
| QA-026 | Critical | Billing           | Split bill: with one part voided and the other paid, the table closed and the voided part was never billed                | Fixed        |
| QA-027 | Critical | Waiter phone      | A takeaway sent again after its answer was lost (Wi-Fi) could be made twice                                               | Fixed        |
| QA-028 | Critical | Billing / tables  | A paid table's bill voided and printed again set the next guests' table to "Bill printed" (or failed for good)            | Fixed        |
| QA-029 | Medium   | Kitchen alerts    | A dish left at the pass for a table that had paid and left raised a "food waiting" alert nobody could clear               | Fixed        |
| QA-030 | Medium   | POS               | Closing the day had no confirmation; opening a shift from a payment lost the payment                                      | Fixed        |
| QA-031 | High     | Day-end           | Unpaid bills holding day-end up were listed as numbers only, with no way to open them                                     | Fixed        |
| QA-032 | Medium   | Takeaway          | Paid takeaway orders stayed in "Open takeaway orders" for good, with a "Bill" button                                      | Fixed (D-23) |
| QA-033 | High     | POS               | The POS could not cancel or void a dish already sent to the kitchen (only a waiter phone could)                           | Fixed        |
| QA-034 | High     | Day-end           | Another manager's shift left open blocked day-end, and nobody else could close it                                         | Fixed        |
| QA-035 | Medium   | POS / printing    | A kitchen ticket lost to a jammed or offline printer could not be printed again anywhere                                  | Fixed        |
| QA-036 | Low      | POS               | Merge and "Move dishes" were offered on a table whose bill was printed, then refused                                      | Fixed        |

## Findings

### QA-001 Critical: a flat discount took nothing off the bill

- **What happened:** a cashier or manager gave a ₹50 discount ("Flat") with a reason. The server
  recorded it, used up the manager's approval when one was needed, and wrote "discount applied" in
  the audit log, but the amount stored was ₹0, so the guest paid full price. Percentage discounts
  were not affected.
- **How found:** review, then a test.
- **Fix:** the amount given is now stored (`apps/server/src/billing/bills.service.ts`).
- **Guarded by:** `apps/server/test/integration/qa-money.int.test.ts`, "a flat discount takes its
  amount off the bill".

### QA-002 Critical: dishes changed after the bill was printed or paid

- **What happened:** after the bill was printed, or even after it was paid and the table closed, a
  waiter could raise a dish's quantity (say from 1 to 9). The kitchen got a slip for 9, stock went
  down, but the bill stayed at 1: food left the kitchen without being paid for. Cancelling or
  voiding a dish on a printed bill also went through, so stock came back and the reports stopped
  matching the bill. A change made at the very moment the bill was printed could also be left off
  it.
- **How found:** review (two separate audit helpers found it), then a test.
- **Fix:** a dish on a printed bill can now only be changed through **Edit bill** (reopen, change,
  print again), as the product already intends. Otherwise the server refuses with "… is on a
  printed bill. Use Edit bill to change it." The server also takes the table's lock first, the same
  as printing does, so the two can no longer cross (`apps/server/src/orders/order-items.service.ts`).
- **Guarded by:** `qa-money.int.test.ts`, "items on a printed bill".

### QA-003 High: a hidden NUL character crashed requests

- **What happened:** text containing the invisible NUL character (it can come from copy and paste)
  in a dish note, a name or a reason gave an internal error (500) on 17 endpoints, because the
  database cannot store it. On a waiter phone, an order with such a note was retried forever and,
  because the phone sends its orders in turn, held up every later order from that phone.
- **How found:** fuzz.
- **Fix:** the server now refuses such text with a clear message ("Some text holds a hidden control
  character. Retype it and try again.") before anything else reads it
  (`apps/server/src/http/request-pipeline.ts`, `refuseNulText`). The phone then shows the order as
  refused, with that message, instead of retrying it.
- **Guarded by:** `apps/server/test/integration/input-fuzz.int.test.ts`.

### QA-004 Medium: the date 0000-01-01 crashed requests

- **What happened:** a date in year 0 passed the checks but the database has no year 0, so the
  request failed with a 500 (found on closing the day).
- **How found:** fuzz.
- **Fix:** dates in year 0 are refused everywhere (`packages/contracts/src/common.ts`, `IsoDate`).
- **Guarded by:** `input-fuzz.int.test.ts`; `packages/contracts/test/fuzz.test.ts`.

### QA-005 High: payments and a reopened bill

- **What happened:** (1) while a bill was reopened for changes (Edit bill), the cashier could still
  take its payment. The bill was then "paid" for the old amount, and printing it again failed, so
  the table could only be cleared by voiding the bill. (2) A bill that was partly paid could be
  reopened and cut below what had already been paid; it could then never be settled. The product's
  rule (decision 84) is that only an unpaid bill is edited; the screen followed it but the server
  did not.
- **How found:** review, then tests.
- **Fix:** the server refuses a payment while the bill is open for changes, and refuses to reopen a
  bill that has any payment (`payments.service.ts`, `invoice-actions.service.ts`).
- **Guarded by:** `qa-money.int.test.ts`, "payments and a reopened bill".

### QA-006 High: a payment and a void at the same moment

- **What happened:** if one cashier took payment on a bill while a manager voided the same bill,
  the database could deadlock and one of them got "Something went wrong". In the test, 4 of 12
  simultaneous actions failed this way.
- **How found:** review, then a race test.
- **Fix:** a payment now locks the table, the bill and the invoice in the same order as voiding and
  reopening do, so one simply waits for the other (`payments.service.ts`).
- **Guarded by:** `qa-money.int.test.ts`, "a payment and a void of the same bill at once".

### QA-007 High: one broken screen blanked the whole app

- **What happened:** none of the apps (POS/KDS/dashboard console, vendor web app, waiter app, table
  tablet) had an error boundary, so any bug while drawing a screen left a white or blank screen
  with no way back except restarting.
- **How found:** review.
- **Fix:** each app now shows "This screen ran into a problem" with **Try again**; moving to
  another screen also clears it. The console reports the error to the vendor like other page
  errors. Shared components: `ErrorBoundary` in `@rp/ui-web` and `@rp/ui-native`, `ScreenBoundary`
  in `@rp/mobile-shell`.
- **Guarded by:** `apps/console/test/crash.test.tsx`, `apps/control-plane-web/test/crash.test.tsx`,
  `packages/mobile-shell/test/crash.test.tsx`, `packages/ui-web/test/ErrorBoundary.test.tsx`.

### QA-008 Medium: an app that could not start stayed blank

- **What happened:** if the waiter app or the table tablet failed while starting (its secure
  storage or a device module), it showed a blank screen forever. The waiter app also remembered the
  failure, so even trying again could not work.
- **How found:** review.
- **Fix:** both apps now say "The app could not start" with **Try again**, which really starts
  again (`apps/waiter-app/src/Root.tsx`, `session.ts`, `apps/table-tablet/src/Root.tsx`).
- **Guarded by:** `apps/waiter-app/test/root.test.tsx`, `apps/table-tablet/test/root.test.tsx`.
  The real device modules are checked on a phone (manual checklist).

### QA-009 Medium: one failing order held up the phone's later orders

- **What happened:** the phone keeps orders it could not send and sends them in turn. If the server
  answered one of them with an internal error every time (a server bug; QA-003 was one), the phone
  stopped at that order on every attempt, so its later orders never went either, and the waiter
  only saw "waiting to send".
- **How found:** review of QA-003, then a test.
- **Fix:** an order the server answers with an error waits on its own; the next ones still go. The
  phone still stops at the first order when the server cannot be reached at all
  (`packages/mobile-core/src/outbox.ts`, `order-outbox.ts`).
- **Guarded by:** `packages/mobile-core/test/order-outbox.test.ts`, "an order the server keeps
  failing".

### QA-010 Critical: day-end and a payment at the same moment

- **What happened:** day-end totals the day and closes it. A payment, bill or order being saved at
  that very moment had already read "today" as the day being closed, so it was saved on the closed
  day after its report was frozen: that money appeared in no day's report and no GST total.
- **How found:** review, then a test that holds day-end open while a payment arrives.
- **Fix:** every record that takes a business date now waits for a day-end in progress, and
  day-end waits for records already being saved; the payment then belongs to the next day
  (`apps/server/src/common/business-dates.ts`).
- **Guarded by:** `qa-money.int.test.ts`, "day-end and a payment at the same moment".

### QA-011 High: a tiny Excel file could stop the server

- **What happened:** a menu workbook of a few kilobytes naming a far-away cell (for example
  XFD1048576, Excel's last) made the spreadsheet reader build millions of empty rows at once. In
  the test the process ran out of memory and stopped; on the restaurant PC that process is the
  whole server (POS, kitchen, orders).
- **How found:** review, then a test.
- **Fix:** each sheet is checked before it is read: one reaching beyond 3,000 rows or 200 columns
  is refused with "A sheet reaches far beyond its data. Delete the empty rows and columns after
  your menu…" (`apps/server/src/menu/import/workbook.ts`). The menu file and the Excel import both
  go through it.
- **Guarded by:** `apps/server/test/unit/workbook-reach.test.ts`.

### QA-012 Medium: two tills opening one bill

- **What happened:** if two people opened the same table's bill at the same moment, one got
  "Something went wrong" (3 of 5 tries in the test).
- **Fix:** opening a bill takes the table's lock first; both get the same bill
  (`bills.service.ts`).
- **Guarded by:** `qa-money.int.test.ts`, "two cashiers open the same bill at once".

### QA-013 High: cash into a shift that was being closed

- **What happened:** cash taken at the moment the cashier's shift was being closed went into the
  closed shift, so the shift's expected cash (and its shortage or excess) was wrong.
- **How found:** review, then a test that holds a shift close open while cash is taken.
- **Fix:** a cash payment locks the shift and checks again that it is open; otherwise "Open a shift
  before taking cash" (`shifts.service.ts`, `payments.service.ts`).
- **Guarded by:** `qa-money.int.test.ts`, "cash taken while the cashier's shift is being closed".

### QA-014 Low: feedback comments in a random order

- **What happened:** two comments saved in the same millisecond could be listed either way round
  (it made a test fail now and then).
- **Fix:** ties are broken by the record's id, which follows time (`feedback.service.ts`).
- **Guarded by:** `feedback.int.test.ts` (existing).

### QA-015 Medium: an add-on marked "not available"

- **What happened:** a manager could mark an add-on (say "Extra cheese") as not available, but the
  published menu ignored the mark, so every ordering screen still offered it and the server
  accepted and charged it.
- **Fix:** add-ons marked not available are left out of the published menu, like removed ones
  (`apps/server/src/menu/menu-content.ts`); the menu is published after changing the mark.
- **Guarded by:** `apps/server/test/integration/qa-orders.int.test.ts`, "an add-on marked not
  available".

### QA-016 High: a dish taken off the menu could not be cancelled

- **What happened:** if a dish was archived while it was on an open order, that line could no
  longer be cancelled or reduced ("There is no such active item"); staff could only bill it or void
  it with a manager's PIN.
- **Fix:** giving stock back skips a dish that is off the menu (`menu-publish.service.ts`).
- **Guarded by:** `qa-orders.int.test.ts`, "a dish taken off the menu while it is on an order".

### QA-017 Medium: a kitchen screen with two stations

- **What happened:** a kitchen screen set to show two stations (kitchen and bar) showed and bumped
  both, but marking a single bar dish "preparing" was refused.
- **Fix:** marking a dish checks every station the screen shows (`order-items.service.ts`).
- **Guarded by:** `qa-orders.int.test.ts`, "a kitchen screen showing two stations".

### QA-018 High: lowering dishes on another waiter's table

- **What happened:** cancelling a dish must be on the waiter's own table, with a reason, but
  changing "Dal x4" to "Dal x1" did the same on any table, with no reason.
- **Fix:** lowering a quantity follows the cancel rule (a waiter on their own tables only; cashiers
  and managers anywhere). Raising it is still allowed anywhere, like ordering. Whether it should
  also ask for a reason is decision D-3.
- **Guarded by:** `qa-orders.int.test.ts`, "lowering a dish on another waiter's table".

### QA-019 Low: curly quotes printed as "?"

- **What happened:** a note typed on a phone ("Don’t add onion – thanks") printed on the kitchen
  slip as "Don?t add onion ? thanks".
- **Fix:** curly quotes and dashes print as plain ones (`apps/server/src/printing/escpos.ts`).
  Hindi still prints as "?": decision D-12.
- **Guarded by:** `apps/server/test/unit/escpos-hostile-text.test.ts`, which also proves that
  printer commands hidden in dish names, notes, add-ons or table names (open the cash drawer, cut
  the paper, reset) are printed as plain text and never reach the printer.

### QA-020 Low: a very large bill with a large discount

- **What happened:** sharing a bill discount over its dishes multiplies amounts together; on a bill
  with a line of about ₹9 lakh or more and a large discount, the product passed the computer's
  exact range for whole numbers and the bill could not be worked out (a clear refusal, not a wrong
  amount). Found by the new money property tests.
- **Fix:** the sharing is done in exact big-integer arithmetic (`packages/domain/src/money.ts`,
  `allocate`).
- **Guarded by:** `packages/domain/test/money-properties.test.ts`, "a large bill with a large
  discount".

### QA-021 Medium: database errors answered "Something went wrong"

- **What happened:** when two devices clashed on the same record, the database was briefly
  unreachable, or a value was out of the database's range, the person saw "Something went wrong"
  (500), and the phones treated a clash like an outage. The audit fixed each clash it found
  (QA-006, QA-012); this makes any it did not find answer plainly too.
- **Fix:** database errors are mapped to plain answers: a clash on the same record "This was changed
  at the same moment. Refresh and try again" (409); a deadlock "Someone changed this at the same
  moment. Try again" (503, which the phones retry by themselves with the same order key); the
  database unreachable "The restaurant server cannot reach its database…" (503); text or numbers it
  cannot store (400/422); a record gone meanwhile (404). Clashes and outages are still reported to
  the vendor (`apps/server/src/errors/error-mapping.ts`).
- **Guarded by:** `apps/server/test/unit/error-mapping-database.test.ts`.

### QA-022 Critical: dishes ordered after the bill was printed (the owner's report)

- **What happened:** a table's bill was printed, then the guests ordered more (another KOT). The
  bill screen showed a total that included the new dishes, but the only printed bill was the old
  one; printing again was refused ("This bill is printed"). If the guests then paid the printed
  amount, the new dishes were on no bill at all and could never be charged.
- **How found:** the owner, reproduced by a test.
- **Fix:** the bill screen now marks dishes "Not on the printed bill" and says how many were ordered
  since; **Print updated bill** gives:
  - while the printed bill is unpaid, the **revised bill**: the same number with the new amount
    (as Edit bill does; audited "Dishes ordered after the bill was printed");
  - once it is paid or part paid, a **new bill for just the new dishes**.
    The table closes only when every dish is on a paid bill (`bills.service.ts` `lockedBillToPrint`,
    `invoices.service.ts`, `BillScreen.tsx`). Which of the two applies is decision D-21.
- **Guarded by:** `apps/server/test/integration/qa-flows.int.test.ts` "dishes ordered after the
  bill is printed"; `apps/console/test/billing-screens.test.tsx` (QA-022).
- **Existing test changed:** `billing.int.test.ts` "reopens a printed bill … when items are added
  after printing" asserted that printing again was refused; that one assertion was removed (the
  owner asked for the opposite), the rest of the test is unchanged.

### QA-023 High: "Bill requested" on the dashboard with no way to bill (the owner's report)

- **What happened:** on the manager dashboard a table showed "Bill requested"; clicking it opened
  its orders page, which had no bill button (and showed "No orders" once every dish was served).
  The only way to the bill was the alert; once the alert was cleared, the manager could not find it.
- **Fix:** a table's orders page now has **Bill** (opens the bill to print or take payment) and
  **Table actions** (the POS panel: move, merge, free, clean, take order), whether or not anything
  is cooking (`apps/console/src/manage/TableActions.tsx`; the POS opens a table's panel from
  `/pos?table=…`).
- **Guarded by:** `apps/console/test/dashboard.test.tsx` (QA-023).

### QA-024 High: a table that asked for the bill with nothing to bill

- **What happened:** if the bill was requested before anything was ordered (or every dish was
  cancelled afterwards), the table stayed "Bill requested" for good: it could not be freed, and
  printing said there was nothing to bill. Day-end stayed blocked unless the table was carried
  forward every day. (Found by three audit helpers.)
- **Fix:** such a table can be freed ("Free table", with a reason), from "Bill requested" too, and
  also from "Bill printed" when every bill is paid. Closing a table now follows one rule
  everywhere: nothing waiting for approval or held, no dish on no bill, no voided part not printed
  again, and no printed bill unpaid (`apps/server/src/billing/session-work.ts`). An unpaid printed
  bill now blocks closing without a bill ("Bill … is printed and not paid").
- **Guarded by:** `qa-flows.int.test.ts` "a table that asked for the bill with nothing to bill";
  `apps/console/test/pos.test.tsx` (QA-024).
- **Existing test changed:** `table-sessions.int.test.ts` asserted that a table in "Bill requested"
  with nothing ordered could not be closed: that assertion was removed (it was this dead end).

### QA-025 High: a diner's order after the bill was printed

- **What happened:** after the bill was printed, a guest ordered from the tablet (waiting for
  staff approval); paying the printed bill closed the table, and the order could then neither be
  approved nor rejected ("This table has been closed"). The guest's dish was never made and its
  alert disappeared.
- **Fix:** paying no longer closes a table with a diner's order waiting, held dishes or dishes not
  yet billed. Once approved, the dishes are billed with **Print updated bill**; once rejected, the
  table can be freed.
- **Guarded by:** `qa-flows.int.test.ts` "a diner orders after the bill is printed".

### QA-026 Critical: a split bill with one part voided

- **What happened:** a bill split in two; part A voided (say printed wrongly), part B paid: the
  table closed, and part A's share was never billed. There was also no way to print part A again.
- **Fix:** the table stays open while a voided part has not been printed again; **Print updated
  bill** prints it again with the same lines and amounts under a new number that replaces it; once
  paid, the table closes.
- **Guarded by:** `qa-flows.int.test.ts` "a split bill with one part voided";
  `billing-screens.test.tsx` (QA-026).

### QA-027 Critical: a takeaway sent twice from the waiter phone

- **What happened:** on the waiter phone's takeaway screen, every press of Send used a new order
  key. If the Wi-Fi dropped after the server took the order, the phone said "Not sent" and kept the
  dishes; pressing Send again made a second order and a second kitchen slip.
- **Fix:** the same order sent again keeps its key, so the server makes it once; a changed order
  gets a new key (`apps/waiter-app/src/TakeawayScreen.tsx`).
- **Guarded by:** `apps/waiter-app/test/orders.test.tsx` (QA-027).

### QA-028 Critical: a closed table's bill corrected after the guests left

- **What happened:** after a table had paid and left, a manager voided its bill (say, a wrong GSTIN)
  and printed the corrected one. Printing set the table to "Bill printed": if new guests were already
  seated there, their table now said "Bill printed" for someone else's bill; if the table was free,
  printing failed and the corrected bill could never be printed.
- **How found:** an audit helper, then a test.
- **Fix:** a bill moves its table only while its own guests are still at it (`invoices.service.ts`,
  `bill-split.service.ts`).
- **Guarded by:** `qa-flows.int.test.ts` (QA-028).

### QA-029 Medium: kitchen alerts for a table that had left

- **What happened:** a dish marked ready shortly before the table paid stayed "ready" after the
  guests left; the kitchen's sweep then raised a repeating "food waiting" alert for it, which could
  not be cleared by bumping (the ticket had left the screen).
- **Fix:** the sweep skips dishes of tables that have paid and left, as the kitchen screen does
  (`kitchen/kds-escalation.service.ts`). What should happen to dishes still cooking when a table pays
  is decision D-24.
- **Guarded by:** `qa-flows.int.test.ts` (QA-029).

### QA-030 Medium: day-end without a confirmation; the shift that lost the payment

- **What happened:** "Close the day" closed it at once, though it cannot be undone (the conventions
  ask for a confirmation on destructive actions). And when a cash payment needed a shift, "Open
  shift" went to the shift screen, whose Back went to the floor: the bill being paid was lost.
- **Fix:** closing the day asks first ("Close {date}? … This cannot be undone"); the shift screen goes
  back to the payment it was opened from (`DayEndScreen.tsx`, `PosHome.tsx`).
- **Guarded by:** `billing-corrections.test.tsx`, `billing-screens.test.tsx` (QA-030). The two
  existing day-end tests now press the confirmation too; nothing they check was removed.

### QA-031 High: unpaid bills holding day-end up could not be opened

- **What happened:** day-end listed "Unpaid bills: INV/…" as text and could not close; a takeaway
  bill from an earlier hour, or of a table already closed, had no screen to find it on.
- **Fix:** each unpaid bill has **Take payment for INV/…**, which opens its payment and comes back
  to day-end (`DayEndScreen.tsx`).
- **Guarded by:** `billing-corrections.test.tsx` (QA-031).

### QA-032 Medium: paid takeaways never left the open list

- **What happened:** takeaway orders were never marked done, so the POS and the waiter phone's
  "Open takeaway orders" grew all day, every paid one still offering "Bill order". The phone's list
  also listened for events the server never sends.
- **Fix:** a takeaway whose bills are all paid is closed and leaves the lists; its kitchen tickets
  are unaffected (they never depended on it). The phone listens for the real events
  (`payments.service.ts`, `TakeawayScreen.tsx`). Whether a paid takeaway should stay listed until it
  is handed over is decision D-23.
- **Guarded by:** `qa-flows.int.test.ts` (QA-032).

### QA-033 High: the POS could not take a dish off a table

- **What happened:** with no cashier role, managers run the POS, but the POS had no way to cancel a
  dish the kitchen had not started, or void one it had: only the waiter phone did. A dish entered on
  the wrong table could only be hidden with a discount.
- **Fix:** each sent dish on the POS has **Cancel** (not started) or **Void** (started), as the
  person may (`@rp/ordering` `lineActions`), with a reason; a void asks for a manager's PIN when the
  person needs one (`apps/console/src/pos/OrderEntry.tsx`).
- **Guarded by:** `apps/console/test/order-entry.test.tsx` (QA-033).

### QA-034 High: another manager's open shift blocked day-end

- **What happened:** day-end waits for every cash shift to close, and named whose was open ("Each
  person closes their own"), but the console only showed one's own shift. If a manager went home
  with a shift open, nobody could close the day.
- **Fix:** a new `GET /api/v1/shifts/:id` (managers; someone limited to their own shift sees only
  theirs) and **Close {name}'s shift** on day-end, which opens that shift to count and close it.
- **Guarded by:** `qa-flows.int.test.ts` (QA-034); `billing-corrections.test.tsx` (QA-034); the
  authorisation sweep and the fuzz test now cover the new endpoint.

### QA-035 Medium: no way to print a kitchen ticket again

- **What happened:** the server could reprint a KOT, but no screen offered it; a ticket lost to a
  jammed or offline kitchen printer was simply lost, and the dish never made.
- **Fix:** the POS lists each order's printed tickets with their status ("Printed", "Not printed:
  printer problem") and **Print again**, with a reason (`OrderEntry.tsx`).
- **Guarded by:** `order-entry.test.tsx` (QA-035).

### QA-036 Low: Merge and Move dishes offered on a printed bill

- **Fix:** only Move is offered on a table whose bill is printed (`TableOverview.tsx`).
- **Guarded by:** `apps/console/test/pos.test.tsx` (QA-036).

## Checked and found sound

Attacked and held; the new tests keep guarding them.

- **Every endpoint against hostile input** (`input-fuzz.int.test.ts`): about 2,600 calls to all 259
  endpoints of the restaurant PC with missing fields, wrong types, empty and 10,000-character
  strings, control characters, scripts, emoji, Hindi, right-to-left text, negative, decimal, huge
  and unsafe numbers, impossible dates, 10,000-element lists, unknown fields, malformed JSON, text
  and form bodies, and unknown, malformed and oversized ids. After the fixes above every answer is
  a clean refusal or a correct success: no internal error, no leaked details, no hang, and no
  refused request that still wrote an order, bill, payment or discount.
- **Money arithmetic** (`packages/domain/test/money-properties.test.ts`, fast-check): on thousands
  of random bills (up to 30 dishes, quantities up to 99, every GST rate, both price modes, item and
  bill discounts, service charge, round-off) the totals always equal the sum of the lines; CGST and
  SGST never lose or invent a paisa and differ by at most one; splits by items or equally always
  add up to the bill in every amount and every tax; payments are never more than the bill; and the
  day's report always equals its invoices and payments. No defect found.
- **Printer commands hidden in text:** see QA-019.
- **The live connection** (`realtime-fuzz.int.test.ts`): hostile handshakes, resync requests and
  unknown messages are refused or ignored; the server and other screens carry on.
- **Test quality (mutation check):** 12 deliberate bugs were planted one at a time in the money,
  tax, payment, discount, business-date, financial-year, split, lock-out and day-report code. The
  tests caught 11; the 12th (a bill paid one paisa short counted as paid) is now caught by a new
  test. Coverage of `packages/domain` is 98 % of statements.
- **Already well protected (re-checked):** client prices and totals are never read; quantities are
  1 to 99; archived, sold-out, off-hours and wrong-channel dishes are refused; the same order sent
  twice (same key) makes one order, one kitchen slip and one stock deduction, also at the same
  moment; a tablet can only order for its own table; overpayment is refused; invoice numbers come
  from a locked counter without gaps; the database refuses deleting or editing paid bills, payments
  and the audit log; PIN, password, TOTP and pairing-code guessing are limited; sessions end when a
  person is deactivated; manager approvals are single-use and tied to one record.
