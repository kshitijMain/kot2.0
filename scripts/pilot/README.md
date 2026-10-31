# scripts/pilot: the QR pilot at Mannat on one computer

Runs everything for Mannat's QR ordering on one Mac (or Linux PC), so it can be tried on the
restaurant's Wi-Fi before the cloud server exists (P9-06,
[ADR-0024](../../docs/adr/0024-qr-pilot-self-hosted-relay.md)). For the real pilot the QR site and
relay move to your server ([manual task 38](../../manual-tasks/38-qr-pilot-server.md)); the KOT
server stays on the restaurant PC.

```sh
scripts/pilot/mannat-local.sh setup     # once (about 3 minutes)
scripts/pilot/mannat-local.sh start
scripts/pilot/mannat-local.sh status
scripts/pilot/mannat-local.sh stop
scripts/pilot/mannat-local.sh reset     # delete everything set up here and start again
```

Needs Docker (for PostgreSQL 16), Node 24 and pnpm (`corepack enable`). Optional:

- `PILOT_UPI_ID=yourbusiness@bank` before `setup`: the restaurant's **business** UPI ID, for Pay on
  the bill. UPI apps may decline amount-filled links to a personal UPI ID. It can also be set
  later in Manage → Settings → Payments.
- `PILOT_IP=192.168.x.y`: this computer's Wi-Fi address, if the script guesses wrong.

## What `setup` makes

| What                          | Where                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| Mannat: 5 tables, menu, staff | The KOT server's database (`rp_mannat`)                       |
| Each table's QR address       | `.pilot/mannat.txt`                                           |
| The 5 table tents (A5 PDF)    | `.pilot/mannat-tents.pdf`: print, fold, one per table         |
| The relay and Mannat in it    | `rp_relay`, with the PC's credential stored in the KOT server |

Staff and their first PINs: Owner 1111, Manager 2222, Waiter 1 4444, Waiter 2 5555, Kitchen 6666.
Change them in Manage → Staff before real service.

## Trying it

1. `start`, then open the POS on this computer: `https://<this computer's IP>:8080`. The browser
   warns about the restaurant's own certificate; continue. Press **Pair this PC** and sign in as
   **Manager** (2222).
2. On a phone on the same Wi-Fi, scan table 2's tent (or open its address from `mannat.txt`).
   Mannat's page asks for a mobile number, then shows the menu.
3. Add dishes and send. The order appears on the POS under **Order to approve** within a second.
   The manager's phone rings too if it is paired (step 5). Press **Approve**: table 2 opens, the
   kitchen gets the KOT (**Kitchen display**), and the diner's page says it is accepted.
4. On the phone: **My orders** → **Order again**; **Bill** → **Ask for the bill**. On the POS:
   table 2 → **Bill** → **Print bill**. The phone shows the bill with **Pay with UPI** (when a UPI
   ID is set) and **I have paid**.
5. The manager's phone: install the waiter app, pair it from **Manage → Devices → Pair a
   device**, and sign in as Manager. Every QR order then rings it, to accept or reject at the
   table.

This runs over plain http on the Wi-Fi: fine for a trial, never for diners on mobile data. The
real pilot uses your server's https address.
