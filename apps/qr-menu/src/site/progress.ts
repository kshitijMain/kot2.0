import type { QrOrderView } from '@rp/contracts/relay';

/** The steps an order goes through on the diner's page (P9-09), like a delivery tracker. */
export const ORDER_STEPS = ['sent', 'accepted', 'preparing', 'ready', 'served'] as const;
export type OrderStep = (typeof ORDER_STEPS)[number];

/** Dishes that no longer count towards where the order is: not taken, cancelled, voided. */
const GONE = new Set(['REJECTED', 'CANCELLED', 'VOIDED']);
const READY_OR_LATER = new Set(['READY', 'PICKED_UP', 'SERVED']);
const STARTED = new Set(['PREPARING', 'READY', 'PICKED_UP', 'SERVED']);

/**
 * How far an order has come, as the index of its current step in ORDER_STEPS, or undefined when
 * it has no place on the tracker (rejected, or never picked up). `status` is what the page shows
 * (an overdue SUBMITTED order reads EXPIRED). The step reached is the one every live dish has
 * reached: an order is ready when all its dishes are, served when all are served.
 */
export function orderStep(
  order: QrOrderView,
  status: QrOrderView['status'] = order.status,
): number | undefined {
  if (status === 'REJECTED' || status === 'EXPIRED') return undefined;
  if (status === 'SUBMITTED' || status === 'RECEIVED') return 0;
  const states = (order.detail.items ?? [])
    .map((line) => line.state)
    .filter((state) => !GONE.has(state));
  if (states.length > 0 && states.every((state) => state === 'SERVED')) return 4;
  if (states.length > 0 && states.every((state) => READY_OR_LATER.has(state))) return 3;
  if (states.some((state) => STARTED.has(state))) return 2;
  return 1;
}
