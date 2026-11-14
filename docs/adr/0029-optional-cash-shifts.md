# ADR-0029: The cash drawer (shifts) is an optional add-on

Status: Accepted
Date: 2026-11-09
Work package: none (asked for by the Business Owner, branch `feature/optional-shifts`)
Requirements: BILL-008, BILL-013, BILL-016, RPT-005, AUD-001, AUD-006

## Context

BILL-013 and the build so far required a cash shift: cash could not be taken without one
(`NO_OPEN_SHIFT`) and day-end was blocked until every shift was closed. Many restaurants do not
count a drawer per person, so a manager had to open a shift just to take cash. The Business Owner
changed the rule. An ADR records it because it changes the BRD's shift rules.

## Decision

- **Cash never needs a shift.** `NO_OPEN_SHIFT` and every "open a shift first" message are gone.
- **A shift is an optional add-on, per person, always offered** (no setting hides it). Whoever
  wants to track their drawer opens their own and closes it with the counted cash, as before.
- **Cash follows the person who takes it.** With their own shift open, a payment is linked to it
  and counts in its expected cash. With none open it is recorded with no shift. It never goes into
  another person's shift. A payment arriving during that person's close waits, then finds no open
  shift and goes outside any shift, so the count stays right (QA-013).
- **Cash in, cash out and the no-sale opening need the person's own open shift**
  (`409 OWN_SHIFT_REQUIRED`). Without one the POS shows the buttons and explains them in one line,
  offering to open a shift. A manager can no longer write cash in or out on someone else's shift
  (D-31).
- **The drawer on the printer is unchanged**: it opens on a cash payment, shift or no shift.
- **Day-end no longer waits for shifts.** `DayEndPreview.openShifts` names each one with what its
  drawer should hold, and day-end offers count and close (`POST /shifts/:id/close`) or close as not
  counted (`POST /shifts/:id/close-not-counted`, audited as `SHIFT_CLOSED_NOT_COUNTED`, needs
  `CASH_MOVEMENT_AND_SHIFT_CLOSE`). A shift left open runs on into the next business date (D-30).
- **Not counted is not a new status.** It is a closed shift with no counted cash
  (`@rp/domain` `shiftNotCounted`): before this change every closed shift had a count, so no column
  and no rewriting are needed.
- **Reports.** The shift report is unchanged, showing "Not counted" where that applies. The day-end
  report and the payments report keep total cash and add "Cash taken outside a shift"
  (`@rp/domain` `cashOutsideShift`; the payments report's closed dates read
  `daily_payment_modes.outside_shift`, migration `20261109100000_cash_outside_shift`). The
  suspicious-activity report adds `SHIFT_NOT_COUNTED` and keeps `CASH_VARIANCE`; cash taken without
  a shift is normal and is not flagged.
- **Old data stays as it is.** No payment, shift or kept report is rewritten. A Z-report kept before
  this change reads as having no cash outside a shift, which is true: cash needed a shift then.

## Alternatives considered

- A restaurant-wide setting to require shifts: rejected by the Business Owner's brief (per person,
  always visible, no setting).
- A `NOT_COUNTED` shift status: a new enum value and migration for what the existing columns
  already say.
- A new `shifts/current/cash-movements` route for "no shift": the existing route refuses anyone
  whose own shift it is not, so a second route would add nothing.
- Reading "Cash taken outside a shift" from `payments` for closed dates: the reports read closed
  dates from the daily summaries (P9-27) so that old ranges stay cheap.

## Consequences

- Cash taken outside a shift is covered by no drawer count; the new report line shows how much.
- Day-end can close with a shift still open, so a shift can span business dates. It stays on the
  date it was opened; each payment keeps its own date.
- A no-sale opening now needs a shift, so someone without one cannot pop the drawer
  from the POS (D-32).
