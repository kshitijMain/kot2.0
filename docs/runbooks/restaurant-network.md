# The restaurant's network

How to set up the router and Wi-Fi so the restaurant PC, the kitchen screens and the staff phones
work together, and staff keep internet on their phones (P9-27).

## Who needs what

| Who                            | Needs                                   | Why                                                                                  |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------ |
| Restaurant PC                  | The router, by cable                    | Everything on the floor talks to it. Internet only for QR menu, backups, updates     |
| Kitchen screens, table tablets | The staff Wi-Fi                         | They talk to the PC                                                                  |
| Staff phones (waiter app)      | The staff Wi-Fi, and internet           | The app talks to the PC; staff use WhatsApp and calls too                            |
| Diners (QR menu)               | Internet only (their own data or guest) | The QR menu runs on the internet and reaches the PC through the relay, never the LAN |

Ordering, kitchen tickets and billing never need the internet. When it is down, only the QR menu,
cloud backups and updates wait.

## The recommended set-up: one router, two Wi-Fi networks

```
          Internet ── Router
                        ├── cable ──── Restaurant PC   (address reserved in the router)
                        ├── "<Name>-Staff" Wi-Fi  internet + reaches the PC  → staff phones, kitchen screen
                        └── "<Name>-Guest" Wi-Fi  internet only, isolated   → diners
```

1. **Connect the PC to the router with a cable.** Wi-Fi works, but a cable does not drop.
2. **Reserve the PC's address in the router** (DHCP reservation, sometimes "static lease" or
   "address binding"). The installer prints the address and says so when it was given by DHCP.
   Without a reservation the router may give the PC another address after a power cut; phones
   then find it again by themselves (below), but a fixed address is faster and surer.
3. **Staff Wi-Fi:** the router's main network, with internet. Turn **off** "AP isolation" or
   "client isolation" on it: phones must reach the PC.
4. **Guest Wi-Fi for diners:** the router's guest network, isolated, so diners can never reach the
   PC. Diners do not need it for the QR menu; it is a courtesy.

Staff phones on the staff Wi-Fi have internet and reach the PC. There is nothing to choose.

## If the restaurant has a second router or a Wi-Fi without internet

Some restaurants run the POS on a separate router with no internet. Then staff phones on it lose
internet. In order of preference:

1. **Give that Wi-Fi internet (best).** Plug the POS router's WAN/internet port into the main
   router with a cable, or switch the POS router to access-point mode (its settings call it "AP
   mode", "bridge" or "repeater"). One cable or one setting; nothing to change on the phones.
2. **Let the phone use mobile data for everything else (Android).** When the Wi-Fi has no
   internet, Android keeps it connected and sends other apps' traffic over mobile data; the
   waiter app sends its own traffic over the Wi-Fi to the PC (P9-27). On the phone: keep Wi-Fi
   on, turn on mobile data, and if Android asks "This network has no internet access. Stay
   connected?", choose **Yes** and tick **Don't ask again**. The waiter app shows a hint when
   this is the case.
3. **Staff phones on the main Wi-Fi, PC on the POS router:** only if the two routers are joined
   (1); otherwise the phones cannot reach the PC at all.

When staff phones are on a different subnet from the PC (two routers joined, each with its own
range), let the firewall admit both: run the installer with
`/STAFFSUBNET=LocalSubnet,192.168.0.0/24` (the second router's range).

## How phones find the PC

The waiter app has no address built in. In order, it uses:

1. the address that worked last time;
2. the PC's announcement on the Wi-Fi (mDNS, `_parossa-pos._tcp`): the PC answers with its
   certificate's fingerprint, and the app only accepts the PC it already trusts;
3. the **Connect QR** in Manage → Devices, scanned once on the connect screen ("Scan the code on
   the PC"): the PC's addresses and its certificate's fingerprint, nothing secret;
4. the addresses a pilot build was made with, if any.

When the PC gets a new address, the app finds it again by its announcement and keeps working. The
PC's certificate follows a new address within a minute, without a restart.

The installer chooses the network staff phones use (the adapter with the internet gateway,
leaving out VPNs, virtual machines and Bluetooth), or the one given with `/LANINTERFACE=Wi-Fi`.
Its address goes first in the Connect QR. The firewall admits the server's HTTPS port, the
pagers' MQTT port and mDNS (UDP 5353) from the staff network only.

## Checking it

1. At the end of the installation, the log says which network staff phones use, the address to
   reserve, and an address to open on a staff phone: `https://<address>:8080`. The phone shows a
   certificate warning (the PC's own certificate); that is expected in a browser, and proves the
   phone reaches the PC.
2. On a staff phone on the staff Wi-Fi, open the waiter app: it connects without anything typed.
3. Manage → Devices shows "This PC announces itself on the Wi-Fi" and the Connect QR.
4. With a Wi-Fi without internet: the phone still opens WhatsApp over mobile data and the waiter
   app keeps working.
