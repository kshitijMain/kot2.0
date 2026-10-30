-- ADR-0023 (Part 3): any waiter serves any table. There is no waiter assignment and no table's or
-- section's waiter, so stored notification rules that named them name every waiter on duty
-- instead. The day's old assignments (shift_assignments) stay as history; nothing writes them.
UPDATE "settings" s
SET "value" = (
    SELECT jsonb_object_agg(
        rules."event",
        CASE
            WHEN jsonb_typeof(rules."rule" -> 'recipients') = 'array' THEN jsonb_set(
                rules."rule", '{recipients}',
                (SELECT jsonb_agg(DISTINCT CASE
                    WHEN kind IN ('RESPONSIBLE_WAITER', 'SECTION_WAITERS') THEN 'ALL_WAITERS'
                    ELSE kind END)
                 FROM jsonb_array_elements_text(rules."rule" -> 'recipients') AS kind)
            )
            ELSE rules."rule"
        END
    )
    FROM jsonb_each(s."value") AS rules("event", "rule")
)
WHERE s."key" = 'notifications.rules' AND jsonb_typeof(s."value") = 'object'
  AND (s."value"::text LIKE '%"RESPONSIBLE_WAITER"%' OR s."value"::text LIKE '%"SECTION_WAITERS"%');
