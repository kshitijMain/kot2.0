# ADR-0031: Fixes from testing, round 2 (kitchen, stations, KOT and bill printing)

Status: Accepted
Date: 2026-11-14
Work package: none (fixes from the Business Owner's testing, branch `fix/testing-round-1`)
Requirements: KDS-003, KDS-005, KDS-008, MENU-006, PRN-001, PRN-003, BILL-002, BILL-010, RPT-012

## Context

The Business Owner's second round of testing found bugs in the kitchen display, station routing,
the KOT and bill printing, and asked for a new menu availability screen and invoice settings. Each
section names the item of the brief, the cause found, and what changed. Business choices left open
are in `docs/testing/DECISIONS_NEEDED.md`.

## A. Bump stays grey

**Cause.** The kitchen display enabled Bump only when nothing on the ticket was waiting, cooking
or ready (P9-21 added "ready": food at the pass had to be picked up first). After "All ready" the
button stayed grey until a waiter picked everything up. The server already allowed it: it refuses
a bump only while something is waiting or cooking (`KOT_NOT_READY`).

**Now.** Bump is enabled once every dish on the ticket that is not cancelled is ready, picked up
or served, as the server checks. While it is grey, one line beside it says why ("Mark all dishes
ready to bump"), tied to the button for screen readers. A bumped ticket's ready dishes stay ready
for the waiter to collect, and Recall brings the ticket back within the hour, as before.

**Changed tests.** The kitchen display's tests that expected Bump to wait for the pick-up now
expect it as soon as everything is ready (the brief changes P9-21's rule).

## B. A Bar dish went to the Kitchen

**Cause.** A KOT took each dish's station from the last _published_ menu. Moving "Lime soda" to
the Bar in the menu editor saved it to the draft; until someone published, every Lime soda kept
going to the Kitchen. Nothing on the dashboard said the menu had unpublished changes. (The Bar
station itself was fine: whether a station prints and on which printer is read live already.)

**Now.**

- A dish goes to its station as it stands when the KOT is made (`routeToLiveStations` in the
  order engine), like the station's print setting: a station is kitchen set-up, not something the
  guests see. A dish whose station has been archived keeps the published one. Prices, names and
  everything guests see still wait for publishing (D-39).
- `GET /api/v1/menu/publish-status` (`MENU_MANAGE`) compares the draft with the published menu,
  leaving out availability and stock (they are live), and names the dishes added, changed or
  removed. The menu editor shows **Unpublished changes** above the dishes with **Publish now**;
  every other dashboard page shows the same notice with a link to the menu.
- The Kitchen and printers page warns about a station whose tickets appear nowhere (no kitchen
  screen shows it and it does not print) and one set to print with no printer.

**Tests.** A dish moved to the Bar without publishing makes a Bar KOT only, shown on the Bar's
screen and printed on the Bar's printer; a mixed order makes one KOT per station, each on its own
screen and printer (`station-routing.int.test.ts`, which failed before the fix).

## C. Menu availability as a full page

**Was.** A list in a side panel over the kitchen display (and a list page on the dashboard), with
a red "Mark out of stock" button on every dish and the portion count in a dialog.

**Now.** A full page, opened from the kitchen display's top bar (`/kds/availability`, with "Back
to the tickets") and from the dashboard (`/manage/availability`):

- One line saying what it does, a search box, a filter (All / Available / Out of stock) and
  category chips.
- A grid of large cards (three or four a row on a laptop or kitchen screen, fewer on smaller ones):
  the dish name, its category, and one big two-state switch, Available or Out of stock. An
  out-of-stock card is greyed with an "Out of stock" badge; no red buttons.
- Portions left on the card as − 12 + with Clear. The presses are saved together a moment after
  the last one (`COUNT_SAVE_DELAY_MS`); the dish sells out by itself at 0.
- A change applies at once with a short note and Undo for six seconds instead of a dialog.
- With a category chosen, "Mark all in {category} available" puts back every dish of it that is
  out.
- Large touch targets, design tokens only. Alerts, cancellations of unstarted portions and live
  updates are unchanged (the server does them).

**Changed tests.** The availability tests were rewritten for the new page (the brief replaces the
screen); the pure filter and the live update are kept.

## D. The KOT named the wrong person

**Cause.** Every KOT records who sent it (`kots.sent_by_id`, ADR-0023), but the printed KOT, the
kitchen display card and the live order feed named the table session's waiter, who since ADR-0023
is whoever _opened_ the table; the staff report counted orders, not KOTs.

**Now.** They name the KOT's sender: the waiter who sent it, or for a table tablet or QR order the
person who approved it (whoever fired held dishes for those). Orders and tickets from before KOTs
recorded a sender fall back to the order's creator, then the table's opener. The printed KOT says
"Sent by: …". The staff report adds **KOTs sent** per person (new KOTs by `sent_by_id`). "Ready"
and "out of stock" alerts already went to the KOT's sender. The table's details keep "Opened by".

**Changed tests.** The printed KOT's layout test reads "Sent by:" instead of "Waiter:".

## E. A KOT the kitchen reads at a glance

**Now** (`renderKotTicket`, 80 mm and 58 mm):

- "TABLE 3" or "TAKEAWAY #12" very large, then the station ("KITCHEN", "BAR") as a white-on-black
  banner across the paper (GS B; a printer without it prints the word plainly).
- "CHANGED", "CANCELLED" (with "Do not cook these.") and "REPRINT" in inverted banners of their
  own, after a white line.
- The KOT number and time large on one line; "Sent by: …" (with "QR order" or "table tablet
  order" when a diner ordered); the guests and the order number; "2nd KOT for this table" in bold
  when the station had KOTs for this table before.
- Each dish tall and bold with its quantity and size ("2 x Paneer Tikka (Full)"), add-ons and
  notes indented under it; "FIRE: HELD DISHES" on a ticket that sends held dishes, and the order's
  dishes still held at the station under "ON HOLD - DO NOT COOK YET".
- A footer counting lines and items in words that agree with the number ("1 line, 1 item") and
  the date. The ordering app's name ("Waiter app") is gone.
- The virtual printer draws inverted text, so it shows the ticket as printed. Before and after
  images at both widths are in `docs/testing/screenshots/round-2/`.

**Changed tests.** The KOT layout snapshots follow the new layout (the brief changes it).

## F. Invoice settings, the thank-you line and the place of supply

**Now.**

- The Restaurant page opens with **Invoice settings**: the bill as it prints (from the saved
  settings) and, for the Owner, **Edit invoice settings**, one dialog with everything the set-up
  step asks to confirm (display name, legal name, address, phone, state, GSTIN, FSSAI number, the
  default invoice series, four header and four footer lines, the thank-you line, and whether to
  print the phone, the FSSAI number and the total in words) beside a live preview of the bill.
  Saving sends only what changed, with one reason for the audit. The set-up step's "Confirm how
  invoices look" shows the same preview.
- `POST /api/v1/restaurant/invoice-preview` (`OPERATIONS_CONFIGURE`) prints a sample bill from
  the settings being typed with the renderer real bills use, saving nothing.
- `bills.thankYouLine` (default "Thank you for dining at {restaurant}!") is the last line of every
  bill, printed and digital, and of the QR menu's bill (`QrBillInvoice.footerLines`); empty prints
  none. `bills.printPhone` and `bills.printFssai` (both on by default) leave them off the bill.
- The place of supply prints as "27-Maharashtra" (`placeOfSupplyText`): the restaurant's state,
  else its GSTIN's first two digits; never a fixed value. Older invoices that kept only "27" print
  the same way (D-40).
- Making another series the default once the current one has numbered bills warns and needs the
  Owner to confirm (D-41).

**Deploying.** The relay checks a published bill strictly, so the QR relay must run this version
before the server does: an older relay refuses a bill with `footerLines` and the QR page shows no
bill until it is updated.

**Changed tests.** The invoice's particulars in the billing test now have the place of supply
written out and the thank-you footer (the brief changes both).

## G. A bill after more dishes

**Cause.** When dishes were added to a table whose bill was printed and unpaid, the server revised
that invoice in place under the same number on the next print (QA-022). But the old invoice kept
its **Take payment** and **Print again** until then: printing it again printed the version without
the new dishes, and paying it settled the table at the old total. Nothing sent anyone to the new
bill.

**Now.**

- That invoice is _outdated_ (`outdatedInvoiceId` in `billing/outdated.ts`: the bill's only live
  invoice, unpaid, with dishes ordered since). The server refuses to take payment for it or print it
  again (`409 BILL_OUTDATED`: "Print the new bill, then take payment").
- The next Print cancels it, with the reason "Items added after the bill was printed", audited in the
  name of whoever prints (`INVOICE_VOIDED`) and kept in the GST register as cancelled, and issues a
  new invoice with the next number, every dish and the new total, naming the one it replaces.
- The bill view names the outdated invoice; the bill screen shows "Outdated: print the new bill"
  instead of its payment and reprint buttons, and says what printing the new bill does. The
  manager's Pending bills shows "Needs a new bill". The table overview flags the session
  (`billOutdated`); the waiter app says "Dishes you add now need a new bill" on a table whose bill is
  printed, and "it needs a new bill" once a dish was added.
- A bill already part paid or split keeps its invoices: the new dishes get an invoice of their own
  (QA-022 unchanged there).

**Changed tests.** The two QA-022 tests that expected the revision in place, and paying the old
amount, now expect the cancellation and the new number, and the refusal (the brief changes the
rule).

## H. A printer that comes back

**Cause.** After a printer failed, the queue waited ever longer before trying it again (2, 4, 8, 16,
32 s, then a minute each time), and nothing checked whether it was back meanwhile. A printer off
for a minute or two printed what waited up to a minute after it was switched on; nothing on the
dashboard showed the waiting tickets, so it looked as if they never came out.

**Now.**

- On every pass (every 2 s), the queue asks a printer that failed whether it answers, without
  printing on it (`PrinterTransport.probe`: a network printer that takes a connection; USB cannot
  tell). As soon as it does, the waiting jobs print, in order, once each. The wait between real
  tries is never more than 8 s (`retryMaxMs`).
- `POST /api/v1/printers/:id/retry` (`OPERATIONS_CONFIGURE`) tries at once. The print queue lists
  each printer's waiting tickets and notes (`PrintQueuePrinter.jobs`).
- The dashboard's **Printers** page shows each printer printing or not (since when, why), its
  waiting tickets oldest first with how often they were tried, **Retry now** and **Print on another
  printer** (the existing redirect, with a reason). The count beside Printers is the tickets waiting
  on printers that are down.

**Tests.** `printer-resume.int.test.ts` stops a printer for 15 s with two tickets waiting, starts
it, and needs both printed within 10 s, in order, once each (it failed with the old waits); and
Retry now. The probe has unit tests; the virtual printer and the tests' fake printer ignore a
connection that sends nothing, as printers do.
