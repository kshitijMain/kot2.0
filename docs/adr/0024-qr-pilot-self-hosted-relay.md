# ADR-0024: QR pilot: the relay on a server of our own, an open line to each restaurant, the diner's bill and UPI

Status: Accepted
Date: 2026-10-31
Work package: P9-01 to P9-06 (Phase 9, the QR pilot at Mannat)
Requirements: QR-001 to QR-013, ORD-003, ORD-005, ORD-013, ORD-014, BILL-011, SEC-005, SEC-008,
NFR-A01, WTR-004, BRD §9.3, §13

## Context

The Business Owner approved (2026-10-31) the architecture for a QR ordering pilot at one
restaurant they control, Mannat, with 5 tables:

- Option B of the proposal: the QR site and the relay on one server of our own (an Oracle VM, say),
  not on Supabase. The restaurant PC stays the system of record and is never reachable from the
  internet (SEC-008).
- The PC keeps **one open line** to that server, and each QR order is pushed down it at once,
  instead of the PC asking every few seconds. Many restaurants should share one server cheaply.
- The diner's page replaces the waiter taking the order: scan, order, see "accepted" once the
  manager accepts it, follow the dishes, order again, ask for the bill, and pay it by UPI with the
  amount filled in. The diner's phone number is taken at the start and printed on the bill.
- A manager is alerted on their phone and accepts or rejects each QR order (ORD-003).

The relay (ADR-0015) was written as plain Fetch API handlers on a two-method database interface,
tested on Node and plain PostgreSQL, with Supabase objects used only when present. Its tests
already ran a stand-in for Realtime that speaks the Phoenix protocol the PC's doorbell
(`RelayRealtime`, P5-03d) uses.

## Decision

### The relay host (P9-01)

- `infra/supabase/src/host` is a production Node host for the same functions:
  - `/functions/v1/<name>`: the functions, unchanged;
  - `/realtime/v1/websocket`: the open line;
  - `/storage/v1/object/public/menu-photos/...`: photos from disk;
  - `/healthz`.

  The paths are Supabase's, so `RP_RELAY_URL` and the PC's code do not change.

- The build bundles it into one file, `dist/relay-host.mjs`, run by systemd behind Caddy (HTTPS).
- `@rp/relay/testing` now uses the host's own listener, database adapter and line, so every relay
  and server test exercises the production code.
- The test stand-in for Realtime is removed.

### The open line

- Migration `20261031100000_self_hosted_relay` adds `relay.ring()`, an AFTER INSERT trigger on
  `qr_orders` and `qr_service_requests` that sends `pg_notify('relay_ring', ...)`. The payload
  carries the id, tenant, table and status only.
- The host LISTENs on one connection for every restaurant. It passes each ring, after commit,
  only to sockets whose token (signed by `server/session`, role `relay_server`, HS256, one hour)
  names that restaurant.
- The PC is unchanged:
  - it joins its doorbell;
  - picks up within ~100 ms of a ring through `server/orders`, the one trusted way in;
  - heartbeats every 25 s;
  - checks every 60 s as a safety net, and every 5 s while the line is down.
- Costs:
  - one socket per restaurant;
  - one heartbeat per 25 s per restaurant;
  - one NOTIFY per order;
  - no polling load while the line works.
- Lines that stop answering pings are dropped. Messages are capped at 16 KB, with at most 4
  channels a socket.
- On Supabase nobody LISTENs; the NOTIFY costs next to nothing there.

### Jobs and logins

- Expiry (every minute) and retention (hourly) run in the host where there is no pg_cron, as a
  new login `relay_janitor` that may execute `relay.expire_orders` and `relay.purge` and nothing
  else.
- Migrations run as the database superuser (`scripts/migrate.mjs`), as on Supabase.
- Requests run as `relay_edge`. Restaurants are added with `scripts/provision-restaurant.mjs` as
  `relay_control_plane`.
- Request bodies over 9 MB are refused before they are held in memory.

### The diner's phone (P9-02)

- The published menu says whether the page asks for a phone number:
  `QrMenuDocument.phone: OFF | OPTIONAL | REQUIRED`, from the setting `qr.askPhone`, default
  `OPTIONAL` (the Mannat pilot sets `REQUIRED`). The relay refuses an order without one when it is required.
- The number is a 10-digit Indian mobile, stored as `+91XXXXXXXXXX`.
- The page states the purpose ("printed on your bill") next to the field. Giving it there is the
  diner's consent for that purpose (BILL-011), recorded with the words shown.
- The PC keeps it on the order. When the table's bill is opened, the latest QR phone of the
  session goes on the bill, unless the bill already has one, and so onto the invoice.

### The bill on the diner's phone, and UPI (P9-03)

- When the table's bill is printed (invoice issued), settled, voided or the table closes, the PC
  publishes the table's bill to the relay (`PUT server/tables/:tableId/bill`) or clears it.
- The relay keeps one current bill per table, read by `GET table-bill` with the table's code.
  Diners at the next sitting never see an earlier bill.
- The bill lists the invoice number, lines, taxes, round-off, the total in paise and its status,
  with the restaurant's UPI details: settings `payments.upiId` and `payments.upiPayeeName`.
- The page offers "Pay ₹X with UPI":
  - a `upi://pay` link with the payee, the amount, `INR` and the invoice number filled in (NPCI's
    deep-link format), which any UPI app on the phone opens with the amount filled;
  - the same as a QR code for paying from another phone.
- Payment is not verified automatically (BRD decision Q4: no payment integration).
  - The diner presses "I have paid", which raises a service request `PAID` to the waiters and
    managers on duty.
  - Staff check their UPI app and record the payment at the POS as UPI, as they do today.
- Asking for the bill stays the existing BILL request (QR-011), to all waiters and managers on
  duty (ADR-0023).

### The diner's page (P9-04)

- Three tabs: Menu, My orders, Bill. The status reads:
  - "Waiting for the restaurant to accept your order";
  - "Accepted: your order is with the kitchen" with each dish's state;
  - or the rejection reason.
- "Order again" puts an earlier order's dishes, or one dish, back in the cart. The server prices
  them again (ORD-014).
- The phone number is asked once per browser and table session, before the first order.

### The manager's phone (P9-05)

- A manager may sign in on a waiter phone (`SIGN_IN_ROLES.WAITER_PHONE` gains MANAGER),
  reversing the 2026-10-25 waiters-only rule for this purpose.
- Customer-order approvals alert the managers on duty as well as the waiters, so the manager's
  phone rings for every QR order. The setting `qr.approvalAlerts` (default `WAITERS_AND_MANAGERS`)
  lets the restaurant go back to waiters only.

### The pilot set-up (P9-06)

- `pnpm --filter @rp/server pilot:mannat` sets up Mannat on a development database:
  - the restaurant, 5 tables T1 to T5 with QR codes, a North Indian menu;
  - staff: a manager and two waiters;
  - the UPI settings.
- `scripts/pilot/` runs everything on one Mac for a test on the restaurant's Wi-Fi before the
  server exists, and prints the 5 tents.

## Alternatives considered

- **Supabase as built (Option A).** No code, but the owner chose not to depend on it. The
  Supabase entries stay, and going back is a deployment change.
- **A tunnel into the PC (Option C).** It puts the kitchen PC within reach of the internet
  (waives SEC-008), and the cloud still needs a menu cache for read-only mode. Rejected.
- **Polling only.** It already works, but the owner wants instant pickup. A ring costs less than
  polling for many restaurants.
- **A new line protocol of our own.** It would need new client code on the PC. Speaking the
  Phoenix subset the PC already uses keeps the PC unchanged and tested.
- **Long-poll or SSE from the PC.** Same costs as the WebSocket, but new client code.
- **A payment gateway (Razorpay, Cashfree) with automatic confirmation.** It needs a merchant
  account, KYC and webhooks into a PC that takes no inbound connections. A UPI intent with staff
  confirming is what small restaurants use today. A gateway can come later behind the same
  "Pay" button.

## Consequences

- One server holds every restaurant's QR ordering. If it is down, QR ordering is read-only or
  unavailable, and nothing else in the restaurant is affected (NFR-A01). For more than a pilot it
  needs backups of nothing but its configuration (the relay is a temporary queue), monitoring of
  `/healthz`, and a second server.
- The relay now stores a table's current bill and the diner's phone (both purged with the
  orders, BRD §9.3) in addition to orders.
- New manual task 38 (the server) replaces tasks 20 and 21 for the pilot.
