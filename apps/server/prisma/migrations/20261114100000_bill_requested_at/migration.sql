-- When the table last asked for its bill (ADR-0030): "Bill requested at 21:42" on the waiter app,
-- and the waiting time of the manager's pending bills. Null until asked.
ALTER TABLE "table_sessions" ADD COLUMN "bill_requested_at" TIMESTAMPTZ(3);
