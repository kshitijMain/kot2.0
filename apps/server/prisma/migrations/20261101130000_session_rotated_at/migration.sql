-- P9-25: when the refresh token last rotated, so a reply lost to a restart is not taken for a leak.
ALTER TABLE "sessions" ADD COLUMN "rotated_at" TIMESTAMPTZ(3);
