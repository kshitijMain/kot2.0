import { addDays, businessDateOf } from '@rp/domain';
import type { TransactionClient } from '../database/prisma.service.js';

/** A `@db.Date` column value for an ISO date ('2026-09-26'). */
export function dbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** The ISO date of a `@db.Date` column value. */
export function isoDateOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The lock day-end holds alone while it closes a day (BILL-013); others share it. */
export function dayEndLockKey(restaurantId: string): string {
  return `day-end:${restaurantId}`;
}

/**
 * The restaurant's business date at `now` (its cut-off and time zone, BRD §9.4). Once a day is
 * closed at day-end (BILL-013) nothing more is recorded on it: until the clock reaches the next
 * cut-off, new orders, bills and payments belong to the following business date.
 *
 * Inside a transaction it first shares day-end's lock until the transaction ends, so a record
 * dated here cannot land on a day that day-end closes at the same moment and leave the day's
 * report (QA-010): a running day-end is waited for, and day-end waits for records already being
 * written. Day-end's own transaction holds the lock alone and is never blocked by itself.
 */
export async function currentBusinessDate(
  client: Pick<TransactionClient, 'restaurant' | 'businessDay' | '$queryRaw'>,
  restaurantId: string,
  now: Date = new Date(),
): Promise<string> {
  await client.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock_shared(hashtextextended(${dayEndLockKey(restaurantId)}, 0))`;
  const restaurant = await client.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timeZone: true, businessDayCutoff: true },
  });
  let date = businessDateOf(now, {
    cutoff: restaurant.businessDayCutoff,
    timeZone: restaurant.timeZone,
  });
  const closed = await client.businessDay.findMany({
    where: { restaurantId, status: 'CLOSED', businessDate: { gte: dbDate(date) } },
    select: { businessDate: true },
  });
  const closedDates = new Set(closed.map((day) => isoDateOf(day.businessDate)));
  while (closedDates.has(date)) date = addDays(date, 1);
  return date;
}
