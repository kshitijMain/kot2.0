import type { PrismaService, TransactionClient } from '../database/prisma.service.js';

type Client = PrismaService | TransactionClient;

/**
 * The report figures of whole business dates, read from the live tables and grouped by date
 * (P9-27). Day-end sums a closed date with these into the daily summary tables, and the reports
 * read the dates not summed yet with the same queries, so the two always agree.
 */

/** Sales of a date in one hour of issue (restaurant time), as PostgreSQL sums them. */
export interface SalesHourRow {
  readonly business_date: Date;
  readonly hour: number;
  readonly invoices: bigint;
  readonly gross: bigint;
  readonly discounts: bigint;
  readonly service: bigint;
  readonly tax: bigint;
  readonly round_off: bigint;
  readonly net: bigint;
}

/** RPT-001: invoices not voided, by business date and hour of issue. */
export function salesByHour(
  client: Client,
  restaurantId: string,
  timeZone: string,
  dates: readonly string[],
): Promise<SalesHourRow[]> {
  if (dates.length === 0) return Promise.resolve([]);
  return client.$queryRaw<SalesHourRow[]>`
    SELECT business_date, extract(hour FROM issued_at AT TIME ZONE ${timeZone})::int AS hour,
           count(*) AS invoices, coalesce(sum(subtotal), 0) AS gross,
           coalesce(sum(discount_total), 0) AS discounts, coalesce(sum(service_charge), 0) AS service,
           coalesce(sum(tax_total), 0) AS tax, coalesce(sum(round_off), 0) AS round_off,
           coalesce(sum(grand_total), 0) AS net
    FROM invoices
    WHERE restaurant_id = ${restaurantId}::uuid AND status <> 'VOIDED'
      AND business_date = ANY(${dates}::date[])
    GROUP BY 1, 2`;
}

/** A dish's sales on a date. */
export interface ItemDayRow {
  readonly business_date: Date;
  readonly item_id: string;
  readonly quantity: bigint;
  readonly gross: bigint;
  readonly discounts: bigint;
  readonly net: bigint;
  readonly tax: bigint;
}

/**
 * RPT-002: each dish's sales on each date, from its lines as issued (P4-05c). A dish split into
 * equal parts appears on every part at its full quantity: it counts once. The parts of a split
 * are always issued together, on one business date.
 */
export function itemsByDay(
  client: Client,
  restaurantId: string,
  dates: readonly string[],
): Promise<ItemDayRow[]> {
  if (dates.length === 0) return Promise.resolve([]);
  return client.$queryRaw<ItemDayRow[]>`
    WITH live AS NOT MATERIALIZED (
      SELECT id, version, business_date FROM invoices
      WHERE restaurant_id = ${restaurantId}::uuid AND status <> 'VOIDED'
        AND business_date = ANY(${dates}::date[])
    ), lines AS MATERIALIZED (
      SELECT l.business_date, il.item_id, il.order_item_id, il.quantity, il.line_total,
             il.discount, il.taxable_value, il.tax_share
      FROM invoice_lines il JOIN live l ON l.id = il.invoice_id AND il.version = l.version
      WHERE il.order_item_id IS NOT NULL AND il.item_id IS NOT NULL
    ), money AS (
      SELECT business_date, item_id, sum(quantity) AS quantity, sum(line_total) AS gross,
             sum(discount) AS discounts, sum(taxable_value) AS net,
             coalesce(sum(tax_share), 0) AS tax
      FROM lines GROUP BY 1, 2
    ), repeats AS (
      SELECT r.business_date, r.item_id, sum(r.billed - least(oi.quantity, r.billed)) AS excess
      FROM (
        SELECT business_date, order_item_id, item_id, sum(quantity) AS billed
        FROM lines GROUP BY 1, 2, 3 HAVING count(*) > 1
      ) r JOIN order_items oi ON oi.id = r.order_item_id
      GROUP BY 1, 2
    )
    SELECT m.business_date, m.item_id, (m.quantity - coalesce(r.excess, 0))::bigint AS quantity,
           m.gross, m.discounts, m.net, m.tax
    FROM money m
    LEFT JOIN repeats r ON r.business_date = m.business_date AND r.item_id = m.item_id`;
}

/** Payments of one mode (and name, for OTHER) on a date. */
export interface PaymentDayRow {
  readonly business_date: Date;
  readonly mode: 'CASH' | 'CARD' | 'UPI' | 'OTHER';
  readonly mode_label: string | null;
  readonly payments: bigint;
  readonly amount: bigint;
}

/** RPT-005: payments taken, by the business date they were taken and their mode. */
export function paymentsByDay(
  client: Client,
  restaurantId: string,
  dates: readonly string[],
): Promise<PaymentDayRow[]> {
  if (dates.length === 0) return Promise.resolve([]);
  return client.$queryRaw<PaymentDayRow[]>`
    SELECT business_date, mode::text AS mode, mode_label, count(*) AS payments,
           coalesce(sum(amount), 0) AS amount
    FROM payments
    WHERE restaurant_id = ${restaurantId}::uuid AND status = 'CAPTURED'
      AND business_date = ANY(${dates}::date[])
    GROUP BY 1, 2, 3`;
}

/** One person's part of a date. */
export interface StaffDayRow {
  businessDate: string;
  staffId: string;
  ordersCreated: number;
  invoicesIssued: number;
  billed: number;
  net: number;
}

/**
 * RPT-003: who took the orders, who issued the bills (and their value), and the sales of the
 * dishes each person ordered, attributed as the staff report does (whoever created the line, or
 * approved it when a guest ordered).
 */
export async function staffByDay(
  client: Client,
  restaurantId: string,
  dates: readonly string[],
): Promise<StaffDayRow[]> {
  if (dates.length === 0) return [];
  const [created, issued, sales] = await Promise.all([
    client.$queryRaw<{ business_date: Date; staff_id: string; n: bigint }[]>`
      SELECT business_date, created_by_id AS staff_id, count(*) AS n FROM orders
      WHERE restaurant_id = ${restaurantId}::uuid AND created_by_id IS NOT NULL
        AND business_date = ANY(${dates}::date[])
      GROUP BY 1, 2`,
    client.$queryRaw<{ business_date: Date; staff_id: string; n: bigint; billed: bigint }[]>`
      SELECT business_date, issued_by_id AS staff_id, count(*) AS n,
             coalesce(sum(grand_total), 0) AS billed
      FROM invoices
      WHERE restaurant_id = ${restaurantId}::uuid AND status <> 'VOIDED'
        AND business_date = ANY(${dates}::date[])
      GROUP BY 1, 2`,
    client.$queryRaw<{ business_date: Date; staff_id: string; net: bigint }[]>`
      SELECT i.business_date, coalesce(oi.created_by_id, oi.approved_by_id) AS staff_id,
             coalesce(sum(il.taxable_value), 0) AS net
      FROM invoices i
      JOIN invoice_lines il ON il.invoice_id = i.id AND il.version = i.version
      JOIN order_items oi ON oi.id = il.order_item_id
      WHERE i.restaurant_id = ${restaurantId}::uuid AND i.status <> 'VOIDED'
        AND i.business_date = ANY(${dates}::date[])
        AND coalesce(oi.created_by_id, oi.approved_by_id) IS NOT NULL
      GROUP BY 1, 2`,
  ]);
  const rows = new Map<string, StaffDayRow>();
  const entry = (date: Date, staffId: string) => {
    const businessDate = date.toISOString().slice(0, 10);
    const key = `${businessDate}|${staffId}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = { businessDate, staffId, ordersCreated: 0, invoicesIssued: 0, billed: 0, net: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const row of created) entry(row.business_date, row.staff_id).ordersCreated = Number(row.n);
  for (const row of issued) {
    const target = entry(row.business_date, row.staff_id);
    target.invoicesIssued = Number(row.n);
    target.billed = Number(row.billed);
  }
  for (const row of sales) entry(row.business_date, row.staff_id).net = Number(row.net);
  return [...rows.values()];
}
