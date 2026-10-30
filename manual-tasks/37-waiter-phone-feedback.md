# 37. The waiter phone after the Business Owner's feedback (2026-10-25)

What it checks: the changes made after the Business Owner tried the waiter app on a phone. The
automated tests cover the logic; how the screen sits under the phone's bars, the back button and
how notifications look can only be seen on a real phone.

## Getting the build without the development gear

1. Push the branch (or `main` after the merge) and open the **Android** workflow run on GitHub.
2. Download the artifact **waiter-app-release-apk**. It is the release variant: the JavaScript is
   inside, so Metro is not needed, and there is no floating gear or development menu. It is the
   development environment (`in.rp.waiter.dev`, "Parossa Captain (dev)"), so it still talks to a
   development server over `http://`, and it installs over the debug build already on the phone.
   The tablet's is **table-tablet-release-apk**.
3. `adb install -r app-release.apk`, or copy it to the phone and open it.

A production build (`in.rp.waiter`, TLS only, the owner's signing key) comes from EAS Build:
`eas build -p android --profile preview` (see `apps/waiter-app/README.md`).

## Checks

1. **Sign-in.** On a phone paired fresh, the list shows waiters only: no manager, owner
   or kitchen. Sign in as a waiter, sign out from Menu → Sign out: the list again. Let the phone
   sign the waiter out for inactivity (10 minutes untouched): it opens on that waiter's PIN pad,
   with "Not you?" for the list.
2. **Back button.** On a table, open the Menu tab, press back: the order tab. Back again: the
   tables. From Menu → New takeaway, back: the tables. On a PIN pad, back: the list of names. With
   a sheet open (a dish's options, the alerts list), back closes the sheet only.
3. **Edges.** Nothing sits under the clock or the status icons at the top. Send KOT, the bottom
   of each sheet and the short messages ("KOT sent") sit above the phone's back/home buttons or
   gesture bar. Try a phone with three buttons and one with gestures if you have both.
4. **Notifications.** With the app open on the tables, have the kitchen mark a dish Ready: a
   notification drops in from the top and goes by itself; nothing covers the app. Pull down the
   shade: it is there. Tap it: the app opens on that table and the notification goes. The bell
   on the header counts it; when the kitchen marks it Picked up, it leaves the bell and the shade.
   Lock the phone and repeat: it rings, the lock screen says only "Alerts for …".
5. **Escalation.** Mark a dish Ready and leave it: after 3 minutes (Settings, kitchen, "Ready food
   not collected after") the manager is alerted on the POS. Nobody tapped anything on the phone.
6. **Served.** On the kitchen screen press Picked up: on the phone the dish shows Served. The
   phone has no Picked up or Served buttons.
7. **Home.** The tables are two to a row. The pager card shows on the tables only when the pager
   is offline or low; Menu shows it always, with On break, New takeaway and Sign out. On break,
   a card on the tables says so with "I'm back".
8. **Dishes.** Each sent dish has "Again"; Cancel or Void is under "More".

Tell Claude what you see, with a screenshot where something is off.
