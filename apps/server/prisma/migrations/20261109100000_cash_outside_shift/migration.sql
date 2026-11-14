-- ADR-0029: the cash drawer is an optional add-on, so cash can be taken with no shift. The daily
-- payment summaries keep how much of a day's cash went into no shift, for the reports of closed
-- dates. Nothing already recorded changes: every payment and shift stays as it is, and days summed
-- before this had no cash outside a shift (cash needed an open shift then).
ALTER TABLE "daily_payment_modes" ADD COLUMN "outside_shift" BIGINT NOT NULL DEFAULT 0;
