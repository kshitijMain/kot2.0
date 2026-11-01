-- P9-27: history without partitions (ADR-0027). A closed business date's report figures are summed
-- once, when day-end closes it, into the daily summary tables below; reports read them for closed
-- dates and the live tables only for dates still open (or changed since they were summed). The big
-- tables get the indexes the bill history and the reports read by.

-- ------------------------------------------------------------------ the summaries

CREATE TABLE "daily_summaries" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "built_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_sales_hours" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "invoices" INTEGER NOT NULL,
    "gross_sales" BIGINT NOT NULL,
    "discounts" BIGINT NOT NULL,
    "service_charge" BIGINT NOT NULL,
    "tax" BIGINT NOT NULL,
    "round_off" BIGINT NOT NULL,
    "net_sales" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_sales_hours_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_sales_hours_hour_check" CHECK ("hour" BETWEEN 0 AND 23)
);

CREATE TABLE "daily_item_sales" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "gross" BIGINT NOT NULL,
    "discounts" BIGINT NOT NULL,
    "net" BIGINT NOT NULL,
    "tax" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_item_sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_payment_modes" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "mode_label" TEXT,
    "payments" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_payment_modes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_staff_sales" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "staff_id" UUID NOT NULL,
    "orders_created" INTEGER NOT NULL,
    "invoices_issued" INTEGER NOT NULL,
    "billed" BIGINT NOT NULL,
    "net" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_staff_sales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_summaries_restaurant_id_business_date_key" ON "daily_summaries"("restaurant_id", "business_date");
CREATE UNIQUE INDEX "daily_sales_hours_restaurant_id_business_date_hour_key" ON "daily_sales_hours"("restaurant_id", "business_date", "hour");
CREATE UNIQUE INDEX "daily_item_sales_restaurant_id_business_date_item_id_key" ON "daily_item_sales"("restaurant_id", "business_date", "item_id");
CREATE UNIQUE INDEX "daily_payment_modes_restaurant_id_business_date_mode_mode_l_key" ON "daily_payment_modes"("restaurant_id", "business_date", "mode", "mode_label");
CREATE UNIQUE INDEX "daily_staff_sales_restaurant_id_business_date_staff_id_key" ON "daily_staff_sales"("restaurant_id", "business_date", "staff_id");

-- Derived figures, not business records: the server rewrites a date's rows when a change reaches
-- it after it was summed (P0-08 rule: DELETE is granted explicitly per table). rp_app already has
-- SELECT, INSERT and UPDATE through the default privileges.
GRANT DELETE ON "daily_summaries", "daily_sales_hours", "daily_item_sales", "daily_payment_modes",
  "daily_staff_sales" TO rp_app;

-- ------------------------------------------------------------------ keeping them true

-- A change that still reaches a summed date (an invoice of a carried-forward table edited or
-- settled the next morning, an old bill voided) marks the date stale: reports then read it from
-- the live tables until the server sums it again. The function shares day-end's lock, as every
-- writer does (src/common/business-dates.ts): a summary being built holds that lock alone, so it
-- is committed before this looks for it, and none starts until this transaction ends and its
-- change can be seen.
CREATE OR REPLACE FUNCTION rp_daily_summary_stale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('day-end:' || NEW.restaurant_id::text, 0));
  UPDATE daily_summaries SET stale = true, updated_at = CURRENT_TIMESTAMP
    WHERE restaurant_id = NEW.restaurant_id AND business_date = NEW.business_date AND NOT stale;
  IF TG_OP = 'UPDATE' AND OLD.business_date IS DISTINCT FROM NEW.business_date THEN
    UPDATE daily_summaries SET stale = true, updated_at = CURRENT_TIMESTAMP
      WHERE restaurant_id = OLD.restaurant_id AND business_date = OLD.business_date AND NOT stale;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER invoices_daily_summary_insert
  AFTER INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION rp_daily_summary_stale();

-- Only what the figures read: printing, the customer's details and settling leave them as they are.
CREATE TRIGGER invoices_daily_summary_update
  AFTER UPDATE ON invoices
  FOR EACH ROW
  WHEN (
    (OLD.status = 'VOIDED') IS DISTINCT FROM (NEW.status = 'VOIDED')
    OR (OLD.version, OLD.business_date, OLD.issued_at, OLD.issued_by_id, OLD.grand_total)
       IS DISTINCT FROM (NEW.version, NEW.business_date, NEW.issued_at, NEW.issued_by_id, NEW.grand_total)
  )
  EXECUTE FUNCTION rp_daily_summary_stale();

CREATE TRIGGER payments_daily_summary
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION rp_daily_summary_stale();

-- ------------------------------------------------------------------ indexes for history and reports

-- Orders, order items and KOTs already lead with (restaurant_id, business_date) through their
-- unique keys and indexes; payments and the audit log have it. Invoices get it widened so the
-- bill history pages newest first straight from the index.
DROP INDEX "invoices_restaurant_id_business_date_idx";
CREATE INDEX "invoices_restaurant_id_business_date_issued_at_id_idx" ON "invoices"("restaurant_id", "business_date", "issued_at", "id");

-- Finding a bill by its running number in any series or year ("123").
CREATE INDEX "invoices_restaurant_id_sequence_idx" ON "invoices"("restaurant_id", "sequence");

-- The audit log by time across business dates.
CREATE INDEX "audit_log_restaurant_id_occurred_at_idx" ON "audit_log"("restaurant_id", "occurred_at");

-- Finding a guest's bills by phone, however the number was typed ("98765 43210",
-- "+91-98765-43210"): its last ten digits.
CREATE INDEX "invoices_restaurant_id_phone_digits_idx" ON "invoices"("restaurant_id", right(regexp_replace("customer_phone", '[^0-9]', '', 'g'), 10))
  WHERE "customer_phone" IS NOT NULL;
