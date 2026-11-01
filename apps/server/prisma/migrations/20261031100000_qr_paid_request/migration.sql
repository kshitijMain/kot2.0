-- P9-03 (ADR-0024): "I have paid" from the QR page, after paying the printed bill by UPI.
ALTER TYPE "ServiceRequestType" ADD VALUE IF NOT EXISTS 'PAID';

-- The QR inbox takes it from the relay like the other requests.
ALTER TABLE "relay_service_requests" DROP CONSTRAINT "relay_service_requests_type_check";
ALTER TABLE "relay_service_requests"
  ADD CONSTRAINT "relay_service_requests_type_check" CHECK ("type" IN ('WATER', 'WAITER', 'BILL', 'PAID'));
