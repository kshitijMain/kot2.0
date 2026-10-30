import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DomainEvent } from '@rp/contracts';
import { planStockOut } from '@rp/domain';
import type { Principal } from '../auth/principal.js';
import type { TransactionClient } from '../database/prisma.service.js';
import { EventBus } from '../events/event-bus.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrderApprovalsService } from './order-approvals.service.js';
import { OrderItemsService, OUT_OF_STOCK_REASON } from './order-items.service.js';

/** The open states a dish's units can be in when it goes out of stock. */
const OPEN_STATES = ['PENDING_APPROVAL', 'HELD', 'SENT', 'PREPARING', 'READY'] as const;

/**
 * A dish marked out of stock (ADR-0023, MENU-006): `@rp/domain` `planStockOut` decides which of
 * its units are cancelled; this applies the plan in the event's transaction, as a durable
 * event-bus consumer, so it happens once even across a restart:
 * - units on tickets the kitchen has not started are cancelled at no charge ("Out of stock"),
 *   with a CANCELLED slip, in the name of whoever marked the dish;
 * - lines of diners' orders still waiting for approval are rejected the same way;
 * - each line gets one OUT_OF_STOCK alert, to the person who sent its ticket (for a waiting
 *   order, every waiter on duty), naming the table, the dish and the quantity;
 * - a combo with a part already started is not cancelled; its sender is told (D-16).
 */
@Injectable()
export class StockOutService implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly items: OrderItemsService,
    private readonly approvals: OrderApprovalsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({
      name: 'orders.stock-out',
      types: ['ItemAvailabilityChanged'],
      handle: (event, context) => this.handle(event, context.tx),
    });
  }

  async handle(event: DomainEvent, tx: TransactionClient): Promise<void> {
    if (event.type !== 'ItemAvailabilityChanged') return;
    const { itemId, available, markedOutBy } = event.payload;
    if (available || markedOutBy === undefined) return;
    const restaurantId = event.restaurantId;
    const person = await tx.staff.findFirst({
      where: { id: markedOutBy.staffId, restaurantId },
      select: { role: { select: { baseRole: true } } },
    });
    if (person === null) return;
    const actor: Principal = {
      restaurantId,
      staffId: markedOutBy.staffId,
      deviceId: markedOutBy.deviceId,
      role: person.role.baseRole,
      sessionId: '',
      secondFactorAt: null,
      capabilities: [],
    };
    const dish = await tx.item.findUnique({ where: { id: itemId }, select: { name: true } });

    const touching = await tx.orderItem.findMany({
      where: { restaurantId, itemId, state: { in: [...OPEN_STATES] } },
      select: { id: true, parentOrderItemId: true },
    });
    if (touching.length === 0) return;
    const parentIds = [...new Set(touching.flatMap((row) => row.parentOrderItemId ?? []))];
    const directIds = touching.filter((row) => row.parentOrderItemId === null).map((row) => row.id);
    const rows = await tx.orderItem.findMany({
      where: {
        restaurantId,
        OR: [
          { id: { in: [...directIds, ...parentIds] } },
          { parentOrderItemId: { in: parentIds } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        itemId: true,
        name: true,
        state: true,
        quantity: true,
        parentOrderItemId: true,
        orderId: true,
        order: { select: { tableId: true, tableSessionId: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const plan = planStockOut(
      itemId,
      rows.map((row) => ({ ...row, orderItemId: row.id })),
    );

    const pending = new Map<string, string[]>();
    const tell: { orderItemId: string; quantity: number; cancelled: boolean }[] = [];
    for (const entry of plan.cancel) {
      const line = byId.get(entry.orderItemId);
      if (line === undefined) continue;
      if (line.state === 'PENDING_APPROVAL') {
        pending.set(line.orderId, [...(pending.get(line.orderId) ?? []), line.id]);
        continue;
      }
      const cancelled = await this.items.cancelOutOfStockInTx(tx, actor, line.id);
      tell.push({ orderItemId: line.id, quantity: entry.quantity, cancelled });
    }
    for (const [orderId, lineIds] of pending) {
      const rejected = await this.approvals.rejectOutOfStockInTx(
        tx,
        actor,
        orderId,
        lineIds,
        OUT_OF_STOCK_REASON,
      );
      for (const id of rejected) {
        tell.push({ orderItemId: id, quantity: byId.get(id)?.quantity ?? 0, cancelled: true });
      }
    }
    for (const entry of plan.warn) tell.push({ ...entry, cancelled: false });

    for (const entry of tell) {
      const line = byId.get(entry.orderItemId);
      if (line === undefined) continue;
      const ticket = await tx.kotLine.findFirst({
        where: {
          orderItemId: {
            in: [
              line.id,
              ...rows.filter((row) => row.parentOrderItemId === line.id).map((row) => row.id),
            ],
          },
          kot: { kind: 'NEW' },
        },
        orderBy: { createdAt: 'asc' },
        select: { kot: { select: { id: true, sentById: true } } },
      });
      await this.notifications.raise(tx, {
        restaurantId,
        type: 'OUT_OF_STOCK',
        tableId: line.order.tableId,
        tableSessionId: line.order.tableSessionId,
        orderId: line.orderId,
        kotId: ticket?.kot.id ?? null,
        kotSenderId: ticket?.kot.sentById ?? null,
        dedupeKey: `stockout:${line.id}`,
        raisedById: actor.staffId,
        raisedByDeviceId: actor.deviceId,
        payload: {
          item: dish?.name ?? line.name,
          line: line.name,
          quantity: entry.quantity,
          cancelled: entry.cancelled,
        },
      });
    }
  }
}
