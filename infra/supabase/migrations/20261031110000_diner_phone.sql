-- The diner's mobile number on a QR order (P9-02, ADR-0024, BILL-011): given on the page that says
-- it is printed on the bill, picked up by the restaurant with the order, and gone with the order
-- after the retention period (relay.purge). Like everything the diner submitted, it never changes.
ALTER TABLE relay.qr_orders
  ADD COLUMN customer_phone text CHECK (customer_phone ~ '^\+91[6-9][0-9]{9}$');

GRANT INSERT (customer_phone) ON relay.qr_orders TO relay_diner;

CREATE OR REPLACE FUNCTION relay.qr_order_rules() RETURNS trigger
  LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.table_id, NEW.idempotency_key, NEW.browser_id,
      NEW.snapshot_version, NEW.lines, NEW.customer_name, NEW.customer_phone, NEW.instructions,
      NEW.submitted_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.table_id, OLD.idempotency_key, OLD.browser_id,
      OLD.snapshot_version, OLD.lines, OLD.customer_name, OLD.customer_phone, OLD.instructions,
      OLD.submitted_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'QR_ORDER_IMMUTABLE' USING ERRCODE = 'RL400',
      DETAIL = 'What the diner submitted never changes.';
  END IF;
  IF NOT (
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('RECEIVED', 'EXPIRED'))
    OR (OLD.status = 'RECEIVED' AND NEW.status IN ('RECEIVED', 'SENT_TO_KITCHEN', 'REJECTED'))
    OR (OLD.status = 'SENT_TO_KITCHEN' AND NEW.status = 'SENT_TO_KITCHEN')
  ) THEN
    RAISE EXCEPTION 'QR_ORDER_TRANSITION' USING ERRCODE = 'RL409',
      DETAIL = format('%s cannot become %s.', OLD.status, NEW.status);
  END IF;
  IF OLD.status = 'SUBMITTED' AND NEW.status = 'RECEIVED' THEN
    IF now() > OLD.expires_at THEN
      RAISE EXCEPTION 'QR_ORDER_EXPIRED' USING ERRCODE = 'RL410',
        DETAIL = 'The order was not picked up in time.';
    END IF;
    NEW.received_at := now();
  ELSE
    NEW.received_at := OLD.received_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION relay.qr_order_rules() FROM PUBLIC;
