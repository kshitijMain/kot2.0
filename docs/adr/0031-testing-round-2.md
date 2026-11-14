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
