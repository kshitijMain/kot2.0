# Phase 9: The QR pilot at Mannat

Approved by the Business Owner on 2026-10-31: QR ordering for one restaurant they control (Mannat,
5 tables), with the QR site and relay on a server of their own and the restaurant PC on one open
line to it. The diner's page replaces the waiter taking the order. Everything after the manager
accepts is the existing flow (KOT, stations, KDS, billing). Design:
[ADR-0024](../../adr/0024-qr-pilot-self-hosted-relay.md).

Exit: manual task 38 done at Mannat. Every step of its phone test works on mobile data, and the
manager's phone rings within 2 s of a QR order.

---

## P9-01 The relay on a server of our own, with an open line to each restaurant

Requirements: QR-006 to QR-009, SEC-005, SEC-008, NFR-A01, BRD §9.3.

Deliverables:

- `infra/supabase/src/host`: a Node host for the relay's functions; the open line (Realtime's
  Phoenix protocol, rung by `pg_notify('relay_ring')` from a trigger); menu photos on disk;
  expiry and retention jobs as a new `relay_janitor` login; settings from the environment.
- The bundle `dist/relay-host.mjs`.
- `scripts/migrate.mjs` and `scripts/provision-restaurant.mjs`.
- `infra/relay-host`: Caddy, systemd units, environment templates and `setup-ubuntu.sh`.
- `@rp/relay/testing` uses the host's own modules.
- Manual task 38.

Acceptance:

- A QR order rings its restaurant's line within a second, and no other restaurant's.
- The relay suite and the server's relay, Realtime and Phase 5 exit tests pass on the production
  modules.
- Photos are served immutable, and paths outside the folder are refused.
- An oversized body is refused before it is held.

## P9-02 The diner's phone number, on the order and the bill

Requirements: BILL-011, QR-005 (changed: the pilot asks for a phone), QR-006, ORD-014.

Deliverables:

- Setting `qr.askPhone` (OFF, OPTIONAL, REQUIRED; default OPTIONAL, REQUIRED at Mannat), published in the QR menu
  document.
- `customerPhone` on the submission, stored by the relay (migration), refused when required and
  missing, and picked up by the PC onto the order.
- The bill takes the session's latest QR phone when opened without one, with consent for the
  bill.

Acceptance: a QR order's phone is on the order, the bill and the printed invoice. A required phone
that is missing is refused by the relay.

## P9-03 The bill on the diner's phone, UPI and "I have paid"

Requirements: QR-011, BILL-011, ORD-014, NTF (service-request alerts), ADR-0023 (alert
recipients).

Deliverables:

- Settings `payments.upiId` and `payments.upiPayeeName`.
- The relay's `qr_table_bills` (migration, RLS), `PUT server/tables/:tableId/bill` and the
  diners' `GET table-bill`.
- The PC publishes the table's bill on invoice issue, settlement and void, and clears it when the
  session closes.
- A service request `PAID` from the QR page (relay and PC), alerting waiters and managers on
  duty.
- `@rp/domain` `upiPayLink`.

Acceptance:

- After the bill is printed, the diner's page shows it with the right total, and its UPI link
  carries the payee, the amount in rupees and the invoice number.
- After settlement it reads paid. The next sitting sees no bill.
- "I have paid" alerts staff.

## P9-04 The diner's page: phone first, My orders, accepted, order again, Bill tab, a nicer menu

Requirements: QR-002, QR-004, QR-007, QR-011, QR-012, MENU-012.

Deliverables:

- The QR site asks for the phone (when required) before the first order.
- Tabs: Menu, My orders, Bill.
- Plain statuses, with "Accepted" once the manager accepts.
- "Order again" for an order or a dish.
- The Bill tab: the running estimate before the bill, the printed bill, Pay with UPI (link and
  QR code), "I have paid", and paid.
- A restyled menu: restaurant header, sticky categories, dish cards.

Acceptance: unit tests for the new pieces, and the QR e2e on a phone (Pixel 7) passes, extended
for order again and the bill.

## P9-05 The manager's phone rings for QR orders

Requirements: ORD-003, ORD-004, ORD-005, WTR-004, NTF-002.

Deliverables:

- Managers may sign in on a waiter phone.
- The factory rule for orders waiting for approval names the managers on duty as well as every
  waiter. It can be changed back on the Notification rules page.

Acceptance:

- A manager is listed and signs in on a waiter phone; the Owner and kitchen still cannot.
- The approval alert reaches the managers on duty.

## P9-06 The Mannat pilot set-up and a one-Mac trial

Deliverables:

- `pilot:mannat`: the restaurant, 5 tables T1–T5 with QR codes, a menu, staff and UPI settings,
  idempotent.
- `scripts/pilot/`: start PostgreSQL, the relay host, the QR site and the server on one Mac for a
  test on the Wi-Fi, and print the tents.
- The README for both.

Acceptance: on this Mac, a QR order from the T2 code reaches the server through the relay host's
open line, is approved, and makes a KOT for table T2.

## P9-07 Reprinting the tents when the site's address changes (ngrok)

Requirements: QR-001, ONB-004 (step 10).

Context: the codes (P5-04) and their tents exist; the pilot runs the QR site behind a free ngrok
address that changes at each start, so printed tents go stale while the codes stay right.

Deliverables:

- Manage → QR codes shows the address the codes open now and says to print again when it
  changes.
- Each table's row shows its code, its link, Copy link and Print (its own tent, through the
  existing `tableIds`).
- `pilot-cli --tents-only` rewrites the tents for the current address.
- `mannat-ngrok.sh` rewrites `.pilot/mannat-tents.pdf`, warns when the address changed and says
  where to reprint; its gateway moves into `scripts/pilot/`.
- The README's reprint section and the manual test.

Acceptance:

- After a restart with a new `RP_QR_SITE_URL`, the list and the tents carry the new address with
  the same codes.
- Copy and single-table print work, with a fallback where the browser has no clipboard.

## P9-08 A diner's orders follow their number; a compact page that never drags sideways; pairing the first screen

Requirements: QR-007, QR-002, QR-012, AUTH-007, NFR-U03.

Found by the Business Owner in the pilot:

- The same number on another browser at the same table showed no orders or bill estimate.
- The menu was too large and dragged sideways.
- The POS opened by the PC's address could not be paired: the button stayed grey for a PIN, and
  no screen existed yet to make a code.

Deliverables:

- Relay: `table-orders` (by `x-rp-diner-phone`, the token's table, this sitting, at most 12
  hours); `qr_table_bills.last_closed_at`, sent by the PC with each table's bill; CORS for the
  header.
- Page: "My orders" merges the number's orders and drops earlier sittings; another number starts
  afresh.
- A compact menu:
  - only the section bar stays at the top;
  - smaller cards, a text-only list when the menu has no photos;
  - two columns on wide screens;
  - the filters' fieldset no longer widens the page;
  - the cart bar no longer covers the tabs.
- Pairing:
  - the button explains a short code or a PIN instead of staying grey;
  - an IP-opened screen says how the first one is paired;
  - `mannat-local.sh pair` prints the first screen's code from the PC.

Acceptance:

- Another phone with the same number sees the orders, and another number does not (e2e).
- After the table closes, the number sees nothing of it (integration).
- A 360 px phone never scrolls sideways, and the tabs stay tappable with a cart (e2e).

## P9-09 A menu made for the phone: sections that follow the scroll, a stepper on the card, an order tracker

Requirements: QR-002, QR-004, QR-007, MENU-002, NFR-U03.

Asked by the Business Owner: look at how the best menus and food apps present a menu, and make the
QR page as easy. What the research said (Swiggy and Zomato case studies, QR-menu guides):

- the category bar should follow the scroll;
- a dish's count should change on its card;
- dishes need a one-line description;
- bestsellers should be marked;
- the order's place should show as a delivery-style tracker;
- a sticky cart bar should show the count and the total.

Deliverables:

- Section bar: the section being read is marked, and the bar scrolls sideways to keep it in view;
  tapping one glides there (not with reduced motion).
- Each section heading says how many dishes it has.
- Dish card:
  - a dish without options turns its Add into − n + once in the order;
  - a dish with options says "n in cart" under Choose;
  - a Bestseller badge (the restaurant's tag or the recommendation engine's bestsellers).
- Cart bar: "n items · ₹ total" on the left and "View order ›" on the right, with a short pulse
  when something is added.
- My orders: a five-step tracker per order (Sent, Accepted, Cooking, Ready, Served). It takes the
  step every dish still coming has reached, and there is no tracker for an order not taken.
- Mannat's 32 dishes get a one-line description. `pilot-cli --menu-text` fills them in on a
  database set up before, and the manager then publishes the menu.

Acceptance:

- The tracker's steps for every status and dish state (unit).
- The card stepper adds and removes, the cart bar counts, and the last section is marked after
  tapping it; no serious accessibility violation (e2e).
- Every Mannat dish has a description on the QR menu (integration).
- A 360 px phone still never scrolls sideways (e2e).
