-- Clears QR relay queues and table bills for a fresh diner trial (pilot-only).
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM relay.qr_orders;
DELETE FROM relay.qr_service_requests;
UPDATE relay.qr_table_bills SET bill = NULL, last_closed_at = now(), updated_at = now();
COMMIT;
