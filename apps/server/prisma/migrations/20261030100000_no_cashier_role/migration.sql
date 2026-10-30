-- ADR-0023 (Part 1): there is no cashier role any more. Managers and the Owner bill, take payments
-- and run the cash drawer from the POS.
--
-- * Everyone on the built-in Cashier role becomes a Manager; their sessions end, so they sign in
--   again with what their new role allows.
-- * Custom roles built on the cashier move to the waiter base (DECISIONS_NEEDED D-13); their
--   people's sessions end too.
-- * The built-in Cashier role is archived (never deleted, master data).
-- * Settings: the cashier discount limit becomes the discount limit, and notification rules that
--   named the cashier name the managers on duty instead.
-- * The StaffRole type loses CASHIER.
--
-- The audit log is a hash chain computed by the server, so each change is queued in
-- `pending_audit_entries` and the server writes it into the chain when it starts (AUD-001).

CREATE TABLE "pending_audit_entries" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_audit_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pending_audit_entries_recorded_at_idx" ON "pending_audit_entries"("recorded_at");

-- A Manager role for every restaurant that is about to have one.
INSERT INTO "roles" ("id", "restaurant_id", "key", "name", "base_role", "built_in")
SELECT gen_random_uuid(), cashiers."restaurant_id", 'MANAGER', 'Manager', 'MANAGER', true
FROM (
    SELECT DISTINCT r."restaurant_id"
    FROM "staff" s JOIN "roles" r ON r."id" = s."role_id"
    WHERE r."base_role" = 'CASHIER' AND r."built_in"
) cashiers
ON CONFLICT ("restaurant_id", "key") DO NOTHING;

INSERT INTO "pending_audit_entries"
    ("id", "restaurant_id", "action", "entity_type", "entity_id", "before", "after", "reason")
SELECT gen_random_uuid(), s."restaurant_id", 'STAFF_UPDATED', 'staff', s."id",
       '{"role":"CASHIER"}'::jsonb, '{"role":"MANAGER"}'::jsonb,
       'The cashier role was removed: cashiers became managers (ADR-0023)'
FROM "staff" s JOIN "roles" r ON r."id" = s."role_id"
WHERE r."base_role" = 'CASHIER' AND r."built_in";

-- Everyone whose role changes signs in again.
UPDATE "sessions" SET "revoked_at" = CURRENT_TIMESTAMP, "revoke_reason" = 'ROLE_CHANGED'
WHERE "revoked_at" IS NULL AND "staff_id" IN (
    SELECT s."id" FROM "staff" s JOIN "roles" r ON r."id" = s."role_id"
    WHERE r."base_role" = 'CASHIER'
);

UPDATE "staff" s SET "role_id" = m."id", "updated_at" = CURRENT_TIMESTAMP
FROM "roles" r, "roles" m
WHERE r."id" = s."role_id" AND r."base_role" = 'CASHIER' AND r."built_in"
  AND m."restaurant_id" = s."restaurant_id" AND m."key" = 'MANAGER' AND m."built_in";

-- Custom roles on the cashier base move to the waiter base.
INSERT INTO "pending_audit_entries"
    ("id", "restaurant_id", "action", "entity_type", "entity_id", "before", "after", "reason")
SELECT gen_random_uuid(), "restaurant_id", 'ROLE_CHANGED', 'role', "id",
       jsonb_build_object('name', "name", 'baseRole', 'CASHIER'),
       jsonb_build_object('name', "name", 'baseRole', 'WAITER'),
       'The cashier role was removed: custom roles built on it now build on the waiter role (ADR-0023)'
FROM "roles" WHERE "base_role" = 'CASHIER' AND NOT "built_in";

UPDATE "roles" SET "base_role" = 'WAITER', "updated_at" = CURRENT_TIMESTAMP
WHERE "base_role" = 'CASHIER' AND NOT "built_in";

-- The built-in Cashier role: nobody has it now. Archived, with a base role that still exists.
INSERT INTO "pending_audit_entries"
    ("id", "restaurant_id", "action", "entity_type", "entity_id", "before", "after", "reason")
SELECT gen_random_uuid(), "restaurant_id", 'ROLE_ARCHIVED', 'role', "id",
       '{"archivedAt":null}'::jsonb, jsonb_build_object('archivedAt', to_jsonb(CURRENT_TIMESTAMP)),
       'The cashier role was removed (ADR-0023)'
FROM "roles" WHERE "base_role" = 'CASHIER' AND "built_in" AND "archived_at" IS NULL;

UPDATE "roles"
SET "base_role" = 'MANAGER', "archived_at" = COALESCE("archived_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "base_role" = 'CASHIER' AND "built_in";

-- Settings.
UPDATE "settings" SET "key" = 'billing.discountLimitBp'
WHERE "key" = 'billing.cashierDiscountLimitBp';

UPDATE "settings" s
SET "value" = (
    SELECT jsonb_object_agg(
        rules."event",
        CASE
            WHEN jsonb_typeof(rules."rule" -> 'recipients') = 'array' THEN jsonb_set(
                rules."rule", '{recipients}',
                (SELECT jsonb_agg(DISTINCT CASE WHEN kind = 'CASHIER' THEN 'MANAGERS_ON_DUTY' ELSE kind END)
                 FROM jsonb_array_elements_text(rules."rule" -> 'recipients') AS kind)
            )
            ELSE rules."rule"
        END
    )
    FROM jsonb_each(s."value") AS rules("event", "rule")
)
WHERE s."key" = 'notifications.rules' AND jsonb_typeof(s."value") = 'object'
  AND s."value"::text LIKE '%"CASHIER"%';

-- The type without CASHIER.
ALTER TYPE "StaffRole" RENAME TO "StaffRole_old";
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'WAITER', 'KITCHEN');
ALTER TABLE "roles" ALTER COLUMN "base_role" TYPE "StaffRole" USING "base_role"::text::"StaffRole";
DROP TYPE "StaffRole_old";
