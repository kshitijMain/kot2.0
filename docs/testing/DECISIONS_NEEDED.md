# Decisions needed from the owner

Situations where the right behaviour is a business choice, not a technical one. For each: what
happens, the options, a recommendation, and what the system does **today** until you decide.
Answer by number, for example "D-3: option B". Where the audit had to change something to stop
money or records going wrong, the "today" line says so; everything else was left as it was.

---

## D-1: a paid bill is voided and printed again

**Situation.** A guest has paid, then the bill turns out wrong (wrong table, missing dish). The
cashier voids it (manager PIN) and prints a corrected bill.

**Today.** The money already taken stays recorded against the voided bill and still counts in the
cashier's expected cash and the payment report. The corrected bill must be paid again, so the
same money is counted twice, or, if it is left unpaid, day-end is blocked. There is no way to
record a refund. (This was already an open question from P1-12b.)

**Options.**

- **A.** When a paid bill is voided, its payments move to the corrected bill automatically; a
  refund is recorded only if money actually goes back to the guest (mode, amount, manager PIN).
- **B.** Voiding a paid bill always records a refund of what was paid (mode and amount), with a
  manager's PIN; the corrected bill is paid afresh.
- **C.** Keep today's behaviour.

**Recommendation:** A. It matches what really happens at the counter (the money stays in the
drawer) and keeps the cash count right.

---

## D-2: changing a dish after the bill is printed

**Situation.** The bill is printed and the guest asks for one more roti, or sends a dish back.

**Today (changed by the audit, QA-002).** A dish on a printed bill can only be changed through
**Edit bill** (manager PIN for cashiers): reopen, change, print again. A **new** dish can still be
ordered for the table; the table then needs a second bill, as before. Before the audit, the
quantity could be raised after printing, or even after payment, without the bill changing.

**Options.**

- **A.** Keep it: changes to printed dishes go through Edit bill; extra dishes go on a new order.
- **B.** Changing a printed dish reopens the bill automatically (still with a manager's PIN for
  cashiers) and prints it again.

**Recommendation:** A (safe, and it is how the product was meant to work).

---

## D-3: a waiter lowers a dish on another waiter's table

**Situation.** Waiter Ravi changes "Dal x4" to "Dal x1" on a table that belongs to waiter Asha.

**Today (changed by the audit, QA-018).** Lowering a quantity counts as cancelling the rest, so it
follows the cancel rule of the permission table: a waiter may do it on their own tables only;
cashiers and managers anywhere. Raising a quantity is still allowed on any table, like ordering.
Before the audit, any waiter could lower any table's dishes without a reason.

**Options.** A: keep this. B: any waiter may lower any table's dishes (the old behaviour). C: lowering
also needs a reason, like a cancel.

**Recommendation:** C (same rule as cancel, including the reason in the audit log). Today is A.

---

## D-4: several discounts on one bill

**Situation.** A cashier's limit is 10 %. They give 10 % on every dish and then another 10 % on the
whole bill: the guest gets 19 % off with no manager PIN.

**Today.** Each discount is checked against the limit on its own. Unchanged by the audit.

**Options.** A: the limit applies to the total discount on the bill (above it needs a manager's PIN).
B: keep per-discount limits. C: allow only one discount per bill for cashiers.

**Recommendation:** A.

---

## D-5: cash taken out of the drawer

**Situation.** A cashier records "cash out ₹5,000, petty purchase" from their shift.

**Today.** Any amount, with a reason of 3 or more characters; it is in the audit log and the shift
report but needs no approval and is not flagged as suspicious.

**Options.** A: above a set amount (for example ₹500, a setting) needs a manager's PIN. B: no
approval, but large cash-outs appear in the suspicious-activity report. C: keep it.

**Recommendation:** A and B together.

---

## D-6: an order before 04:00 paid after 04:00

**Situation.** The business day ends at 04:00. A bill is printed at 03:58 and paid at 04:02.

**Today.** The bill belongs to the earlier business day and the payment to the new one: the
earlier day's report shows the sale as unpaid and the new day's shows money with no sale.

**Options.** A: a payment always belongs to its bill's business day (if that day is still open).
B: keep it (each record dated when it happens).

**Recommendation:** A, while the earlier day is open; once it is closed, B.

---

## D-7: a bill printed at 01:00 on 1 April

**Situation.** The financial year changes at midnight on 31 March, but the business day runs to
04:00, so a bill at 01:00 on 1 April belongs to the business day of 31 March.

**Today.** The invoice number uses the **new** financial year's series (starting again at 1) and the
invoice date is 1 April, while the bill belongs to the business day of 31 March. So the 31 March
day-end report holds invoices from two series, and yearly archives (filed by business day) put
it in the old year.

**Options.** A: the invoice date and series follow the calendar date (today's behaviour, which is
what GST expects). B: they follow the business day.

**Recommendation:** A, with the 31 March report showing the two series separately. Please confirm
with your CA.

---

## D-8: tables still open at day-end

**Today.** Day-end is blocked until open tables are paid, or the manager ticks "carry forward",
which moves them to the next business day. Bills already printed keep the old day's date and are
paid on the next day. Takeaway orders with no bill do not block day-end.

**Options.** A: keep it. B: also block on takeaway orders without a bill. C: forbid carrying forward
a table whose bill is printed.

**Recommendation:** A plus B.

---

## D-9: the PC's clock is moved back

**Situation.** Someone moves the restaurant PC's clock back by hours or days.

**Today.** New records take the earlier date: a business day that is still open can get more
records, and invoice dates within a series can go backwards. Licences and sign-ins are protected
against this; orders and bills are not.

**Options.** A: if the clock is earlier than the last invoice, refuse new invoices and alert the
manager. B: keep using the last invoice's date and alert. C: keep it.

**Recommendation:** B (the restaurant keeps working), with an alert to the Owner.

---

## D-10: a dish already cooked when its order is voided

**Today.** Voiding a dish the kitchen has started needs a manager's PIN; the kitchen gets a
"cancelled" slip, the dish is not charged, and its stock is **not** given back (it was cooked). It
is recorded as a void with the reason, but not as wastage.

**Options.** A: keep it. B: also record it as wastage in the stock and cost reports.

**Recommendation:** B, once wastage reporting is wanted.

---

## D-11: moving a dish to another table after the bill is printed

**Today.** Refused: "… is on a printed bill." The bill must be reopened (Edit bill) first.

**Options.** A: keep it. B: allow it, reopening both bills automatically.

**Recommendation:** A.

---

## D-12: Hindi and other scripts on printed slips and bills

**Situation.** Dish names, notes or the restaurant name in Hindi (or emoji, or "smart" quotes from
a phone keyboard) are shown correctly on screens, but receipt printers print them as "?".

**Today.** Every character a basic receipt printer may not have is printed as "?", so it can never
send printer commands by accident.

**Options.** A: add a short "printed name" in English letters for each dish (and use it on KOTs and
bills). B: print Indian scripts as pictures (slower, needs testing on each printer model). C: keep
it, and tell restaurants to use English names.

**Recommendation:** A, and change "smart" quotes and dashes into plain ones automatically (no
decision needed for that part).

---

# Operations changes of 2026-10-30 (ADR-0023)

## D-13: custom roles that were built on the cashier role

**Situation.** The cashier role is gone. A restaurant may have made custom roles on top of it
(for example "Head cashier" with menu editing). The update cannot know which exist; each one
changed is in the audit log as `ROLE_CHANGED` with the reason "custom roles built on it now build
on the waiter role", and the Roles page shows them under the waiter role.

**Today (safest).** They move to the waiter base and keep the extra capabilities stored on them.
Their people lose what only the cashier base gave (billing, payments, shifts, discounts within the
limit, reprints) and sign in again. Nobody gains anything: a waiter can do less than a cashier.

**Options.**

- **A.** Keep it; the Owner adds billing capabilities to the role again if wanted.
- **B.** Turn such a role's people into managers too, like plain cashiers.
- **C.** Move them to the waiter base and add the cashier's capabilities to the role as extras.

**Recommendation:** A. It never grants more than before, and the Owner sees each changed role in
the audit log.

## D-14: people who were cashiers are managers now

**Situation.** Everyone on the built-in Cashier role became a Manager, as asked. A manager can
open the dashboard, change the menu and look after waiters' and kitchen staff's records.

**Today.** Done as asked, each person audited (`STAFF_UPDATED`, before `CASHIER`, after `MANAGER`),
and their sessions ended so they sign in again with the new role.

**Options.** A: keep it. B: also send the Owner an alert listing them after the update.

**Recommendation:** A plus B (the Owner should look at who now has manager rights).

## D-15: one size of a dish runs out (Full out, Half still available)

**Situation.** Availability and the stock count are per dish. The kitchen may run out of Full
portions while Half are still possible.

**Today (safest).** Marking a dish out of stock takes off every size; the kitchen marks it
available again when any size can be made, and the waiter checks with the kitchen.

**Options.** A: keep it. B: availability per size (a switch per size on the availability screen;
the server refuses only that size). C: per-size stock counts as well.

**Recommendation:** B, if kitchens ask for it after the pilot.

## D-16: a combo whose out-of-stock part was already sent

**Situation.** A Thali (Dal + 2 Roti) is on a ticket; Roti is marked out of stock.

**Today (safest).** If no part of the combo has been started, the whole combo is cancelled at no
charge and the sender is told (a combo is sold whole). If any part has been started, nothing is
cancelled; the sender gets an OUT OF STOCK alert saying the kitchen has started it, and a manager
decides (a void or a discount) with the guest.

**Options.** A: keep it. B: cancel only the missing part and keep charging the combo. C: cancel
the missing part and take its menu price off the bill automatically.

**Recommendation:** A (no automatic money change on a combo price).

## D-17: who is "on duty", and the sender who has gone

**Situation.** KOT alerts go to the person who sent the KOT; when they are off duty, every waiter
on duty gets them.

**Today.** A person is on duty while signed in on a device, or while their pager or waiter phone is
connected. A sender on break keeps the old rule (NTF-009: the managers take it). A sender on duty
whose pager and phone are both off is alerted and the managers are called at once (NTF-007).
Diners' orders still waiting for approval have no sender: every waiter on duty is told.

**Options.** A: keep it. B: on duty = has an open shift or is on today's rota (needs a rota).
C: off duty only after signing out explicitly.

**Recommendation:** A.

## D-18: what a guest sees for a dish cancelled as out of stock

**Today.** On the table tablet the line is struck through with "Cancelled: Out of stock. Not
charged." (or "Not accepted: Out of stock" for an order still waiting). The QR page shows the
order's state; a cancelled line drops out of the order's dishes, and a fully rejected order
shows "Not accepted" with the reason. The bill never charges cancelled units.

**Options.** A: keep it. B: also show a short apology and a "Call waiter" button next to the
line. C: hide the cancelled line entirely.

**Recommendation:** A, with B worth testing in the pilot.

## D-19: who hears a bill request now that no waiter owns the table

**Situation.** There is no responsible waiter. A bill request from a guest (tablet, QR) or from a
waiter's phone has to reach someone who prints the bill and someone who brings it.

**Today.** It goes to every waiter on duty and the managers on duty, except whoever asked. The
first to acknowledge takes it (Part 4) and it disappears for the others.

**Options.** A: keep it. B: a waiter's own bill request goes to the managers only; a guest's to
everyone. C: only to the managers (they print), and the waiters see it on the table tile.

**Recommendation:** B, once the pilot shows whether waiters find the extra alerts noisy.

## D-20: the table's "waiter" on screens

**Today.** A table session still records one person: whoever opened it. Tiles, the POS and the
order feed's waiter filter show "Opened by" that person. Reports by waiter use who sent each KOT.

**Options.** A: keep it. B: show everyone who sent a KOT to the table. C: show nobody.

**Recommendation:** A (short on a tile), with B on the table screen later.
