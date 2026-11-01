-- P9-25: a diner may call a waiter at a table nobody has opened yet; that request has no session.
ALTER TABLE "service_requests" ALTER COLUMN "table_session_id" DROP NOT NULL;
