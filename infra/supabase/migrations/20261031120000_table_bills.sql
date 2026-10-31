-- The table's bill on the diner's phone, and "I have paid" (P9-03, ADR-0024).
--
-- One current bill per table: the restaurant writes it when it prints, settles or voids an invoice
-- of the table's sitting and clears it (bill NULL) when the table closes, so the next sitting
-- never sees it. Diners read only their own table's (RLS, by the claims of their QR code).

ALTER TABLE relay.qr_service_requests DROP CONSTRAINT qr_service_requests_type_check;
ALTER TABLE relay.qr_service_requests
  ADD CONSTRAINT qr_service_requests_type_check CHECK (type IN ('WATER', 'WAITER', 'BILL', 'PAID'));

CREATE TABLE relay.qr_table_bills (
  tenant_id uuid NOT NULL,
  table_id uuid NOT NULL,
  bill jsonb CHECK (bill IS NULL OR jsonb_typeof(bill) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, table_id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES relay.dining_tables (tenant_id, table_id)
);

CREATE TRIGGER qr_table_bills_touch BEFORE UPDATE ON relay.qr_table_bills
  FOR EACH ROW EXECUTE FUNCTION relay.touch();

ALTER TABLE relay.qr_table_bills ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT (tenant_id, table_id, bill), UPDATE (bill) ON relay.qr_table_bills
  TO relay_writer;
CREATE POLICY writer_reads_own_bills ON relay.qr_table_bills FOR SELECT TO relay_writer
  USING (tenant_id = (SELECT relay.claim_tenant()));
CREATE POLICY writer_adds_own_bills ON relay.qr_table_bills FOR INSERT TO relay_writer
  WITH CHECK (tenant_id = (SELECT relay.claim_tenant()));
CREATE POLICY writer_changes_own_bills ON relay.qr_table_bills FOR UPDATE TO relay_writer
  USING (tenant_id = (SELECT relay.claim_tenant()))
  WITH CHECK (tenant_id = (SELECT relay.claim_tenant()));

GRANT SELECT ON relay.qr_table_bills TO relay_diner;
CREATE POLICY diner_reads_own_table_bill ON relay.qr_table_bills FOR SELECT TO relay_diner
  USING (tenant_id = (SELECT relay.claim_tenant()) AND table_id = (SELECT relay.claim_table()));

-- Retention (BRD §9.3): a bill the restaurant did not clear (it was offline when the table closed)
-- goes after a day; diners' phone numbers never sit on the relay for long.
CREATE FUNCTION relay.purge_table_bills(as_of timestamptz DEFAULT now()) RETURNS bigint
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH cleared AS (
    UPDATE relay.qr_table_bills SET bill = NULL
    WHERE bill IS NOT NULL AND updated_at < as_of - interval '1 day'
    RETURNING 1
  )
  SELECT count(*) FROM cleared
$$;
REVOKE ALL ON FUNCTION relay.purge_table_bills(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION relay.purge_table_bills(timestamptz) TO relay_janitor;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON relay.qr_table_bills FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION relay.purge_table_bills(timestamptz) FROM %I', api_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    EXECUTE $cron$SELECT cron.schedule('relay-purge-bills', '23 * * * *', 'SELECT relay.purge_table_bills()')$cron$;
  END IF;
END
$$;
