# scripts/pilot: the QR pilot at Parosaa on one computer

Runs everything for Parosaa's QR ordering on one computer (Windows with WSL, a Mac or Linux), so it
can be tried on the restaurant's Wi-Fi before the cloud server exists (P9-06,
[ADR-0024](../../docs/adr/0024-qr-pilot-self-hosted-relay.md)). For the real pilot the QR site and
relay move to your server ([manual task 38](../../manual-tasks/38-qr-pilot-server.md)); the KOT
server stays on the restaurant PC.

A step-by-step guide for a non-technical person is in
[docs/guides/run-and-test-pilot.md](../../docs/guides/run-and-test-pilot.md) (and its PDF;
`node scripts/pilot/guide-to-pdf.mjs` rebuilds the PDF).

```sh
scripts/pilot/parosaa-local.sh setup     # once, and after the code changes (keeps the test data)
scripts/pilot/parosaa-local.sh start
scripts/pilot/parosaa-local.sh restart
scripts/pilot/parosaa-local.sh status
scripts/pilot/parosaa-local.sh doctor    # checks everything a test needs, says what to fix
scripts/pilot/parosaa-local.sh links     # each table's address as it is now
scripts/pilot/parosaa-local.sh wifi      # ends ngrok and follows a new Wi-Fi address
scripts/pilot/parosaa-local.sh printer virtual   # or folder, or stop (the switch is remembered)
scripts/pilot/parosaa-local.sh ports     # WSL: copies wsl-ports.ps1 to Windows and says how to run it
scripts/pilot/parosaa-local.sh stop      # everything, ngrok and the database too
scripts/pilot/parosaa-local.sh fresh     # DELETES orders, KOTs, approvals; keeps QR codes and devices
scripts/pilot/parosaa-local.sh reset     # DELETES everything set up here
```

Every `start` writes `.pilot/server.env` and the addresses in `.pilot/relay-host.env` afresh from
what is remembered: the Wi-Fi address (`.pilot/pilot-ip`), the printer switch
(`.pilot/printer-mode`) and whether ngrok is carrying the pilot now (asked of ngrok itself). Edits
to those two files do not last; change the settings with the commands above.

Needs Docker (for PostgreSQL 16), Node 24 and pnpm (`corepack enable`). Optional:

- `PILOT_UPI_ID=yourbusiness@bank` before `setup`: the restaurant's **business** UPI ID, for Pay on
  the bill. UPI apps may decline amount-filled links to a personal UPI ID. It can also be set
  later in Manage → Settings → Payments.
- `PILOT_IP=192.168.x.y` before `setup`: this computer's Wi-Fi address, if the script guesses wrong.
  `setup` and `wifi` remember it. On WSL the script asks Windows for it.

## What `setup` makes

| What                           | Where                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| Parosaa: 5 tables, menu, staff | The KOT server's database (`rp_parosaa`)                      |
| Each table's QR address        | `.pilot/parosaa.txt`                                          |
| The 5 table tents (A5 PDF)     | `.pilot/parosaa-tents.pdf`: print, fold, one per table        |
| The relay and Parosaa in it    | `rp_relay`, with the PC's credential stored in the KOT server |

Staff and their first PINs: Owner 1111, Manager 2222, Waiter 1 4444, Waiter 2 5555, Kitchen 6666.
Change them in Manage → Staff before real service.

## Signing in: PIN only (no pairing codes)

The pilot runs with `RP_AUTH_PIN_ONLY=1` (ADR-0025, set by `setup`; `parosaa-ngrok.sh` adds it to a
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

## The waiter app on a phone (APK built on this computer)

Nobody pairs a phone (ADR-0025, 2026-11-01). The app is built with this Mac's address and its
certificate's fingerprint, and connects by itself; staff only tap their name and type their PIN.
Build it with the pilot server running. On a Mac the Android SDK is in `~/Library/Android/sdk`; on
Linux or WSL, `scripts/pilot/build-waiter-apk.sh install-tools` puts Java and the SDK in `~/Android`
once:

```bash
scripts/pilot/build-waiter-apk.sh                 # the address the pilot remembers
scripts/pilot/build-waiter-apk.sh 192.168.1.20    # or another address of this computer
```

Build it again whenever the Wi-Fi address changes. (If the address changed and the app was
not rebuilt, the app says it cannot reach the old address and takes the new one in **Restaurant PC
address**.)

The build refuses addresses no phone can reach (WSL's own `172.x`, `127.x`, `localhost`) and an
address the server's certificate does not cover, and says what to do (ADR-0032). `parosaa-local.sh
doctor` checks the app built in `.pilot/apk` against the running server: its address, and whether
its certificate is still the server's. When the app says the PC's certificate has changed (after
`reset`), scan the Connect QR in **Manage → Devices**; no reinstall is needed. To send the exact
error, `scripts/pilot/build-waiter-apk.sh log` saves the phone's log over USB (`waiter-log.txt`,
also in Windows Downloads under WSL). Under WSL the phone cannot find the PC by itself (mDNS does
not cross WSL's network): the built-in address and the Connect QR are the ways in.

It is "Parosaa Captain (preview)" (`in.rp.waiter.preview`), signed with the debug key, so it is
installed directly, not from the Play Store. Over USB:
`~/Library/Android/sdk/platform-tools/adb install -r .pilot/apk/parosaa-waiter-preview.apk`.
Or on this Wi-Fi:

```bash
python3 -m http.server 8099 --directory .pilot/apk    # stop with Ctrl-C when done
```

then open `http://<this Mac's IP>:8099/parosaa-waiter-preview.apk` on the phone. Open the app: it
connects to the restaurant PC by itself. Sign in with a PIN. A manager signed in on it takes payment
for a printed bill.

## Trying it

1. `start`, then open `https://<this computer's IP>:8080` (or `https://localhost:8080` on this
   computer) in any browser on the Wi-Fi. The browser warns about the restaurant's own
   certificate; continue. It connects by itself (PIN-only, no code); sign in as **Manager** (2222).
   Every other browser and phone connects the same way: nobody pairs a device.

2. On a phone on the same Wi-Fi, scan table 2's tent (or open its address from `parosaa.txt`).
   Parosaa's page asks for a mobile number, then shows the menu.
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

## Backups on a Mac without PostgreSQL

The server's backups run `pg_dump`, `pg_restore` and `psql`. A Mac with no PostgreSQL 16 installed
uses the wrappers in `pg-bin/`: they run the same commands inside the pilot's database container
(`rp-pilot-pg`, or `RP_PG_CONTAINER`). Both pilot scripts pass `RP_PG_BIN=scripts/pilot/pg-bin` to
the server, so Manage → System → "Back up now" works with only Docker.

## Prints saved in a folder (test only)

With no printer on this computer, the pilot saves every print (KOT, bill, reprint, test page) in
`.pilot/printouts/` instead: a `.txt` with what the slip says and a `.bin` with the printer's own
bytes. `parosaa-local.sh printer virtual` stops that: the server then prints for real, to whatever
Manage → Kitchen and printers names (the virtual printer on `127.0.0.1:9100`, or a real printer).
`printer folder` goes back.

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

`scripts/pilot/parosaa-ngrok.sh` puts the relay and the QR site behind one public ngrok address
(`scripts/pilot/ngrok-gateway.mjs` sends `/functions`, `/realtime`, `/storage` and `/healthz` to
the relay and everything else to the site) and restarts the three services with it. Needs `setup`
done once, `parosaa-ngrok.sh install` and `parosaa-ngrok.sh token <token>` once.
`parosaa-ngrok.sh stop` ends it and puts the Wi-Fi addresses back.

## When the site's address changes, print the tents again

A table's QR code is the same whatever the address (`/t/<code>`), but a printed tent holds the
whole address it was printed with. A new ngrok address or a new Wi-Fi address means tents printed
before the change open the old address.

- `parosaa-local.sh` rewrites `.pilot/parosaa-tents.pdf` whenever the address changes, and says so.
- On the POS, **Manage → QR codes** always shows the address the codes open now, every table's
  code and link, and prints the tents for that address: **Download table tents** for all, or
  **Print** on one table's row (after a tent is lost or spilled on). **Copy link** gives a
  table's link to send or test.
- **New code** is only for a code that must stop working (copied or photographed); a new address
  never needs new codes.
- Without ngrok: `node apps/server/dist/database/pilot-cli.js --tents-only --site <address>
--tents tents.pdf` (with `.pilot/server.env` loaded) writes the same PDF.

## Manual test: Parosaa over ngrok

1. `scripts/pilot/parosaa-ngrok.sh`. Note the public address it prints, and that it says the
   tents were rewritten for it.
2. On the POS (`https://<this computer>:8080`, Manager 2222), open **Manage → QR codes**:
   - the notice says the codes open the ngrok address;
   - each of tables 1 to 5 shows its code and a link starting with that address.
3. **Copy link** on table 2 and paste it in a note: it is the ngrok address `/t/…`.
4. Choose **A5 tents**, then **Print** on table 2's row: the PDF has one page, for table 2.
5. On a phone on **mobile data**, scan that page's code: Parosaa opens at table 2. Order, and
   approve it on the POS.
6. Stop ngrok and run `parosaa-ngrok.sh` again. If ngrok gave a new address, the script says so and
   Manage → QR codes shows the new address. The old printout opens the old
   address; the new **Download table tents** opens the new one.
