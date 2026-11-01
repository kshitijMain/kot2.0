import type { Handler } from '../http.js';
import { orderStatus } from '../order-status.js';
import { qrMenu } from '../qr-menu.js';
import { server } from '../server.js';
import { serviceRequest } from '../service-request.js';
import { submitOrder } from '../submit-order.js';
import { tableBill } from '../table-bill.js';
import { tableOrders } from '../table-orders.js';

/** Every function, by the name it is served under (`/functions/v1/<name>`). */
export const FUNCTIONS: Readonly<Record<string, Handler>> = {
  'qr-menu': qrMenu,
  'submit-order': submitOrder,
  'order-status': orderStatus,
  'service-request': serviceRequest,
  'table-bill': tableBill,
  'table-orders': tableOrders,
  server,
};
