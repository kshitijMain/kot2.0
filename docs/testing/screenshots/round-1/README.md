# Screenshots: fixes from testing, round 1 (ADR-0030)

Taken on 2026-11-14 from the development seed, in Chromium: the dashboard at 1440 px wide, the
waiter app in a phone's browser (412 px, Android size). Waiter Ravi asked for table 1's bill and a
takeaway's bill; manager Vikram took table 6's order from Take order and printed its bill.

Manager dashboard:

- `manager-bills-pending.png`: Bills → Pending (the default), with the count beside Bills: a table
  and a takeaway whose bills were asked for, a table printed and not paid.
- `manager-bills-history.png`: Bills → History, the bills already printed, by date.
- `manager-bills-pending-phone.png`: the same Pending list on a phone.
- `manager-take-order.png`: Take order, dine-in only: the tables by floor area.
- `manager-take-order-open.png`: opening a free table: how many guests.
- `manager-take-order-table.png`: the table's order: dishes, sizes, add-ons, notes, Send to kitchen.
- `manager-tables.png`: Tables, read-only: guests, time seated, who opened it, amount; Open bill.

Waiter app:

- `waiter-home.png`: the home screen with Signed in as and Sign out in view.
- `waiter-request-bill.png`: a table after Request bill for this table: "Bill requested at 21:23".
- `waiter-takeaway-new.png`: a new takeaway: dish, customer name and phone.
- `waiter-takeaway-bill-requested.png`: the open takeaway (Takeaway #1) after Request bill.
