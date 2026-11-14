import { Injectable } from '@nestjs/common';
import type { OrderView } from '@rp/contracts';
import type { Principal } from '../auth/principal.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppError } from '../errors/app-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ORDER_VIEW_INCLUDE, orderView } from './orders.service.js';

/**
 * A waiter asks for a takeaway's bill (ADR-0030, item E): it then waits in the managers' pending
 * bills, and the managers on duty are told, as for a table. Asked twice, it is the same request.
 */
@Injectable()
export class TakeawayBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  requestBill(principal: Principal, orderId: string): Promise<OrderView> {
    return this.prisma.transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findFirst({
        where: { id: orderId, restaurantId: principal.restaurantId },
        include: ORDER_VIEW_INCLUDE,
      });
      if (order === null) throw new AppError(404, 'ORDER_NOT_FOUND', 'There is no such order.');
      if (order.orderType !== 'TAKEAWAY') {
        throw new AppError(
          409,
          'NOT_A_TAKEAWAY',
          'This is a table’s order: ask for the bill from the table.',
        );
      }
      if (order.status !== 'OPEN') {
        throw new AppError(409, 'ORDER_CLOSED', 'This takeaway is paid or cancelled already.');
      }
      if (order.billRequestedAt !== null) return orderView(order);
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { billRequestedAt: new Date() },
        include: ORDER_VIEW_INCLUDE,
      });
      // Whoever asked knows already: the managers on duty are told (P2-06d).
      await this.notifications.raise(tx, {
        restaurantId: principal.restaurantId,
        type: 'BILL_REQUEST',
        orderId,
        dedupeKey: `bill:order:${orderId}`,
        payload: { requestedFrom: 'WAITER_APP', takeawayToken: order.takeawayToken },
        raisedById: principal.staffId,
        raisedByDeviceId: principal.deviceId,
        askedById: principal.staffId,
      });
      return orderView(updated);
    });
  }
}
