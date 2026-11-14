# ADR-0031: Fixes from testing, round 2 (kitchen, stations, KOT and bill printing)

Status: Accepted
Date: 2026-11-14
Work package: none (fixes from the Business Owner's testing, branch `fix/testing-round-1`)
Requirements: KDS-003, KDS-005, KDS-008, MENU-006, PRN-001, PRN-003, BILL-002, BILL-010, RPT-012

## Context

The Business Owner's second round of testing found bugs in the kitchen display, station routing,
the KOT and bill printing, and asked for a new menu availability screen and invoice settings. Each
section names the item of the brief, the cause found, and what changed. Business choices left open
are in `docs/testing/DECISIONS_NEEDED.md`.

## A. Bump stays grey

**Cause.** The kitchen display enabled Bump only when nothing on the ticket was waiting, cooking
or ready (P9-21 added "ready": food at the pass had to be picked up first). After "All ready" the
button stayed grey until a waiter picked everything up. The server already allowed it: it refuses
a bump only while something is waiting or cooking (`KOT_NOT_READY`).

**Now.** Bump is enabled once every dish on the ticket that is not cancelled is ready, picked up
or served, as the server checks. While it is grey, one line beside it says why ("Mark all dishes
ready to bump"), tied to the button for screen readers. A bumped ticket's ready dishes stay ready
for the waiter to collect, and Recall brings the ticket back within the hour, as before.

**Changed tests.** The kitchen display's tests that expected Bump to wait for the pick-up now
expect it as soon as everything is ready (the brief changes P9-21's rule).

## B. A Bar dish went to the Kitchen

**Cause.** A KOT took each dish's station from the last _published_ menu. Moving "Lime soda" to
the Bar in the menu editor saved it to the draft; until someone published, every Lime soda kept
going to the Kitchen. Nothing on the dashboard said the menu had unpublished changes. (The Bar
station itself was fine: whether a station prints and on which printer is read live already.)

**Now.**

- A dish goes to its station as it stands when the KOT is made (`routeToLiveStations` in the
  order engine), like the station's print setting: a station is kitchen set-up, not something the
  guests see. A dish whose station has been archived keeps the published one. Prices, names and
  everything guests see still wait for publishing (D-39).
- `GET /api/v1/menu/publish-status` (`MENU_MANAGE`) compares the draft with the published menu,
  leaving out availability and stock (they are live), and names the dishes added, changed or
  removed. The menu editor shows **Unpublished changes** above the dishes with **Publish now**;
  every other dashboard page shows the same notice with a link to the menu.
- The Kitchen and printers page warns about a station whose tickets appear nowhere (no kitchen
  screen shows it and it does not print) and one set to print with no printer.

**Tests.** A dish moved to the Bar without publishing makes a Bar KOT only, shown on the Bar's
screen and printed on the Bar's printer; a mixed order makes one KOT per station, each on its own
screen and printer (`station-routing.int.test.ts`, which failed before the fix).

## C. Menu availability as a full page

**Was.** A list in a side panel over the kitchen display (and a list page on the dashboard), with
a red "Mark out of stock" button on every dish and the portion count in a dialog.

**Now.** A full page, opened from the kitchen display's top bar (`/kds/availability`, with "Back
to the tickets") and from the dashboard (`/manage/availability`):

- One line saying what it does, a search box, a filter (All / Available / Out of stock) and
  category chips.
- A grid of large cards (three or four a row on a laptop or kitchen screen, fewer on smaller ones):
  the dish name, its category, and one big two-state switch, Available or Out of stock. An
  out-of-stock card is greyed with an "Out of stock" badge; no red buttons.
- Portions left on the card as − 12 + with Clear. The presses are saved together a moment after
  the last one (`COUNT_SAVE_DELAY_MS`); the dish sells out by itself at 0.
- A change applies at once with a short note and Undo for six seconds instead of a dialog.
- With a category chosen, "Mark all in {category} available" puts back every dish of it that is
  out.
- Large touch targets, design tokens only. Alerts, cancellations of unstarted portions and live
  updates are unchanged (the server does them).

**Changed tests.** The availability tests were rewritten for the new page (the brief replaces the
screen); the pure filter and the live update are kept.
