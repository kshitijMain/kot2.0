-- Clears Mannat pilot service data (orders, KOTs, approvals, alerts, open tables, relay queues).
-- Keeps restaurant, menu, staff, paired devices, and table QR tokens. Pilot-only (postgres superuser).
-- Keeps the event outbox and inbox: emptying them restarts event numbering under the consumers'
-- cursors, and every new event (alerts, the QR "accepted") would be skipped (P9-13).
\set ON_ERROR_STOP on
BEGIN;
UPDATE tables SET state = 'FREE', updated_at = now();
TRUNCATE TABLE
  recommendation_events,
  kot_lines,
  alerts,
  print_notices,
  order_item_modifiers,
  discounts,
  invoice_lines,
  tax_lines,
  payments,
  invoices,
  bills,
  relay_orders,
  relay_service_requests,
  digital_bills,
  approvals,
  order_events,
  kots,
  order_items,
  orders,
  service_requests,
  table_sessions,
  idempotency_records,
  feedback,
  diner_contacts,
  pending_audit_entries
RESTART IDENTITY CASCADE;
DELETE FROM daily_counters;
COMMIT;
