# 39. The waiter app on a real iPhone (P9-28)

What it checks: the waiter app in a real iPhone's browser, which no machine here can show. CI and
the Mac cover the rest:

- WebKit (the iPhone's engine) at an iPhone's size: every flow, in `apps/console/e2e/phone.e2e.ts`;
- Chrome on the Redmi.

What only a real iPhone shows:

- installing the certificate;
- Chrome's and Safari's own bars;
- the notch and the home bar;
- the swipe back;
- Add to Home Screen;
- notifications.

Takes about 20 minutes with one iPhone on the staff Wi-Fi and the pilot PC running.

## Set-up

Follow [`docs/runbooks/phone-web-app.md`](../docs/runbooks/phone-web-app.md): trust the
certificate (Safari), then open `https://<PC address>:8080/phone/` in **Chrome**.

## Checks

1. **Connects by itself.** The app shows "Tap your name" without anything typed. The list has the
   waiters, the managers and the Owner, and not the kitchen.
2. **A waiter's order.** Sign in as a waiter.
   1. Open a free table.
   2. Add a dish from the menu and press **Send KOT**: "Order … sent to the kitchen", and the
      ticket prints, or lands in the printouts folder on the pilot.
   3. **Request bill**.
   4. Swipe from the left edge: back to the tables, still in the app.
3. **A manager's bill.** Sign out and sign in as a manager.
   1. On that table, press **Print bill**, then **Take payment** and **Record payment**: "Invoice …
      is paid", and the table is free.
   2. A QR order from a diner shows "orders to approve"; **Approve** sends it to the kitchen.
4. **The Owner.** Sign in as the Owner. Menu shows **Open the full dashboard** and no break.
   Tapping it opens the console in a new tab.
5. **Edges.** Nothing sits under the notch or the clock. The bottom buttons sit above the home bar,
   with the page in Chrome and when opened from the Home Screen.
6. **Alerts.** With the page open, have the kitchen mark a dish Ready: a chime, and the bell
   counts it. Leave the phone untouched for two minutes: the screen stays on while someone is
   signed in.
7. **Home Screen.** Chrome → Share → **Add to Home Screen**. The icon opens the app full screen,
   still signed in.
8. **Two tabs.** Open the link again in a new tab: the old one says "Open in another tab". **Use it
   here** brings it back.

Tell Claude what differed, with a screenshot.
