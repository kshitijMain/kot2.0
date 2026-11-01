-- The restaurant's open line on a self-hosted relay (P9-01, ADR-0024). A new QR order or service
-- request rings the restaurant's local server at once: the relay host LISTENs on `relay_ring`
-- and passes the ring down the one WebSocket the local server keeps open, in the same Phoenix
-- protocol the local server already speaks to Supabase Realtime (P5-03d). NOTIFY is delivered
-- after commit, so a ring never announces a row that could still roll back.
--
-- The payload routes the ring and nothing else: what is new is always read through the `server`
-- function, the one trusted way in. On Supabase nobody listens, and a NOTIFY without a listener
-- costs next to nothing.
CREATE FUNCTION relay.ring() RETURNS trigger
  LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  PERFORM pg_notify('relay_ring', json_build_object(
    'schema', TG_TABLE_SCHEMA,
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'record', json_build_object(
      'id', NEW.id, 'tenant_id', NEW.tenant_id, 'table_id', NEW.table_id, 'status', NEW.status
    )
  )::text);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION relay.ring() FROM PUBLIC;

CREATE TRIGGER qr_orders_ring AFTER INSERT ON relay.qr_orders
  FOR EACH ROW EXECUTE FUNCTION relay.ring();
CREATE TRIGGER qr_service_requests_ring AFTER INSERT ON relay.qr_service_requests
  FOR EACH ROW EXECUTE FUNCTION relay.ring();

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION relay.ring() FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;

-- The scheduled jobs' login on a self-hosted relay, where there is no pg_cron: it may run expiry
-- and retention (both definer-rights functions) and nothing else, so the relay host never needs
-- the owner's or a superuser's password. Like relay_edge, it is created without a password; the
-- set-up gives it one (infra/relay-host/setup-ubuntu.sh). On Supabase it stays unused.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'relay_janitor') THEN
    CREATE ROLE relay_janitor NOLOGIN NOINHERIT;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA relay TO relay_janitor;
GRANT EXECUTE ON FUNCTION relay.expire_orders(timestamptz), relay.purge(timestamptz)
  TO relay_janitor;
