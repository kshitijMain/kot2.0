# Manager's manual

You run the floor and the day, and you do the billing: there is no cashier role. Managers and
the Owner prepare bills and take payments from the POS. Most other tasks
below are in the dashboard (open from the main menu).

## Start of day

Overview: check alerts, the printers and that waiters have signed in. There are no sections to
give out: any waiter serves any table, and everything they do is recorded under their name.
Staff → Pagers: hand out the wrist pagers. Floor page: tables, floor areas and tablet
locations.

## Menu

Menu page: add or change dishes, prices, sizes, add-ons, combos and photos; mark a dish out of
stock (the kitchen can too). Prices include or exclude tax as the restaurant is set up.

- Add a dish: name, category, a short description, veg / non-veg / egg, spice, a photo, the price
  and the kitchen station. For Half and Full, press "Half and Full" and give each its price; "Add
  another size" for others (Regular and Large, 250 ml and 500 ml). Tick the add-on groups it
  offers (make groups once on the Add-on groups tab, then reuse them). Tax group, short code,
  search words and hours are under "More options"; most dishes need none of them. The preview
  shows the dish on the waiter phone and the table tablet.
- Photos: the restaurant's own only, landscape, in good light, one dish on a plain background. A
  dish without one shows a plain placeholder everywhere (POS, waiter phones, tablets, QR menu).
  "Add photos in bulk" matches many photos to dishes by file name or short code; "Choose a folder"
  takes every photo in a folder at once (copy them from a phone into one folder first).
- A whole menu: "Load menu file". Download the empty menu file (a .zip with menu.xlsx, a photos
  folder and a README), fill the sheet, put each photo in the photos folder named after the dish's
  short code or name, zip it again and load it. The PC lists every problem; then it shows every
  dish with its photo. Choose which of your tax groups and kitchen stations each name in the file
  means, correct any photo, and press "Add to the menu as a draft". Then publish.
- "Export menu file" saves the whole menu with its photos as the same file: to load at another
  restaurant, or to keep as a copy.
- Every dish needs a price above ₹0 (each size too), a kitchen station and a tax group: the PC
  refuses anything else. The menu check above the dishes lists what must be fixed before
  publishing (a dish without a price, kitchen station or tax group) and what is worth a look (no photo, an empty category, two
  dishes with one name).
- Publish: the step shows what changes on the devices, then which devices have the new menu and
  which get it when they reconnect.

## Menu availability

Menu availability (also on the kitchen screen): search or pick a category, then **Out of stock**
or **Mark as available** for each dish, or **Portions left** for a count. It applies at once on
every device and is in the audit log. Marking a dish out cancels its portions the kitchen has not
started, at no charge, and tells each waiter who sent one; nothing being cooked or ready is
touched. A combo is out of stock when any fixed part, or every choice of a part, is.

## Staff and devices

Staff page: add a person, set their role and PIN, deactivate someone who leaves (people are
never deleted, so their past work stays on the record). Unlock someone who forgot the PIN.
Devices page: pair a phone or tablet by scanning its code, see battery and last contact, revoke a
lost device. Pagers page: issue and collect wrist pagers.

## During service

Orders page: the live feed with late dishes highlighted. Approve a waiter's void after
preparation started by entering your PIN on their device; the reason is recorded. Move or merge
tables.

## Billing and payments (POS)

Sign in at the POS with your PIN. You can take cash straight away: you do not need a shift.

- Taking an order at the counter: pick the table or counter, add items, choose sizes and add-ons,
  send. The kitchen gets it at once. The system works out prices and tax; nobody types a price.
- Billing: open the table, print the bill, apply a discount if needed (always with a reason),
  choose the payment type (cash, card, UPI, split or part-payments). The invoice number is given
  when the bill is printed and is never reused. To split a bill by item or by amount use Split.
- Mistakes: a printed bill is not changed freely. Reprint is allowed. To change a printed bill
  use Edit bill, or void the invoice and issue a new one; give the reason each time. Do not
  hand-write over a printed bill.
- When the system is slow or down: use paper slips and the manual bill book (support playbook),
  and enter the slips later.

## The cash drawer add-on (optional)

A shift is for when you want to keep track of the cash in your own drawer. You do not have to use
it, and everyone decides for themselves.

- **What it does:** you start with the cash you put in the drawer. Every cash payment you take is
  added automatically. When you close, you count the drawer and the system shows any difference.
- **To use it:** POS → Shift → enter the opening cash → Open shift. When you finish, enter the
  counted cash and close it.
- **Only your own cash goes in.** Cash taken by someone else never goes into your shift. Cash taken
  by someone with no shift open is recorded normally, with no shift.
- **Cash in or out, and opening the drawer with no sale,** need your own open shift, because they
  only make sense against a drawer you count. Always give the reason.
- A cash drawer connected to the printer still opens on every cash payment, shift or no shift.

## Ending the day

Close open tables, then run the day-end. The day-end report is produced; the business day changes at
04:00 by default. Check Reports for the day.

If a shift is still open, day-end says "<name>'s shift is still open" and offers, for each one:

- **Count and close:** enter the counted cash and see the difference.
- **Close as not counted:** nobody counts that drawer. This is recorded under your name and the
  Owner sees it in the suspicious-activity report.

You can close the day without doing either. A shift left open carries on into the next day and is
named again at the next day-end.

The day-end report and the payments report show **Cash taken outside a shift**: how much of the
cash was taken with no shift open, so no drawer count covers it. That is normal when you do not use
shifts, and it is not treated as suspicious.

## Help

Every page has a Help button. Problems that need support: see the Owner's manual.
