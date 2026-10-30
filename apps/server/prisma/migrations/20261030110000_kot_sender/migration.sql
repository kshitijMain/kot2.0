-- ADR-0023 (Parts 2 and 4): every KOT records who sent it, so its alerts (out of stock, ready,
-- not collected) go to that person: the waiter who took a staff order, approved a diner's order or
-- fired held dishes. Earlier tickets take the order's creator, else the order's approver.
ALTER TABLE "kots" ADD COLUMN "sent_by_id" UUID;

UPDATE "kots" k SET "sent_by_id" = COALESCE(
    o."created_by_id",
    (SELECT a."approved_by_id" FROM "approvals" a
     WHERE a."order_id" = o."id" AND a."approved_by_id" IS NOT NULL
     ORDER BY a."created_at" LIMIT 1)
)
FROM "orders" o WHERE o."id" = k."order_id";

CREATE INDEX "kots_sent_by_id_business_date_idx" ON "kots"("sent_by_id", "business_date");
