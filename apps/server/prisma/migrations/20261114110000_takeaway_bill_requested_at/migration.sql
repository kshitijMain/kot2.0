-- When the waiter asked for a takeaway's bill (ADR-0030): it then waits in the managers' pending
-- bills. Null until asked.
ALTER TABLE "orders" ADD COLUMN "bill_requested_at" TIMESTAMPTZ(3);
