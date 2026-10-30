# Manual test checklist

Everything the audit could not check by itself, because it needs real phones, tablets, printers,
Wi-Fi, a Windows PC or real cloud hosting. Work through it on a test set-up (never a live
restaurant), tick **Pass** or **Fail** and write what you saw. Where a step needs more detail, the
procedure in `manual-tasks/` is named.

**Before you start:** a Windows PC with the installer of the build under test; two Android phones
with the waiter app; one Android tablet with the table-tablet app in kiosk mode; one network
receipt printer (and a USB one if you use them); a second PC or laptop for the browser; the staff
Wi-Fi; a test menu with at least one dish in Hindi, one with an add-on group and one with Half/Full
sizes; staff with PINs for Owner, two Managers, two Waiters and Kitchen.

| Mark | Meaning                                  |
| ---- | ---------------------------------------- |
| ☐    | Not done yet                             |
| ✅   | Pass: the result was exactly as expected |
| ❌   | Fail: write what happened                |

---

## 1. Restaurant PC and installer

Detailed procedures: `manual-tasks/14-windows-installer.md`, `35-windows-host-checks.md`.

| #   | Steps                                                                                                  | Expected                                                                                      | Pass/Fail | Notes |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------- | ----- |
| 1.1 | Install on a clean Windows 11 PC. Restart the PC.                                                      | The server starts by itself; the POS window opens; no error dialogs.                          | ☐         |       |
| 1.2 | Pull the network cable from the PC for 10 minutes while taking an order and a cash payment at the POS. | Orders, kitchen slips, bills and payments all work; only cloud items (QR, backup) say paused. | ☐         |       |
| 1.3 | In Task Manager, end the server process while a bill is being paid. Wait one minute.                   | The server restarts by itself; the payment is either fully recorded or not at all.            | ☐         |       |
| 1.4 | Fill the data drive until less than 1 GB is free, then take an order and run a backup.                 | Orders still work; the backup fails with a clear "disk nearly full" alert to the manager.     | ☐         |       |
| 1.5 | Change the PC's clock back by one day, take an order and print a bill, then set it right.              | Note the bill's date and number. (Behaviour to be decided: D-9.)                              | ☐         |       |
| 1.6 | At 03:55 (or with the cut-off moved near the current time), print a bill; pay it 10 minutes later.     | Note the business dates on the day-end reports. (Behaviour to be decided: D-6.)               | ☐         |       |

## 2. Printers

Detailed procedure: `manual-tasks/13-printer-test.md`.

| #   | Steps                                                                           | Expected                                                                                                  | Pass/Fail | Notes |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------- | ----- |
| 2.1 | Order a dish with a note typed on a phone keyboard: `Don’t add onion – thanks`. | The kitchen slip prints `Don't add onion - thanks` (plain quote and dash, no "?") (QA-019).               | ☐         |       |
| 2.2 | Order a dish whose name is in Hindi.                                            | Screens show Hindi correctly. The slip prints "?" for the Hindi letters (known; decision D-12).           | ☐         |       |
| 2.3 | Order a dish with a 450-character note.                                         | The note wraps within the paper; nothing is cut off at the side; the slip is not garbled.                 | ☐         |       |
| 2.4 | Switch the kitchen printer off, send three orders, switch it back on.           | The POS and manager see "printer offline"; the three slips print in order once it is back, no duplicates. | ☐         |       |
| 2.5 | Unplug the printer's network cable in the middle of printing a bill.            | The bill is retried or reported; it is never printed twice as "original".                                 | ☐         |       |
| 2.6 | Take a cash payment.                                                            | The cash drawer opens once. Print a KOT with any note: the drawer never opens.                            | ☐         |       |

## 3. Waiter app (Android phones)

Detailed procedures: `manual-tasks/33-android-device-checks.md`, `37-waiter-phone-feedback.md`.

| #   | Steps                                                                                                                                         | Expected                                                                                                    | Pass/Fail | Notes |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------- | ----- |
| 3.1 | Pair a phone with the QR code from the Devices page (camera scan).                                                                            | Paired within a few seconds; the waiter sign-in shows.                                                      | ☐         |       |
| 3.2 | Turn on aeroplane mode, take two orders on two tables, turn it off.                                                                           | Both orders show "waiting to send", then reach the kitchen once each, in order. No duplicate slips.         | ☐         |       |
| 3.3 | Take an order, turn on aeroplane mode **immediately** after tapping Send, kill the app from recent apps, reopen it, turn the network back on. | The order reaches the kitchen exactly once.                                                                 | ☐         |       |
| 3.4 | Two waiters open the same table on two phones and both add a dish at the same moment.                                                         | Both dishes are on the table once each; no error.                                                           | ☐         |       |
| 3.5 | Waiter A seats a table and orders Dal x4. Waiter B (not assigned) tries to change it to Dal x1.                                               | Refused: B may add dishes but not lower another waiter's (QA-018).                                          | ☐         |       |
| 3.6 | Print the table's bill at the POS, then on the phone try to change a dish's quantity.                                                         | Refused: "… is on a printed bill. Use Edit bill to change it." (QA-002).                                    | ☐         |       |
| 3.7 | Walk to the far end of the restaurant (weak Wi-Fi) and take an order.                                                                         | The order is sent, or shows "waiting to send" and goes when the signal returns. No freeze, no blank screen. | ☐         |       |
| 3.8 | With a phone whose secure lock screen was just removed (or after clearing the app's storage), open the app.                                   | Either it works, or it says "The app could not start" with Try again; never a blank screen (QA-008).        | ☐         |       |
| 3.9 | Stop the server on the PC for two minutes while the app is open, then start it again.                                                         | The app says it cannot reach the server, keeps orders, and recovers by itself once the server is back.      | ☐         |       |

## 4. Table tablet (kiosk)

Detailed procedure: `manual-tasks/12-tablet-kiosk.md`.

| #   | Steps                                                                                          | Expected                                                                                                      | Pass/Fail | Notes |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------- | ----- |
| 4.1 | Try to leave the app with the home, back and recent-apps buttons, and by pulling down the bar. | The tablet stays in the app; leaving needs a staff PIN.                                                       | ☐         |       |
| 4.2 | Enter a wrong staff PIN five times.                                                            | The tablet stops taking PINs for a while; the staff member is **not** locked out on their own phone.          | ☐         |       |
| 4.3 | Order from the tablet while its Wi-Fi is off, then turn it on.                                 | The tablet says it cannot send; once back, the order goes once (or asks to send again); never twice.          | ☐         |       |
| 4.4 | Turn the tablet off and on.                                                                    | It comes back into the kiosk app at its own table, or says "The app could not start" with Try again (QA-008). | ☐         |       |

## 5. Kitchen display (browser on a screen)

| #   | Steps                                                                                            | Expected                                                                | Pass/Fail | Notes |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------- | ----- |
| 5.1 | Set a screen to show Kitchen **and** Bar. Send a drink; tap it to mark it preparing, then ready. | Both steps work on the drink (QA-017).                                  | ☐         |       |
| 5.2 | Unplug the KDS screen's network for one minute while two orders are sent, then plug it in.       | Both tickets appear within seconds of reconnecting; nothing is missing. | ☐         |       |
| 5.3 | Leave the KDS running for a full service day (8+ hours).                                         | No slowdown or blank screen; ticket ages keep counting.                 | ☐         |       |
| 5.4 | Order a dish with a very long name and note, and one in Hindi.                                   | Tickets show the full text without spilling over other tickets.         | ☐         |       |

## 6. POS and billing (managers)

| #   | Steps                                                                                             | Expected                                                                                              | Pass/Fail | Notes |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- | ----- |
| 6.1 | Give a flat ₹50 discount on a bill (with reason).                                                 | The bill total goes down by ₹50 plus its tax (QA-001).                                                | ☐         |       |
| 6.2 | Reopen a printed, unpaid bill with Edit bill; try to take payment before printing it again.       | Payment refused: "This bill is open for changes. Print it again before taking payment." (QA-005).     | ☐         |       |
| 6.3 | Take part payment on a bill, then try Edit bill.                                                  | Refused: "Part of this bill is paid…" (QA-005, decision 84).                                          | ☐         |       |
| 6.4 | Two managers on two tills open the same table's bill at the same moment.                          | Both see the same bill; no error (QA-012).                                                            | ☐         |       |
| 6.5 | Manager starts closing their shift on one till while the same manager takes cash on another till. | The cash is refused ("Open a shift…") or lands before the close; the shift's count is right (QA-013). | ☐         |       |
| 6.6 | Run day-end while a payment is being taken on another till.                                       | The payment shows on one day's report only; no money missing from both (QA-010).                      | ☐         |       |
| 6.7 | Unplug the POS PC's network cable (if the POS is a separate PC) and take an order.                | A clear "cannot reach the server" message; no white screen; it recovers when plugged back.            | ☐         |       |

## 7. Manager dashboard

| #   | Steps                                                                                                   | Expected                                                                                            | Pass/Fail | Notes |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------- | ----- |
| 7.1 | Load a menu file made in Excel where someone typed in cell XFD1048576.                                  | Refused at once: "A sheet reaches far beyond its data…"; the POS keeps working throughout (QA-011). | ☐         |       |
| 7.2 | Mark an add-on "not available", publish, and look for it on the POS, phone, tablet and QR menu.         | It is not offered anywhere (QA-015).                                                                | ☐         |       |
| 7.3 | Archive a dish that is on an open order, publish, then cancel that dish on the order.                   | The cancel works (QA-016).                                                                          | ☐         |       |
| 7.4 | Upload a 4,000 × 4,000 photo, a 0-byte file renamed `.jpg` and a PDF renamed `.jpg`.                    | The photo is accepted and resized; the other two are refused with a plain message.                  | ☐         |       |
| 7.5 | Export reports to Excel and CSV with a dish named `=HYPERLINK("http://x","click")`; open them in Excel. | The cell shows the text, not a link or formula.                                                     | ☐         |       |
| 7.6 | Open the dashboard on a phone browser (360 px wide).                                                    | Pages fit the screen; nothing is cut off.                                                           | ☐         |       |

## 8. QR menu and relay (real cloud)

Detailed procedures: `manual-tasks/20-supabase-relay.md`, `21-qr-site.md`.

| #   | Steps                                                                         | Expected                                                                                     | Pass/Fail | Notes |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- | ----- |
| 8.1 | Scan a table's QR code with a guest phone on mobile data; order.              | The menu opens; the order waits for staff approval at the POS or waiter app.                 | ☐         |       |
| 8.2 | Unplug the restaurant's internet for 5 minutes; try a QR order; plug it back. | The site says ordering is paused; the restaurant itself keeps working; QR orders resume.     | ☐         |       |
| 8.3 | Change the table number in a QR link by hand.                                 | The order is refused or goes to the table of the code that was scanned, never another table. | ☐         |       |

## 9. Vendor cloud (Control Plane)

Detailed procedures: `manual-tasks/23-licensing.md`, `34-control-plane-host-logs.md`, `docs/runbooks/control-plane-aws.md`.

| #   | Steps                                                                                      | Expected                                                                                | Pass/Fail | Notes |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------- | ----- |
| 9.1 | Deploy staging on AWS; sign in as Super Admin with the authenticator.                      | Sign-in works; a wrong code is refused.                                                 | ☐         |       |
| 9.2 | Sign in as a Support user; try to open another restaurant's diagnostics without a request. | Refused.                                                                                | ☐         |       |
| 9.3 | Let a test restaurant's licence expire; keep the restaurant PC open through the evening.   | Service continues; the restricted state starts only at the next business day (LIC-005). | ☐         |       |
| 9.4 | Stop the Control Plane for an hour.                                                        | Restaurants keep working; heartbeats and backups catch up when it is back.              | ☐         |       |

## 10. Pager (when the firmware exists)

Out of scope of this audit (firmware not built). Procedures: `manual-tasks/30-pager-firmware-signing.md`
and the P2-05 work package.
