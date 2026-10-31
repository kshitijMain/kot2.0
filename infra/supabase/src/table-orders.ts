import { DINER_PHONE_HEADER, DinerPhone, type QrTableOrdersResponse } from '@rp/contracts/relay';
import { isoUtc } from './db.js';
import { ORDER_COLUMNS, openTable, type OrderRow, orderView } from './diner.js';
import { type Handler, HttpError, json, serveWith } from './http.js';
import { readThrottle } from './read-throttle.js';

/**
 * However long ago the restaurant last said the table closed, orders older than this are never
 * shown: a PC that was offline when the table closed must not show the next party an earlier
 * one's orders.
 */
export const SITTING_MAX_HOURS = 12;

/**
 * GET table-orders (P9-08, ADR-0024): the orders the number in `x-rp-diner-phone` placed at the
 * code's table during this sitting, newest first, so "My orders" and the bill's estimate are the
 * same on every phone and browser where the diner gives the same number at that table. Row-Level
 * Security keeps it to the code's own table; nothing of another table or restaurant is reachable.
 */
export const tableOrders: Handler = serveWith('GET', (request, context) => {
  readThrottle.admit(request);
  const phone = DinerPhone.safeParse(request.headers.get(DINER_PHONE_HEADER));
  if (!phone.success) {
    throw new HttpError(
      400,
      'VALIDATION_FAILED',
      `Send the mobile number as +91 and ten digits in ${DINER_PHONE_HEADER}.`,
    );
  }
  return context.db.transaction(async (tx) => {
    await openTable(tx, request);
    const [sitting] = await tx.query<{ since: string | null }>(
      `SELECT ${isoUtc('last_closed_at')} AS since FROM relay.qr_table_bills`,
    );
    const since = sitting?.since ?? null;
    const rows = await tx.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM relay.qr_orders
       WHERE customer_phone = $1
         AND submitted_at > coalesce($2::timestamptz, '-infinity'::timestamptz)
         AND submitted_at > now() - make_interval(hours => $3)
       ORDER BY submitted_at DESC, id
       LIMIT 50`,
      [phone.data, since, SITTING_MAX_HOURS],
    );
    const body: QrTableOrdersResponse = { orders: rows.map(orderView), since };
    return json(200, body);
  });
});
