import { Injectable, Logger } from '@nestjs/common';
import { addDays } from '@rp/domain';
import { dayEndLockKey, dbDate, isoDateOf } from '../common/business-dates.js';
import { PrismaService, type TransactionClient } from '../database/prisma.service.js';
import { itemsByDay, paymentsByDay, salesByHour, staffByDay } from './daily-figures.js';

/** A range of business dates split by where their figures come from. */
export interface SplitRange {
  /** Dates summed and still true: read from the summary tables. */
  readonly summed: string[];
  /** Every other date of the range: read from the live tables. */
  readonly live: string[];
}

/** Closed dates summed per refresh round, newest first, each in its own short transaction. */
const REFRESH_BATCH = 50;

/**
 * The daily summaries (P9-27, RPT-001 to RPT-005, RPT-018, DATA-012). Day-end sums a closed
 * business date into the summary tables in its own transaction; the reports read those for
 * closed dates and the live tables only for the rest, so a month ago reads a few hundred rows
 * however old it is. A change that still reaches a summed date (an edited bill of a table carried
 * forward, an old bill voided) marks it stale through a database trigger; until `refresh` sums it
 * again the reports read it live, so their figures never differ from the live tables'.
 *
 * Building a date takes day-end's lock alone, like day-end: writers share it (the trigger too), so
 * a summary never misses a change committed while it is built.
 */
@Injectable()
export class DailySummariesService {
  private readonly logger = new Logger(DailySummariesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sums `businessDate` into the summary tables, replacing what was there. The caller holds
   * day-end's lock alone (day-end's close, or `refresh`).
   */
  async build(tx: TransactionClient, restaurantId: string, businessDate: string): Promise<void> {
    const date = dbDate(businessDate);
    const { timeZone } = await tx.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { timeZone: true },
    });
    const dates = [businessDate];
    const [hours, items, payments, staff] = await Promise.all([
      salesByHour(tx, restaurantId, timeZone, dates),
      itemsByDay(tx, restaurantId, dates),
      paymentsByDay(tx, restaurantId, dates),
      staffByDay(tx, restaurantId, dates),
    ]);
    const where = { restaurantId, businessDate: date };
    await tx.dailySalesHour.deleteMany({ where });
    await tx.dailyItemSales.deleteMany({ where });
    await tx.dailyPaymentMode.deleteMany({ where });
    await tx.dailyStaffSales.deleteMany({ where });
    await tx.dailySalesHour.createMany({
      data: hours.map((row) => ({
        ...where,
        hour: row.hour,
        invoices: Number(row.invoices),
        grossSales: row.gross,
        discounts: row.discounts,
        serviceCharge: row.service,
        tax: row.tax,
        roundOff: row.round_off,
        netSales: row.net,
      })),
    });
    await tx.dailyItemSales.createMany({
      data: items.map((row) => ({
        ...where,
        itemId: row.item_id,
        quantity: Number(row.quantity),
        gross: row.gross,
        discounts: row.discounts,
        net: row.net,
        tax: row.tax,
      })),
    });
    await tx.dailyPaymentMode.createMany({
      data: payments.map((row) => ({
        ...where,
        mode: row.mode,
        modeLabel: row.mode_label,
        payments: Number(row.payments),
        amount: row.amount,
      })),
    });
    await tx.dailyStaffSales.createMany({
      data: staff.map((row) => ({
        ...where,
        staffId: row.staffId,
        ordersCreated: row.ordersCreated,
        invoicesIssued: row.invoicesIssued,
        billed: BigInt(row.billed),
        net: BigInt(row.net),
      })),
    });
    const now = new Date();
    await tx.dailySummary.upsert({
      where: { restaurantId_businessDate: where },
      create: { ...where, stale: false, builtAt: now },
      update: { stale: false, builtAt: now },
    });
  }

  /**
   * Sums the closed dates that have no summary yet (the days closed before P9-27) or a stale one,
   * newest first, one date per transaction. Idempotent; returns how many dates it summed.
   */
  async refresh(restaurantId: string): Promise<number> {
    let built = 0;
    for (;;) {
      const before = built;
      const due = await this.due(this.prisma, restaurantId, REFRESH_BATCH);
      for (const businessDate of due) {
        const done = await this.prisma.transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${dayEndLockKey(restaurantId)}, 0))`;
            // Summed meanwhile (day-end, or another round): nothing to do.
            if (!(await this.isDue(tx, restaurantId, businessDate))) return false;
            await this.build(tx, restaurantId, businessDate);
            return true;
          },
          { timeout: 60_000 },
        );
        if (done) built += 1;
      }
      // A full round with nothing left to sum means the rest changes as fast as it is summed.
      if (due.length < REFRESH_BATCH || built === before) return built;
    }
  }

  /** `refresh` for every restaurant on this server. */
  async refreshAll(): Promise<number> {
    const restaurants = await this.prisma.restaurant.findMany({ select: { id: true } });
    let built = 0;
    for (const { id } of restaurants) built += await this.refresh(id);
    if (built > 0) this.logger.log(`Summed ${String(built)} closed business dates.`);
    return built;
  }

  /** Splits `from`..`to` into the dates summed (and still true) and the rest. */
  async split(restaurantId: string, range: { from: string; to: string }): Promise<SplitRange> {
    const rows = await this.prisma.dailySummary.findMany({
      where: {
        restaurantId,
        stale: false,
        businessDate: { gte: dbDate(range.from), lte: dbDate(range.to) },
      },
      select: { businessDate: true },
    });
    const summed = new Set(rows.map((row) => isoDateOf(row.businessDate)));
    const live: string[] = [];
    for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
      if (!summed.has(date)) live.push(date);
    }
    return { summed: [...summed].sort(), live };
  }

  /** Closed dates without a true summary, newest first. */
  private async due(
    client: PrismaService | TransactionClient,
    restaurantId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await client.$queryRaw<{ business_date: Date }[]>`
      SELECT bd.business_date FROM business_days bd
      LEFT JOIN daily_summaries ds
        ON ds.restaurant_id = bd.restaurant_id AND ds.business_date = bd.business_date
      WHERE bd.restaurant_id = ${restaurantId}::uuid AND bd.status = 'CLOSED'
        AND (ds.id IS NULL OR ds.stale)
      ORDER BY bd.business_date DESC
      LIMIT ${limit}`;
    return rows.map((row) => isoDateOf(row.business_date));
  }

  private async isDue(
    tx: TransactionClient,
    restaurantId: string,
    businessDate: string,
  ): Promise<boolean> {
    const where = {
      restaurantId_businessDate: { restaurantId, businessDate: dbDate(businessDate) },
    };
    const [day, summary] = await Promise.all([
      tx.businessDay.findUnique({ where, select: { status: true } }),
      tx.dailySummary.findUnique({ where, select: { stale: true } }),
    ]);
    return day?.status === 'CLOSED' && (summary === null || summary.stale);
  }
}
