import type { PrismaService, TransactionClient } from '../database/prisma.service.js';
import { AppError } from '../errors/app-error.js';

type Client = PrismaService | TransactionClient;

/** Items in these states are on the bill (`isBillable` in @rp/domain). */
const BILLABLE = ['SENT', 'PREPARING', 'READY', 'PICKED_UP', 'SERVED'] as const;

/** Why an outdated invoice is cancelled when the new one prints (ADR-0031), as audited. */
export const OUTDATED_REASON = 'Items added after the bill was printed';

/**
 * The printed invoice a bill has outgrown (ADR-0031): its only live invoice, unpaid, while dishes
 * were ordered after it was printed. It cannot be paid or printed again; the next Print cancels it
 * and issues a new one with every dish. A bill already part paid or split keeps its invoices, and
 * the new dishes get one of their own (QA-022), so none of those is outdated.
 */
export async function outdatedInvoiceId(
  client: Client,
  restaurantId: string,
  billId: string,
): Promise<string | null> {
  const live = await client.invoice.findMany({
    where: { restaurantId, billId, status: { not: 'VOIDED' } },
    select: {
      id: true,
      status: true,
      _count: { select: { payments: { where: { status: 'CAPTURED' } } } },
    },
  });
  const only = live.length === 1 ? live[0] : undefined;
  if (only?.status !== 'ISSUED' || only._count.payments > 0) return null;
  const bill = await client.bill.findUnique({
    where: { id: billId },
    select: { tableSessionId: true, orderId: true },
  });
  if (bill === null) return null;
  const unbilled = await client.orderItem.count({
    where: {
      restaurantId,
      parentOrderItemId: null,
      state: { in: [...BILLABLE] },
      order:
        bill.tableSessionId !== null
          ? { tableSessionId: bill.tableSessionId }
          : { id: bill.orderId ?? '' },
      invoiceLines: { none: { invoice: { billId, status: { not: 'VOIDED' } } } },
    },
  });
  return unbilled > 0 ? only.id : null;
}

/** Refuses to take payment for, or print again, a bill that dishes were added to since. */
export async function assertNotOutdated(
  client: Client,
  restaurantId: string,
  invoiceId: string,
): Promise<void> {
  const invoice = await client.invoice.findFirst({
    where: { id: invoiceId, restaurantId },
    select: { billId: true },
  });
  if (invoice?.billId === null || invoice === null) return;
  if ((await outdatedInvoiceId(client, restaurantId, invoice.billId)) === invoiceId) {
    throw new AppError(
      409,
      'BILL_OUTDATED',
      'Dishes were added after this bill was printed. Print the new bill, then take payment.',
    );
  }
}
