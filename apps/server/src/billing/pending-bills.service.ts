import { Injectable } from '@nestjs/common';
import type { PendingBill, PendingBillsResponse } from '@rp/contracts';
import { isBillable } from '@rp/domain';
import { PrismaService } from '../database/prisma.service.js';
import type { TableState } from '../generated/prisma/client.js';
import { BillsService } from './bills.service.js';

/** What a pending row is worked out from: a table session's or a takeaway order's. */
interface Target {
  readonly kind: PendingBill['kind'];
  readonly tableSessionId: string | null;
  readonly orderId: string | null;
  readonly tableLabel: string | null;
  readonly takeawayToken: number | null;
  /** The bill was asked for and still stands (a table in BILL_REQUESTED, a takeaway asked). */
  readonly asked: boolean;
  readonly askedAt: Date | null;
  readonly startedAt: Date;
  readonly bill: { readonly id: string; readonly createdAt: Date } | null;
}

/**
 * Pending bills (ADR-0030, item A): the bills a manager still has to print or take payment for,
 * for the dashboard's Bills page and its live count. A bill is asked for by a waiter or a diner
 * (the table's or takeaway's request) or by a manager, who opens it.
 */
@Injectable()
export class PendingBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bills: BillsService,
  ) {}

  async list(restaurantId: string): Promise<PendingBillsResponse> {
    const waiting: readonly TableState[] = ['BILL_REQUESTED', 'BILL_PRINTED'];
    const [sessions, takeaways] = await Promise.all([
      this.prisma.tableSession.findMany({
        where: {
          restaurantId,
          status: 'OPEN',
          OR: [{ table: { state: { in: [...waiting] } } }, { bill: { isNot: null } }],
        },
        select: {
          id: true,
          openedAt: true,
          billRequestedAt: true,
          table: { select: { label: true, state: true } },
          bill: { select: { id: true, createdAt: true } },
        },
      }),
      this.prisma.order.findMany({
        where: {
          restaurantId,
          orderType: 'TAKEAWAY',
          status: 'OPEN',
          OR: [{ billRequestedAt: { not: null } }, { bill: { isNot: null } }],
        },
        select: {
          id: true,
          takeawayToken: true,
          billRequestedAt: true,
          createdAt: true,
          bill: { select: { id: true, createdAt: true } },
        },
      }),
    ]);
    const targets: Target[] = [
      ...sessions.map((session) => ({
        kind: 'TABLE' as const,
        tableSessionId: session.id,
        orderId: null,
        tableLabel: session.table.label,
        takeawayToken: null,
        asked: session.table.state === 'BILL_REQUESTED',
        askedAt: session.billRequestedAt,
        startedAt: session.openedAt,
        bill: session.bill,
      })),
      ...takeaways.map((order) => ({
        kind: 'TAKEAWAY' as const,
        tableSessionId: null,
        orderId: order.id,
        tableLabel: null,
        takeawayToken: order.takeawayToken,
        asked: order.billRequestedAt !== null,
        askedAt: order.billRequestedAt,
        startedAt: order.createdAt,
        bill: order.bill,
      })),
    ];
    const rows = await Promise.all(targets.map((target) => this.row(restaurantId, target)));
    const bills = rows.filter((row) => row !== null);
    bills.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
    return { bills };
  }

  private async row(restaurantId: string, target: Target): Promise<PendingBill | null> {
    const base = {
      kind: target.kind,
      tableSessionId: target.tableSessionId,
      orderId: target.orderId,
      tableLabel: target.tableLabel,
      takeawayToken: target.takeawayToken,
    };
    if (target.bill === null) {
      if (!target.asked) return null;
      return {
        ...base,
        status: 'REQUESTED',
        amount: await this.dishesSoFar(restaurantId, target),
        since: (target.askedAt ?? target.startedAt).toISOString(),
        billId: null,
        invoiceIds: [],
      };
    }
    const [view, invoices] = await Promise.all([
      this.bills.view(restaurantId, target.bill.id),
      this.prisma.invoice.findMany({
        where: { restaurantId, billId: target.bill.id, status: { in: ['ISSUED', 'SETTLED'] } },
        select: {
          id: true,
          status: true,
          issuedAt: true,
          grandTotal: true,
          payments: { where: { status: 'CAPTURED' }, select: { amount: true } },
        },
        orderBy: { issuedAt: 'asc' },
      }),
    ]);
    const unpaid = invoices.filter((invoice) => invoice.status === 'ISSUED');
    const stale =
      view.status === 'INVOICED' &&
      (view.unbilledOrderItemIds.length > 0 || view.voidedPartIds.length > 0);
    // A bill someone opened is asked for: only a manager opens one (ADR-0030).
    const status = stale
      ? 'NEEDS_NEW_BILL'
      : unpaid.length > 0
        ? 'PRINTED'
        : view.status === 'OPEN'
          ? 'REQUESTED'
          : null;
    if (status === null) return null;
    const paid = invoices.reduce(
      (sum, invoice) =>
        sum +
        (invoice.status === 'SETTLED'
          ? invoice.grandTotal
          : invoice.payments.reduce((part, payment) => part + payment.amount, 0)),
      0,
    );
    const since =
      (target.asked ? target.askedAt : null) ??
      unpaid[0]?.issuedAt ??
      invoices.at(-1)?.issuedAt ??
      target.bill.createdAt;
    return {
      ...base,
      status,
      amount: Math.max(0, view.grandTotal - paid),
      since: since.toISOString(),
      billId: view.id,
      invoiceIds: unpaid.map((invoice) => invoice.id),
    };
  }

  /** Before a bill is open: the billable dishes so far, as the Tables page adds them up. */
  private async dishesSoFar(restaurantId: string, target: Target): Promise<number> {
    const items = await this.prisma.orderItem.findMany({
      where: {
        restaurantId,
        order:
          target.tableSessionId === null
            ? { id: target.orderId ?? '' }
            : { tableSessionId: target.tableSessionId },
      },
      select: { state: true, lineTotal: true },
    });
    return items
      .filter((item) => isBillable(item.state))
      .reduce((sum, item) => sum + item.lineTotal, 0);
  }
}
