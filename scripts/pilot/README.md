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
scripts/pilot/mannat-local.sh fresh     # clear orders, KOTs, approvals; keep QR codes and devices
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

## Signing in: PIN only (no pairing codes)

The pilot runs with `RP_AUTH_PIN_ONLY=1` (ADR-0025, set by `setup`; `mannat-ngrok.sh` adds it to a
pilot set up earlier). Any browser on this Mac or its Wi-Fi opens the console and goes straight to
the staff tiles; pick a name and enter the PIN. No `/pair`, no codes from Manage → Devices.

| Person   | PIN  | Lands on                 |
| -------- | ---- | ------------------------ |
| Owner    | 1111 | Manager dashboard        |
| Manager  | 2222 | Manager dashboard        |
| Waiter 1 | 4444 | POS                      |
| Waiter 2 | 5555 | POS                      |
| Kitchen  | 6666 | Kitchen display (`/kds`) |

Each browser (or Incognito window) becomes a "Browser N" device; unpair old ones in Manage →
Devices. Never set the flag on a real restaurant's installation.

## The waiter app on a phone (APK built on this Mac)

Nobody pairs a phone (ADR-0025, 2026-11-01). The app is built with this Mac's address and its
certificate's fingerprint, and connects by itself; staff only tap their name and type their PIN.
Build it with the pilot server running (Android SDK in `~/Library/Android/sdk`; a few minutes):

```bash
scripts/pilot/build-waiter-apk.sh                 # the address in .pilot/server.env
scripts/pilot/build-waiter-apk.sh 192.168.1.20    # or another address of this Mac
```

Build it again whenever the Mac's Wi-Fi address changes. (If the address changed and the app was
not rebuilt, the app says it cannot connect and takes the new address in **Restaurant PC
address**.)

It is "Parossa Captain (preview)" (`in.rp.waiter.preview`), signed with the debug key, so it is
installed directly, not from the Play Store. Over USB:
`~/Library/Android/sdk/platform-tools/adb install -r .pilot/apk/parossa-waiter-preview.apk`.
Or on this Wi-Fi:

```bash
python3 -m http.server 8099 --directory .pilot/apk    # stop with Ctrl-C when done
```

then open `http://<this Mac's IP>:8099/parossa-waiter-preview.apk` on the phone. Open the app: it
connects to the restaurant PC by itself. Sign in with a PIN. A manager signed in on it takes payment
for a printed bill.

## Trying it

1. `start`, then open `https://<this computer's IP>:8080` (or `https://localhost:8080` on this
   computer) in any browser on the Wi-Fi. The browser warns about the restaurant's own
   certificate; continue. It connects by itself (PIN-only, no code); sign in as **Manager** (2222).
   Every other browser and phone connects the same way: nobody pairs a device.

2. On a phone on the same Wi-Fi, scan table 2's tent (or open its address from `mannat.txt`).
   Mannat's page asks for a mobile number, then shows the menu.
3. Add dishes and send. The order appears on the POS under **Order to approve** within a second.
   The manager's phone rings too if the waiter app is on it (step 5). Press **Approve**: table 2 opens, the
   kitchen gets the KOT (**Kitchen display**), and the diner's page says it is accepted.
4. On the phone: **My orders** → **Order again**; **Bill** → **Ask for the bill**. On the POS:
   table 2 → **Bill** → **Print bill**. The phone shows the bill with **Pay with UPI** (when a UPI
   ID is set) and **I have paid**.
5. The manager's phone: install the waiter app (above); it connects by itself. Sign in as
   Manager. Every QR order then rings it, to accept or reject at the table.

This runs over plain http on the Wi-Fi: fine for a trial, never for diners on mobile data. The
real pilot uses your server's https address.

## A diner's orders follow their number

"My orders" and the bill's estimate come from the diner's mobile number, not the browser: scan
the table's code again (another browser, another phone) and give the same number, and the
orders that number placed at that table during this sitting are there. A different number sees
none; the same number at another table sees none; and once the table is settled and closed, the
next party never sees the earlier one's orders, even with the same number (orders older than 12
hours are never shown either).

## Dish descriptions on a pilot set up before P9-09

Since P9-09 the set-up gives every dish a one-line description. On a database set up before that:

```bash
(set -a; source .pilot/server.env; set +a; node apps/server/dist/database/pilot-cli.js --menu-text)
```

Then publish the menu on the POS (Manage → Menu → Publish). The QR page shows the descriptions
within a minute.

## Over ngrok (phones on mobile data)

`scripts/pilot/mannat-ngrok.sh` puts the relay and the QR site behind one public ngrok address
(`scripts/pilot/ngrok-gateway.mjs` sends `/functions`, `/realtime`, `/storage` and `/healthz` to
the relay and everything else to the site), sets `RP_QR_SITE_URL` and `RP_RELAY_URL` to it and
restarts the three services. Needs `ngrok` signed in, and `setup` done once.

## When the site's address changes, print the tents again

A table's QR code is the same whatever the address (`/t/<code>`), but a printed tent holds the
whole address it was printed with. A free ngrok address changes each time ngrok starts, and the
Wi-Fi trial uses the Mac's address, so tents printed before a change open the old address.

- `mannat-ngrok.sh` rewrites `.pilot/mannat-tents.pdf` for the address it starts, and says when
  the address changed since the last tents.
- On the POS, **Manage → QR codes** always shows the address the codes open now, every table's
  code and link, and prints the tents for that address: **Download table tents** for all, or
  **Print** on one table's row (after a tent is lost or spilled on). **Copy link** gives a
  table's link to send or test.
- **New code** is only for a code that must stop working (copied or photographed); a new address
  never needs new codes.
- Without ngrok: `node apps/server/dist/database/pilot-cli.js --tents-only --site <address>
--tents tents.pdf` (with `.pilot/server.env` loaded) writes the same PDF.

## Manual test: Mannat over ngrok

1. `scripts/pilot/mannat-ngrok.sh`. Note the public address it prints, and that it says the
   tents were rewritten for it.
2. On the POS (`https://<Mac>:8080`, Manager 2222), open **Manage → QR codes**:
   - the notice says the codes open the ngrok address;
   - each of tables 1 to 5 shows its code and a link starting with that address.
3. **Copy link** on table 2 and paste it in a note: it is the ngrok address `/t/…`.
4. Choose **A5 tents**, then **Print** on table 2's row: the PDF has one page, for table 2.
5. On a phone on **mobile data**, scan that page's code: Mannat opens at table 2. Order, and
   approve it on the POS.
6. Stop ngrok and run `mannat-ngrok.sh` again (a new free address). The script warns that the
   address changed. Manage → QR codes shows the new address. The old printout opens the old
   address; the new **Download table tents** opens the new one.
