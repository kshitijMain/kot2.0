import { isBillable, ORDER_ITEM_STATES } from '@rp/domain';
import type { TransactionClient } from '../database/prisma.service.js';

const BILLABLE_STATES = ORDER_ITEM_STATES.filter((state) => isBillable(state));

/** What still stands between a table's guests and closing their table. */
export interface SessionWork {
  /** Dishes of a diner's order waiting for staff to approve or reject them. */
  readonly waiting: number;
  /** Dishes held back from the kitchen (ORD-016). */
  readonly held: number;
  /** Dishes ordered that no printed (not voided) bill has: ordered after the bill was printed. */
  readonly unbilled: number;
  /** Voided parts of a split bill that were not printed again (QA-026). */
  readonly voidedParts: number;
  /** Printed bills not paid in full, by number. */
  readonly unpaid: readonly string[];
}

/**
 * Everything a table session still has to settle before it can close (QA-024 to QA-026): one
 * rule for closing by payment and for closing without a bill, so neither can leave a dish, an
 * order or a bill behind.
 */
export async function sessionWork(
  tx: TransactionClient,
  restaurantId: string,
  sessionId: string,
): Promise<SessionWork> {
  const ofSession = { restaurantId, order: { tableSessionId: sessionId } };
  const [waiting, held, unbilled, voidedParts, unpaid] = await Promise.all([
    tx.orderItem.count({ where: { ...ofSession, state: 'PENDING_APPROVAL' } }),
    tx.orderItem.count({ where: { ...ofSession, state: 'HELD', parentOrderItemId: null } }),
    tx.orderItem.count({
      where: {
        ...ofSession,
        parentOrderItemId: null,
        state: { in: [...BILLABLE_STATES] },
        invoiceLines: { none: { invoice: { status: { not: 'VOIDED' } } } },
      },
    }),
    tx.invoice.count({
      where: {
        restaurantId,
        tableSessionId: sessionId,
        status: 'VOIDED',
        replacedBy: { none: {} },
        bill: { status: 'INVOICED' },
      },
    }),
    tx.invoice.findMany({
      where: { restaurantId, tableSessionId: sessionId, status: 'ISSUED' },
      select: { invoiceNumber: true },
    }),
  ]);
  return {
    waiting,
    held,
    unbilled,
    voidedParts,
    unpaid: unpaid.map((invoice) => invoice.invoiceNumber),
  };
}
