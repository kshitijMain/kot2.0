# Taking a new restaurant live

A step-by-step guide for the onboarding team: from a signed contract to a restaurant taking real
orders. It is written for people who are not technical. The technical detail sits in the other
runbooks named along the way; you only open them when a step says so.

The target (ONB-009): a restaurant with up to 150 dishes and 40 tables is working within one
business day, and its menu is loaded within an hour.

Everything in the restaurant runs on its own PC. The internet is needed only once, to activate
the PC. The menu never goes through the internet: you bring it on a USB stick as a menu file, or
type it in at the restaurant.

## 1. Before the visit: what to collect

Send the restaurant this list a week ahead, and collect everything before install day. Tick each
line.

**The business**

- [ ] Legal name, the name guests know, full address and state.
- [ ] GSTIN and FSSAI licence number (have the certificates at hand).
- [ ] Logo (a PNG or JPEG), phone number and email.
- [ ] Opening hours, and when the business day ends (04:00 unless they say otherwise).
- [ ] How invoice numbers should start (a prefix such as `INV`), and whether a service charge is
      added (it is off unless they want it).

**Taxes** (ask their accountant)

- [ ] Each tax group with its rates and SAC code, for example "GST 5 %" = CGST 2.5 % + SGST 2.5 %.
      Most restaurants have two or three. The PC never assumes a rate: the restaurant enters them.
- [ ] Whether menu prices include tax or not.

**The menu**

- [ ] The printed menu, or a photo of every page.
- [ ] For each dish: the category, the price (or a price for each size, such as Half and Full),
      veg, non-veg or egg, and which kitchen station cooks it.
- [ ] Add-on groups (for example "Roti type: Plain, Butter +₹10") and combos (for example "Veg
      Thali: dal, one bread of your choice, rice").
- [ ] Short codes for quick entry on the POS, if they use them (letters, digits and dashes, up
      to 12, for example `PT01`).
- [ ] Photos: the restaurant's own only, never pictures from the internet. Landscape, in good
      light, one dish on a plain background, JPEG, PNG, WebP or HEIF, up to 5 MB each. **Name each
      photo after the dish's short code (`PT01.jpg`) or its exact name (`Paneer Tikka.jpg`).**
      Photos from a phone gallery: copy them into one folder and rename them there.

**The kitchen and the floor**

- [ ] Kitchen stations (for example Main kitchen, Tandoor, Bar) and which printer or kitchen
      screen each one uses.
- [ ] Sections and tables: each table's number or name and seats.

**People**

- [ ] The Owner: name, and a smartphone for an authenticator app (Google Authenticator or
      similar).
- [ ] Managers (who also bill), waiters and kitchen staff: names and roles. Each person chooses their
      own PIN on the day.

**Devices**

- [ ] How many waiter phones, table tablets, kitchen screens and wrist pagers.
- [ ] Printers: model and where they go.
- [ ] A backup drive (a USB disk that stays with the PC).

**The site**: print the site-readiness checklist (Set up page, "Print the site-readiness
checklist") and go through it with the Owner: PC, UPS, staff Wi-Fi separate from guest Wi-Fi,
Wi-Fi in the kitchen and on the floor, the printer network, BitLocker.

**From the vendor**: someone with access to the vendor web app adds the restaurant and its PC
("Add PC") and gives you the **activation code** (16 letters and digits). It works once, for 7
days; if it runs out, ask for a new one ("New activation code"). See `control-plane.md`.

## 2. Preparing the menu before the visit

Preparing the menu beforehand saves most of the hour on install day. Use the team's own test PC
(any PC or laptop with the restaurant software installed); the menu is only ever on PCs, never in
the vendor's cloud.

1. On the test PC, set up the restaurant's tax groups and kitchen stations with the names the
   restaurant uses (the rates do not matter here: the restaurant's PC uses its own).
2. Manage, Menu, "Load menu file", then "Download empty menu file". You get a .zip with
   `menu.xlsx`, an empty `photos` folder and a README explaining the columns.
3. Fill `menu.xlsx` in Excel: one row per dish on the Items sheet, one row per size on
   Variants, add-on groups on Modifiers, combos on Combos. The second row of each sheet says what
   goes in each column. Put the photos in the `photos` folder. Zip the folder again.
   (For a short menu, or a few dishes, type them in instead: Manage, Menu, "Add a dish".)
4. Load the zip on the test PC ("Load menu file"). Fix every problem it lists in the sheet and
   load again until it says "Ready to add". Check that each photo went to the right dish.
5. "Add to the menu as a draft". Look at the menu check above the dishes: a dish without a
   price, station or tax group must be fixed; a dish without a photo is fine (it shows a plain
   placeholder).
6. "Export menu file". Copy that .zip to a USB stick for install day. It holds the whole menu
   with its photos; tax rates are never in it, only tax group names.

Loading the same dishes twice is refused ("is already on the menu"), so use a fresh test
restaurant for each new client, or archive the previous client's dishes first.

## 3. Install day

Allow a full day. Times are for 150 dishes, 40 tables, 8 staff and about 20 devices.

### The PC (installer, about 30 minutes)

1. Check the PC against the site-readiness checklist. Set up Windows accounts and BitLocker as in
   `windows-host.md`.
2. Run `RestaurantPlatform-Setup-<version>.exe` as an administrator. Choose the data drive it
   suggests (not the Windows drive if there is another). Wait for the finish page. Details:
   `windows-installer.md`.
3. Install the restaurant's certificate on the browsers that will open the dashboard
   (`lan-tls.md`).

### First run (Owner, 5 minutes)

The POS window opens on "Set up this restaurant PC". Enter the restaurant's name, the Owner's
name and the Owner's PIN (twice). The PC pairs itself as the first POS. The Owner signs in with
that PIN and lands on the dashboard with the Set up page waiting.

### Activation (Owner, 5 minutes, needs the internet once)

1. The Owner opens Security and sets a password and the authenticator app; they keep the
   recovery codes somewhere safe, away from the PC.
2. Set up page, "Activate this PC": the Owner types the activation code, with their password
   and authenticator code. The licence arrives within a minute.

If the page says the PC "does not know the vendor's address yet", the installer did not set it:
call support.

### The set-up steps

The Set up page lists 11 steps in order. Each opens the page that does it; progress is saved, so
you can stop and carry on later. A step is ticked when its work is done.

1. **Restaurant details** (Owner, 15 min): legal name, address, state, GSTIN, FSSAI, logo,
   contact, hours.
2. **Taxes** (Owner with their accountant, 15 min): the tax groups with their rates and SAC
   codes; prices with or without tax. Use the same tax group names as in the menu file if you
   can: it saves mapping later.
3. **Invoices** (Owner, 10 min): check the invoice series and the sample bill, then "The invoices
   look right".
4. **Owner and managers** (Owner, 15 min): the Owner's security (done above) and at least one
   manager.
5. **Floor** (manager, 30 min): sections and tables with their seats.
6. **Kitchen stations and printers** (installer, 30 min): each station, its printer or kitchen
   screen, and a test print from every printer.
7. **Menu** (manager, under an hour): see below.
8. **Staff and PINs** (manager, 20 min): everyone else, their role, their PIN and their section.
9. **Phones, tablets, kitchen screens and pagers** (installer, about 1 hour): see below.
10. **QR table tents** (manager, 20 min): see below.
11. **Go-live test** (everyone, 30 min): see below.

### Step 7: loading the prepared menu

1. Manage, Menu, "Load menu file". Choose the .zip from the USB stick. (A plain `menu.xlsx`
   also works, for a menu without photos.)
2. **Match the names to this PC.** The file names tax groups and kitchen stations. Names that
   are the same here are already chosen. For any other, choose which of this PC's tax groups or
   stations it means (for example the file's "Kitchen" is this PC's "Main kitchen"). The check
   runs again after each choice.
3. Read the check. "Ready to add" means there are no problems. Otherwise each problem names the
   sheet, row and column: fix it in the sheet and load the file again, or fix a name above.
4. Look down the dishes and the photos. Each photo says how it was matched (by short code or by
   name). Choose another dish for a photo, or "Leave this photo out".
5. "Add to the menu as a draft". Nothing reaches the phones, tablets or QR menu yet.
6. Back on the Menu page, read the menu check, then "Publish menu", check what it will change,
   and "Publish now". It then lists which devices have the menu and which get it when they
   reconnect.

No menu file? Type the dishes in on the Menu page ("Add a dish"; "Half and Full" adds both sizes
in one tap), and add photos with "Add photos in bulk" ("Choose a folder" takes a whole folder).
Then publish.

### Step 9: pairing devices

For each device: Devices page, "Pair a device", choose the type of device and give it a name
(a table tablet also gets its table, a kitchen screen its station or stations), then "Show
pairing code". On the device, open the app (or, for a kitchen screen, the dashboard address in
its browser) and scan the QR code; if it cannot scan, type the address and the code. A code that
ran out: "Get a new code".

- **Waiter phones**: set each one up so alerts ring with the screen off (`waiter-phone.md`).
- **Table tablets**: kiosk mode (`mdm-policy.md`).
- **Pagers**: Pagers page, "Register a pager" with the serial on its label, then give it to a
  waiter (`pager-firmware.md` for updates).

Check each device on the Devices page: it shows its last contact and battery.

### Step 10: QR table tents

QR codes page: choose A6 cards (one per page, for a stand) or A5 tents (fold on the dashed
line), "Download table tents (PDF)", print, and put each on its table. A copied or photographed
code can be replaced: give the table a new one and the old one stops working.

### Step 11: the go-live test

Set up page, go-live test, "Start the test". Then place one test order through each path the
restaurant uses: the POS, a waiter's phone, a table tablet, a guest's phone (QR), a kitchen
screen bump, a pager call; then bill it. Each path is ticked when the PC sees it. When all are
ticked, "The test order worked". Void the test orders with a reason, as a real mistake would be.

### Before you leave

- Backups: set the backup drive, write down the recovery key with the Owner (two safe places,
  not the PC), and take a first backup (`backups.md`).
- Training: each role from its manual (`docs/manuals/`), in parallel with steps 9 and 10 where
  you can.
- Hand the Owner `docs/manuals/owner.md` and the support contact.

## 4. Changing the menu later (the manager)

Everything is on Manage, Menu, on the restaurant's PC.

- **A dish, its price or its sizes**: "Edit" on the dish, change it, save. Then "Publish menu":
  the publish step shows exactly what changes on the devices.
- **A new dish**: "Add a dish", then publish.
- **Photos**: on the dish ("Add a photo"), or many at once with "Add photos in bulk" (choose
  photos or a whole folder; each is matched by short code or name). Then publish.
- **Out of stock**: "Stock" on the dish, or the kitchen marks it. This works at once, without
  publishing, on every device.
- **A dish no longer sold**: "Archive" (dishes are never deleted, so old bills stay correct).
- **A copy of the menu**: "Export menu file" saves the whole menu with its photos. Keep it, or
  load it on another restaurant's PC.

Changes are a draft until someone publishes; the devices keep the published menu until then.

## 5. Common problems

| Problem                                                               | What to do                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| "This is not a menu file"                                             | Choose the .zip itself (or `menu.xlsx`), not a folder or another file.                                                                        |
| The file "holds … which is neither the sheet, the README nor a photo" | Take that file out of the folder and zip it again. Only `menu.xlsx`, the README and photos may be in it.                                      |
| "A path that points outside it"                                       | The zip was made oddly. Make it again: right-click the folder, "Send to", "Compressed (zipped) folder".                                       |
| A photo "is not a photo we can use" or "larger than 5 MB"             | Save it again as JPEG, smaller (a phone's "reduce size" or any photo editor), and load the file again.                                        |
| "No tax group is called …" or "No kitchen station is called …"        | Choose the matching one under "Match the names to this PC". If this PC does not have it yet, set it up (step 2 or 6) and load again.          |
| "A price above ₹0"                                                    | A dish or a size has a price of 0 or none. Every dish needs a real price.                                                                     |
| "… is already on the menu"                                            | That dish is on this PC already. Change it in the menu editor instead, or take its row out of the sheet.                                      |
| A photo went to the wrong dish, or to none                            | Choose the dish under the photo before adding. Afterwards, change it on the dish ("Edit").                                                    |
| "The menu cannot be published until these are fixed"                  | The named dishes have no price above ₹0, no kitchen station or no tax group. Open each ("Fix" in the menu check), complete it, publish again. |
| Devices still show the old menu                                       | The menu is a draft until published: "Publish menu". A device that was off gets it when it reconnects.                                        |
| "Does not know the vendor's address yet" on activation                | The installer did not set it. Call support.                                                                                                   |
| The activation code is refused                                        | It works once and for 7 days. Ask for a new one in the vendor web app.                                                                        |
| A printer did not print the test                                      | Printing page: is it online, does it have paper, is the IP address right?                                                                     |
| A phone or tablet cannot connect                                      | Same staff Wi-Fi as the PC, the PC on, the certificate installed (`lan-tls.md`).                                                              |
| A waiter phone does not ring                                          | `waiter-phone.md`: notifications and battery settings.                                                                                        |

Anything else: `support-playbook.md`.

## 6. Timeline for one business day

For 150 dishes, 40 tables, 8 staff and about 20 devices, with the menu file prepared before the
visit (figures from `docs/build/onboarding-timing.md`):

| Time  | What                                                                       | Who                |
| ----- | -------------------------------------------------------------------------- | ------------------ |
| 09:00 | PC checks, installer, certificate                                          | Installer          |
| 09:30 | First run, Owner's security, activation                                    | Owner, installer   |
| 09:45 | Steps 1 to 4: details, taxes, invoices, managers                           | Owner              |
| 10:45 | Step 5 floor (manager) and step 6 stations and printers (installer)        | Manager, installer |
| 11:15 | **Step 7 menu: load the prepared file, map names, publish (under 1 hour)** | Manager            |
| 12:15 | Step 8 staff and PINs                                                      | Manager            |
| 12:45 | Lunch                                                                      |                    |
| 13:30 | Step 9 devices (installer) while staff are trained (2 to 3 hours)          | Installer, staff   |
| 15:30 | Step 10 QR table tents                                                     | Manager            |
| 16:00 | Step 11 go-live test, void the test orders                                 | Everyone           |
| 16:30 | Backups and the recovery key, hand-over                                    | Owner, installer   |
| 17:00 | Live                                                                       |                    |

Without a prepared file, typing in 150 dishes takes longer than an hour: prepare the menu file
before the visit whenever you can.
