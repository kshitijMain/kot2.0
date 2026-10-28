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
