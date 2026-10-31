# 38. Put the QR site and relay on your own server (the Mannat pilot)

**Why:** for the QR pilot, the menu site diners open and the relay that passes their orders to the
restaurant PC run on a server you own, not on Supabase (ADR-0024). Claude built and tested
everything. Creating the server, the domain and the restaurant's credential needs you.

**Work packages:** P9-01 (server), P9-06 (pilot set-up). Replaces tasks 20 and 21 for the pilot.

**You need:**

- About 45 minutes.
- A domain you control, e.g. `mannat.in`; the site will be `menu.mannat.in`.
- An Oracle Cloud account. Any Ubuntu 24.04 server with a public IP works the same.

Never paste a password, key or credential into a Claude session, a chat or a commit.

## 0. (Optional) Try it on the restaurant's Wi-Fi first

Everything also runs on one Mac or PC, with no server and no domain: see
[`scripts/pilot/README.md`](../scripts/pilot/README.md). It sets up Mannat with its 5 tables,
prints the tents and starts everything, so phones on the same Wi-Fi can order.

## 1. Create the server

1. Oracle Cloud → Compute → Instances → **Create instance**.
   - Region: **India West (Mumbai)** or **India South (Hyderabad)**.
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Ampere VM.Standard.A1.Flex**, 1 OCPU, 6 GB. It is in the Always Free allowance.
     Upgrade the account to Pay As You Go: it stays free within the allowance, and Oracle does
     not reclaim the instance for being idle.
   - Add your SSH public key.
2. In the instance's **Virtual cloud network → Security list**, add ingress rules for TCP ports
   **80** and **443** from `0.0.0.0/0`. Port 22 is there already; limit it to your own IP if you
   can.
3. Note the instance's **public IP**.

## 2. Point the domain at it

At your DNS provider, add an **A record**: `menu` → the public IP. Wait until
`nslookup menu.mannat.in` answers with that IP (minutes to an hour).

## 3. Install

```sh
ssh ubuntu@<public IP>
sudo git clone https://github.com/kshitijMain/kot2.0.git /opt/rp   # or copy the repository there
sudo bash /opt/rp/infra/relay-host/setup-ubuntu.sh menu.mannat.in
```

It ends with `{"ok":true,"restaurantsOnLine":0}` and the next command to run. Open
`https://menu.mannat.in/` in a browser: a page with a padlock (a "not found" page is right, since no
table is given).

## 4. Add Mannat and get its credential

```sh
sudo bash -c 'set -a; . /etc/rp-relay/provision.env; node /opt/rp/infra/supabase/scripts/provision-restaurant.mjs --name "Mannat"'
```

It prints a long credential **once**. Copy it straight into step 5 and nowhere else.

## 5. Connect the restaurant PC

On the restaurant PC, first set up Mannat if it is a fresh install:

```sh
pnpm --filter @rp/server pilot:mannat --site https://menu.mannat.in --tents tents.pdf --upi-id <business UPI ID>
```

It prints the first PINs and the 5 tables' QR addresses, and writes the tents to print. Then:

1. In the server's `.env`, set:

   ```
   RP_RELAY_URL=https://menu.mannat.in/functions/v1
   RP_QR_SITE_URL=https://menu.mannat.in
   ```

2. Store the credential:

   ```sh
   pnpm --filter @rp/server relay:credential    # paste the credential, then Ctrl-D
   ```

3. Restart the server.
4. Open **Manage → System**. Within a minute the QR relay shows connected, with the open line on.
   On the server, `curl -s http://127.0.0.1:8787/healthz` shows `"restaurantsOnLine":1`.
5. Open **Manage → QR codes** and print the 5 tents (A6 cards or A5 tents).

## 6. Test with a phone (mobile data, not the restaurant Wi-Fi)

1. Scan the T1 tent. Mannat's menu opens for "Table T1" and asks for your mobile number.
2. Order two dishes.
   - The manager's phone (waiter app) rings within a second or two: "Table T1 ordered...".
   - The diner's page says it is waiting for the restaurant.
3. Accept on the manager's phone.
   - The diner's page says "Accepted".
   - The KOT prints and appears on the KDS.
4. Press **Order again** on the order, add a naan and send it.
5. Press **Ask for the bill**. Print the bill at the POS.
   - The diner's Bill tab shows it with your number on it.
   - **Pay with UPI** opens your UPI app with the amount filled in. Cancel in the UPI app if you
     do not want to pay.
6. Press **I have paid**. Staff are alerted. Record the payment at the POS as UPI and settle.
   - The Bill tab says paid.
7. Scan the T3 tent on another phone. It shows Table T3, and nothing of T1's orders or bill.

## Results to report back

```
QR pilot server
- Provider / region / shape: ______
- Address: https://______        SSL padlock: yes/no
- healthz restaurantsOnLine after the PC connected: __
- Steps 6.1–6.7 worked: __ __ __ __ __ __ __   (note any that did not)
- Time from "Send order" to the manager's phone ringing: about __ s
```
