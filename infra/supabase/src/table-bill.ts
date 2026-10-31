import { QrTableBill, type QrTableBillResponse } from '@rp/contracts/relay';
import { isoUtc } from './db.js';
import { openTable } from './diner.js';
import { type Handler, json, serveWith } from './http.js';
import { readThrottle } from './read-throttle.js';

/**
 * GET table-bill (P9-03, ADR-0024): the printed bill of the table the code opens, for this sitting
 * only, with how to pay it by UPI; null before the bill is printed and after the table closes.
 * Row-Level Security limits it to the token's own table.
 */
export const tableBill: Handler = serveWith('GET', (request, context) => {
  readThrottle.admit(request);
  return context.db.transaction(async (tx) => {
    await openTable(tx, request);
    const [row] = await tx.query<{ bill: unknown; updated_at: string }>(
      `SELECT bill, ${isoUtc('updated_at')} AS updated_at FROM relay.qr_table_bills`,
    );
    const parsed =
      row === undefined || row.bill === null ? undefined : QrTableBill.safeParse(row.bill);
    const body: QrTableBillResponse =
      parsed?.success === true
        ? { bill: parsed.data, updatedAt: row?.updated_at ?? null }
        : { bill: null, updatedAt: row?.updated_at ?? null };
    return json(200, body);
  });
});
