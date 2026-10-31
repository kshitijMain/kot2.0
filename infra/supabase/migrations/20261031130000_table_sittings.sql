-- A diner's orders follow their mobile number, not their browser (P9-08, ADR-0024).
--
-- Scanning the table's code again, on the same phone in another browser or on another phone, and
-- giving the same number shows the orders that number placed at this table during this sitting.
-- The sitting is what the restaurant says it is: the local server sends, with the table's bill,
-- when the table last closed; orders before that belong to an earlier party and are never shown.

-- When the table's previous sitting ended (null: never, as far as the relay knows).
ALTER TABLE relay.qr_table_bills ADD COLUMN last_closed_at timestamptz;

GRANT INSERT (last_closed_at), UPDATE (last_closed_at) ON relay.qr_table_bills TO relay_writer;

-- The lookup: a table's orders by number, newest first.
CREATE INDEX qr_orders_phone_idx ON relay.qr_orders (tenant_id, table_id, customer_phone, submitted_at)
  WHERE customer_phone IS NOT NULL;
