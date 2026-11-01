import { Injectable } from '@nestjs/common';
import type {
  BillHistoryEntry,
  BillHistoryInvoiceResponse,
  BillHistoryQuery,
  BillHistoryResponse,
} from '@rp/contracts';
import { IsoDate } from '@rp/contracts';
import { isoDateOf } from '../common/business-dates.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppError } from '../errors/app-error.js';
import { Prisma } from '../generated/prisma/client.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { billTextLines } from '../printing/escpos.js';

/** Where a page ended: the last invoice's business date, time of issue and id. */
interface Cursor {
  readonly businessDate: string;
  readonly issuedAt: string;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.businessDate}|${cursor.issuedAt}|${cursor.id}`).toString(
    'base64url',
  );
}

function decodeCursor(text: string): Cursor {
  const [businessDate = '', issuedAt = '', id = ''] = Buffer.from(text, 'base64url')
    .toString('utf8')
    .split('|');
  if (
    !IsoDate.safeParse(businessDate).success ||
    Number.isNaN(Date.parse(issuedAt)) ||
    !UUID.test(id)
  ) {
    throw new AppError(400, 'VALIDATION_FAILED', 'That page of bills is not known. Search again.');
  }
  return { businessDate, issuedAt, id };
}

/** The last ten digits of a phone number, however it was typed (the index's expression). */
function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

/**
 * The bill history (P9-27, DATA-012): any invoice still on the PC, found by business dates, its
 * number or the guest's phone number, newest first, a page at a time with a cursor. Each filter is
 * served by an index on invoices (the dates with the order, the running number, the phone's last
 * ten digits), so a page is quick however many years are kept. Read on the PC only.
 */
@Injectable()
export class BillHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  async find(restaurantId: string, query: BillHistoryQuery): Promise<BillHistoryResponse> {
    const limit = query.limit;
    const filters: Prisma.Sql[] = [Prisma.sql`i.restaurant_id = ${restaurantId}::uuid`];
    if (query.from !== undefined) filters.push(Prisma.sql`i.business_date >= ${query.from}::date`);
    if (query.to !== undefined) filters.push(Prisma.sql`i.business_date <= ${query.to}::date`);
    if (query.number !== undefined) {
      const number = query.number;
      filters.push(
        /^\d+$/.test(number) && number.length <= 9
          ? Prisma.sql`(i.sequence = ${Number(number)}::int OR i.invoice_number = ${number})`
          : Prisma.sql`i.invoice_number IN (${number}, ${number.toUpperCase()})`,
      );
    }
    if (query.phone !== undefined) {
      // The same expression as the partial index on invoices (migration 20261101140000).
      filters.push(Prisma.sql`i.customer_phone IS NOT NULL
        AND right(regexp_replace(i.customer_phone, '[^0-9]', '', 'g'), 10) = ${phoneKey(query.phone)}`);
    }
    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);
      filters.push(
        Prisma.sql`(i.business_date, i.issued_at, i.id) < (${after.businessDate}::date, ${after.issuedAt}::timestamptz, ${after.id}::uuid)`,
      );
    }
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        invoice_number: string;
        business_date: Date;
        issued_at: Date;
        status: BillHistoryEntry['status'];
        grand_total: number;
        table_label: string | null;
        takeaway_token: number | null;
      }[]
    >`
      SELECT i.id, i.invoice_number, i.business_date, i.issued_at, i.status::text AS status,
             i.grand_total, t.label AS table_label, o.takeaway_token
      FROM invoices i
      LEFT JOIN table_sessions s ON s.id = i.table_session_id
      LEFT JOIN tables t ON t.id = s.table_id
      LEFT JOIN orders o ON o.id = i.order_id
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY i.business_date DESC, i.issued_at DESC, i.id DESC
      LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const payments = await this.prisma.payment.findMany({
      where: { invoiceId: { in: page.map((row) => row.id) }, status: 'CAPTURED' },
      select: { invoiceId: true, mode: true, modeLabel: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const modesOf = new Map<string, BillHistoryEntry['payments']>();
    for (const payment of payments) {
      const modes = modesOf.get(payment.invoiceId) ?? [];
      if (!modes.some((mode) => mode.mode === payment.mode && mode.label === payment.modeLabel)) {
        modes.push({ mode: payment.mode, label: payment.modeLabel });
      }
      modesOf.set(payment.invoiceId, modes);
    }
    const last = page.at(-1);
    return {
      invoices: page.map((row) => ({
        invoiceId: row.id,
        invoiceNumber: row.invoice_number,
        businessDate: isoDateOf(row.business_date),
        issuedAt: row.issued_at.toISOString(),
        tableLabel: row.table_label,
        takeawayToken: row.takeaway_token,
        grandTotal: row.grand_total,
        status: row.status,
        payments: modesOf.get(row.id) ?? [],
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({
              businessDate: isoDateOf(last.business_date),
              issuedAt: last.issued_at.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /** One invoice as issued (its current version) and its text as the bill printer prints it. */
  async invoice(restaurantId: string, invoiceId: string): Promise<BillHistoryInvoiceResponse> {
    const [invoice, restaurant] = await Promise.all([
      this.invoices.view(restaurantId, invoiceId),
      this.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: { timeZone: true },
      }),
    ]);
    return { invoice, printed: billTextLines(invoice, restaurant.timeZone) };
  }
}
