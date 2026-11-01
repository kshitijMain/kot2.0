import { Injectable } from '@nestjs/common';
import {
  type GstSummaryResponse,
  type InvoiceRegisterResponse,
  type ItemSalesResponse,
  PaymentMode,
  type PaymentModesResponse,
  type ReportRangeQuery,
  type SalesSummaryResponse,
  type ShiftReportResponse,
} from '@rp/contracts';
import { expectedCash } from '@rp/domain';
import { dbDate, isoDateOf } from '../common/business-dates.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type ItemDayRow,
  itemsByDay,
  type PaymentDayRow,
  paymentsByDay,
  type SalesHourRow,
  salesByHour,
} from './daily-figures.js';
import { DailySummariesService } from './daily-summaries.service.js';

type Totals = SalesSummaryResponse['totals'];

function emptyTotals(): Totals {
  return {
    invoices: 0,
    grossSales: 0,
    discounts: 0,
    serviceCharge: 0,
    tax: 0,
    roundOff: 0,
    netSales: 0,
  };
}

/** Sums PostgreSQL gives for a group of invoices (bigint for counts and sums). */
type SumRow = Omit<SalesHourRow, 'business_date' | 'hour'>;

function addSums(totals: Totals, row: SumRow): Totals {
  totals.invoices += Number(row.invoices);
  totals.grossSales += Number(row.gross);
  totals.discounts += Number(row.discounts);
  totals.serviceCharge += Number(row.service);
  totals.tax += Number(row.tax);
  totals.roundOff += Number(row.round_off);
  totals.netSales += Number(row.net);
  return totals;
}

/** The totals kept under `key`, started empty. */
function bucket<K>(map: Map<K, Totals>, key: K): Totals {
  let totals = map.get(key);
  if (totals === undefined) {
    totals = emptyTotals();
    map.set(key, totals);
  }
  return totals;
}

/**
 * Core reports v1 (P1-13a). Figures come from invoices as issued (at their current version,
 * P1-10c), never from the menu, so a report of any past date shows what was billed. Voided
 * invoices count in no totals; the invoice register lists them with their reason.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: DailySummariesService,
  ) {}

  /**
   * RPT-001: sales by business date and by hour (restaurant time). Closed dates come from their
   * daily summary, the rest from the invoices, summed in PostgreSQL either way (P9-27).
   */
  async sales(restaurantId: string, range: ReportRangeQuery): Promise<SalesSummaryResponse> {
    const [restaurant, split] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: { timeZone: true },
      }),
      this.summaries.split(restaurantId, range),
    ]);
    const [summed, live] = await Promise.all([
      split.summed.length === 0
        ? []
        : this.prisma.$queryRaw<SalesHourRow[]>`
            SELECT business_date, hour, invoices::bigint AS invoices, gross_sales AS gross,
                   discounts, service_charge AS service, tax, round_off, net_sales AS net
            FROM daily_sales_hours
            WHERE restaurant_id = ${restaurantId}::uuid
              AND business_date = ANY(${split.summed}::date[])`,
      salesByHour(this.prisma, restaurantId, restaurant.timeZone, split.live),
    ]);
    const byDay = new Map<string, Totals>();
    const byHour = new Map<number, Totals>();
    const totals = emptyTotals();
    for (const row of [...summed, ...live]) {
      addSums(bucket(byDay, isoDateOf(row.business_date)), row);
      addSums(bucket(byHour, row.hour), row);
      addSums(totals, row);
    }
    return {
      ...range,
      totals,
      byDay: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([businessDate, figures]) => ({ businessDate, ...figures })),
      byHour: [...byHour.entries()]
        .sort(([a], [b]) => a - b)
        .map(([hour, figures]) => ({ hour, ...figures })),
    };
  }

  /**
   * RPT-002: item-wise and category-wise sales from each line's dish and tax share as issued
   * (P4-05c): closed dates from their daily summary, the rest from the invoice lines (P9-27), so a
   * year at design capacity stays well within RPT-018. A dish's category is its current one.
   */
  async items(restaurantId: string, range: ReportRangeQuery): Promise<ItemSalesResponse> {
    const split = await this.summaries.split(restaurantId, range);
    const [summed, live] = await Promise.all([
      split.summed.length === 0
        ? []
        : this.prisma.$queryRaw<Omit<ItemDayRow, 'business_date'>[]>`
            SELECT item_id, sum(quantity)::bigint AS quantity, sum(gross)::bigint AS gross,
                   sum(discounts)::bigint AS discounts, sum(net)::bigint AS net,
                   sum(tax)::bigint AS tax
            FROM daily_item_sales
            WHERE restaurant_id = ${restaurantId}::uuid
              AND business_date = ANY(${split.summed}::date[])
            GROUP BY 1`,
      itemsByDay(this.prisma, restaurantId, split.live),
    ]);
    type Figures = ItemSalesResponse['items'][number];
    const money = new Map<string, Omit<Figures, 'itemId' | 'name' | 'categoryId' | 'category'>>();
    for (const row of [...summed, ...live]) {
      const entry = money.get(row.item_id) ?? {
        quantity: 0,
        gross: 0,
        discounts: 0,
        net: 0,
        tax: 0,
      };
      entry.quantity += Number(row.quantity);
      entry.gross += Number(row.gross);
      entry.discounts += Number(row.discounts);
      entry.net += Number(row.net);
      entry.tax += Number(row.tax);
      money.set(row.item_id, entry);
    }
    const dishes = await this.prisma.item.findMany({
      where: { id: { in: [...money.keys()] } },
      select: { id: true, name: true, category: { select: { id: true, name: true } } },
    });
    const items: Figures[] = dishes.map((dish) => ({
      itemId: dish.id,
      name: dish.name,
      categoryId: dish.category.id,
      category: dish.category.name,
      ...(money.get(dish.id) ?? { quantity: 0, gross: 0, discounts: 0, net: 0, tax: 0 }),
    }));
    const categories = new Map<string, ItemSalesResponse['categories'][number]>();
    for (const item of items) {
      const entry = categories.get(item.categoryId) ?? {
        categoryId: item.categoryId,
        category: item.category,
        quantity: 0,
        gross: 0,
        discounts: 0,
        net: 0,
        tax: 0,
      };
      entry.quantity += item.quantity;
      entry.gross += item.gross;
      entry.discounts += item.discounts;
      entry.net += item.net;
      entry.tax += item.tax;
      categories.set(item.categoryId, entry);
    }
    const byGross = <T extends { gross: number; name?: string; category: string }>(a: T, b: T) =>
      b.gross - a.gross || (a.name ?? a.category).localeCompare(b.name ?? b.category);
    return {
      ...range,
      items: items.sort(byGross),
      categories: [...categories.values()].sort(byGross),
    };
  }

  /**
   * RPT-005: payments per mode, by the business date they were taken: closed dates from their
   * daily summary, the rest from the payments (P9-27).
   */
  async payments(restaurantId: string, range: ReportRangeQuery): Promise<PaymentModesResponse> {
    const split = await this.summaries.split(restaurantId, range);
    const [summed, live] = await Promise.all([
      split.summed.length === 0
        ? []
        : this.prisma.$queryRaw<Omit<PaymentDayRow, 'business_date'>[]>`
            SELECT mode::text AS mode, mode_label, sum(payments)::bigint AS payments,
                   sum(amount)::bigint AS amount
            FROM daily_payment_modes
            WHERE restaurant_id = ${restaurantId}::uuid
              AND business_date = ANY(${split.summed}::date[])
            GROUP BY 1, 2`,
      paymentsByDay(this.prisma, restaurantId, split.live),
    ]);
    const modes = new Map<string, PaymentModesResponse['modes'][number]>();
    for (const row of [...summed, ...live]) {
      const key = `${row.mode}|${row.mode_label ?? ''}|${String(row.mode_label === null)}`;
      const entry = modes.get(key) ?? {
        mode: row.mode,
        label: row.mode_label,
        count: 0,
        amount: 0,
      };
      entry.count += Number(row.payments);
      entry.amount += Number(row.amount);
      modes.set(key, entry);
    }
    // As PostgreSQL orders them: modes as declared, then names, no name last.
    const order = PaymentMode.options;
    const sorted = [...modes.values()].sort(
      (a, b) =>
        order.indexOf(a.mode) - order.indexOf(b.mode) ||
        (a.label === null ? 1 : 0) - (b.label === null ? 1 : 0) ||
        (a.label ?? '').localeCompare(b.label ?? ''),
    );
    return {
      ...range,
      modes: sorted,
      total: sorted.reduce((total, mode) => total + mode.amount, 0),
    };
  }

  /**
   * RPT-005: shifts with cash and variance; `staffId` limits it to that person's own (OWN). Cash taken
   * and moved in or out is summed for all the shifts at once, so a year of shifts is three queries.
   */
  async shiftReport(
    restaurantId: string,
    range: ReportRangeQuery,
    staffId: string | null,
  ): Promise<ShiftReportResponse> {
    const rows = await this.prisma.shift.findMany({
      where: {
        restaurantId,
        businessDate: { gte: dbDate(range.from), lte: dbDate(range.to) },
        ...(staffId !== null && { staffId }),
      },
      include: { staff: { select: { displayName: true } } },
      orderBy: { openedAt: 'asc' },
    });
    const ids = rows.map((row) => row.id);
    const [cash, moved] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['shiftId'],
        where: { shiftId: { in: ids }, mode: 'CASH', status: 'CAPTURED' },
        _sum: { amount: true },
      }),
      this.prisma.cashMovement.groupBy({
        by: ['shiftId', 'direction'],
        where: { shiftId: { in: ids } },
        _sum: { amount: true },
      }),
    ]);
    const cashOf = new Map(cash.map((row) => [row.shiftId, row._sum.amount ?? 0]));
    const movedOf = (shiftId: string, direction: 'IN' | 'OUT') =>
      moved.find((row) => row.shiftId === shiftId && row.direction === direction)?._sum.amount ?? 0;
    const paise = (value: bigint | null) => (value === null ? null : Number(value));
    const shifts = rows.map((row) => {
      const totals = {
        openingFloat: Number(row.openingFloat),
        cashPayments: cashOf.get(row.id) ?? 0,
        cashIn: movedOf(row.id, 'IN'),
        cashOut: movedOf(row.id, 'OUT'),
      };
      return {
        shiftId: row.id,
        staffId: row.staffId,
        staffName: row.staff.displayName,
        businessDate: isoDateOf(row.businessDate),
        status: row.status,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        ...totals,
        expectedCash: paise(row.expectedCash) ?? expectedCash(totals),
        countedCash: paise(row.countedCash),
        variance: paise(row.variance),
      };
    });
    return {
      ...range,
      shifts,
      totalVariance: shifts.reduce((total, shift) => total + (shift.variance ?? 0), 0),
    };
  }

  /**
   * RPT-006: taxable value and each tax component by SAC and rate, summed in PostgreSQL. One
   * taxed amount is a tax group's components on one taxable value of one invoice; its SAC is the
   * one on that group's lines.
   */
  async gst(restaurantId: string, range: ReportRangeQuery): Promise<GstSummaryResponse> {
    const rows = await this.prisma.$queryRaw<
      { sac_code: string | null; rate_bp: number; code: string; amount: bigint; taxable: bigint }[]
    >`
      -- One pass over each table, aggregated by hash (P8-01a): a year took 3.7 s with the tax
      -- lines joined to themselves and each invoice's SAC code picked by sorting every line.
      WITH live AS NOT MATERIALIZED (
        SELECT id, version FROM invoices
        WHERE restaurant_id = ${restaurantId}::uuid AND status <> 'VOIDED'
          AND business_date BETWEEN ${range.from}::date AND ${range.to}::date
      ), clusters AS (
        -- A tax group's components on one invoice at one taxable value: their rate and amounts.
        SELECT tl.invoice_id, tl.tax_group_id, tl.taxable_value, sum(tl.rate_bp)::int AS rate_bp,
               array_agg(tl.code) AS codes, array_agg(tl.amount) AS amounts
        FROM tax_lines tl JOIN live l ON l.id = tl.invoice_id AND tl.version = l.version
        GROUP BY 1, 2, 3
      ), sac AS (
        -- The tax group's SAC code on the invoice: the first in order, nulls last.
        SELECT il.invoice_id, il.tax_group_id, min(il.sac_code) AS sac_code
        FROM invoice_lines il JOIN live l ON l.id = il.invoice_id AND il.version = l.version
        WHERE il.tax_group_id IS NOT NULL
        GROUP BY 1, 2
      ), keyed AS (
        SELECT c.taxable_value, c.rate_bp, c.codes, c.amounts, s.sac_code
        FROM clusters c
        LEFT JOIN sac s ON s.invoice_id = c.invoice_id AND s.tax_group_id = c.tax_group_id
      ), taxable AS (
        SELECT sac_code, rate_bp, sum(taxable_value) AS taxable FROM keyed GROUP BY 1, 2
      ), parts AS (
        SELECT k.sac_code, k.rate_bp, part.code, sum(part.amount) AS amount
        FROM keyed k CROSS JOIN LATERAL unnest(k.codes, k.amounts) AS part (code, amount)
        GROUP BY 1, 2, 3
      )
      SELECT p.sac_code, p.rate_bp, p.code, p.amount, tx.taxable
      FROM parts p
      JOIN taxable tx ON tx.sac_code IS NOT DISTINCT FROM p.sac_code AND tx.rate_bp = p.rate_bp
      ORDER BY coalesce(p.sac_code, ''), p.rate_bp, p.code`;
    const summary = new Map<
      string,
      {
        sacCode: string | null;
        rateBp: number;
        taxableValue: number;
        components: Record<string, number>;
      }
    >();
    for (const row of rows) {
      const key = `${row.sac_code ?? ''}|${String(row.rate_bp)}`;
      const entry = summary.get(key) ?? {
        sacCode: row.sac_code,
        rateBp: row.rate_bp,
        taxableValue: Number(row.taxable),
        components: {},
      };
      entry.components[row.code] = (entry.components[row.code] ?? 0) + Number(row.amount);
      summary.set(key, entry);
    }
    const result = [...summary.values()].map((row) => ({
      ...row,
      taxTotal: Object.values(row.components).reduce((total, amount) => total + amount, 0),
    }));
    const components: Record<string, number> = {};
    for (const row of result) {
      for (const [code, amount] of Object.entries(row.components)) {
        components[code] = (components[code] ?? 0) + amount;
      }
    }
    return {
      ...range,
      rows: result,
      totals: {
        taxableValue: result.reduce((total, row) => total + row.taxableValue, 0),
        components,
        taxTotal: result.reduce((total, row) => total + row.taxTotal, 0),
      },
    };
  }

  /**
   * RPT-006: every invoice number of the invoice-date range in sequence, voided ones included, a
   * page at a time; the CSV export takes the whole range (no `page`).
   */
  async register(
    restaurantId: string,
    range: ReportRangeQuery,
    page?: { readonly offset: number; readonly limit: number },
  ): Promise<InvoiceRegisterResponse> {
    const offset = page?.offset ?? 0;
    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          invoice_number: string;
          invoice_date: Date;
          business_date: Date;
          series: string;
          status: 'ISSUED' | 'SETTLED' | 'VOIDED';
          customer_name: string | null;
          customer_gstin: string | null;
          tax_total: number;
          round_off: number;
          grand_total: number;
          void_reason: string | null;
          replaces: string | null;
        }[]
      >`
      SELECT i.id, i.invoice_number, i.invoice_date, i.business_date, s.name AS series,
             i.status::text AS status, i.customer_name, i.customer_gstin, i.tax_total,
             i.round_off, i.grand_total, i.void_reason, r.invoice_number AS replaces
      FROM invoices i
      JOIN invoice_series s ON s.id = i.series_id
      LEFT JOIN invoices r ON r.id = i.replaces_invoice_id
      WHERE i.restaurant_id = ${restaurantId}::uuid
        AND i.invoice_date BETWEEN ${range.from}::date AND ${range.to}::date
      ORDER BY s.name, i.financial_year, i.sequence
      OFFSET ${offset} LIMIT ${page?.limit ?? null}`,
      this.prisma.$queryRaw<{ total: bigint; voided: bigint }[]>`
        SELECT count(*) AS total, count(*) FILTER (WHERE status = 'VOIDED') AS voided
        FROM invoices
        WHERE restaurant_id = ${restaurantId}::uuid
          AND invoice_date BETWEEN ${range.from}::date AND ${range.to}::date`,
    ]);
    const total = Number(counted[0]?.total ?? 0);
    return {
      from: range.from,
      to: range.to,
      total,
      voided: Number(counted[0]?.voided ?? 0),
      offset,
      nextOffset: offset + rows.length < total && page !== undefined ? offset + rows.length : null,
      invoices: rows.map((row) => ({
        invoiceId: row.id,
        invoiceNumber: row.invoice_number,
        invoiceDate: isoDateOf(row.invoice_date),
        businessDate: isoDateOf(row.business_date),
        series: row.series,
        status: row.status,
        customerName: row.customer_name,
        customerGstin: row.customer_gstin,
        // Taxable value in either price mode: the total without tax and round-off.
        taxableValue: row.grand_total - row.tax_total - row.round_off,
        taxTotal: row.tax_total,
        grandTotal: row.grand_total,
        voidReason: row.void_reason,
        replacesInvoiceNumber: row.replaces,
      })),
    };
  }
}
