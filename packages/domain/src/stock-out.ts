/**
 * What happens to orders when a dish is marked out of stock (ADR-0023, MENU-006): its units on
 * tickets the kitchen has not started, and on diners' orders still waiting for approval, are
 * cancelled at no charge; anything being prepared, ready or served is left alone. A combo with
 * the dish as a part is cancelled whole while none of its parts has started; once one has, it is
 * only reported to the waiter (D-16). Pure: the server applies the plan.
 */

/** The states whose units are cancelled when their dish goes out of stock. */
const CANCELLED_STATES: ReadonlySet<string> = new Set(['SENT', 'PENDING_APPROVAL']);

export function cancelledOnStockOut(state: string): boolean {
  return CANCELLED_STATES.has(state);
}

/** An order line as the plan sees it: a plain dish, a combo, or a combo's part. */
export interface StockOutLine {
  readonly orderItemId: string;
  readonly itemId: string;
  readonly state: string;
  readonly quantity: number;
  /** The combo this line is a part of, if any. */
  readonly parentOrderItemId: string | null;
}

export interface StockOutPlan {
  /** Lines to cancel, each with its combo parts (cancelled with it). */
  readonly cancel: readonly {
    readonly orderItemId: string;
    readonly partIds: readonly string[];
    readonly quantity: number;
  }[];
  /** Combos with the dish in a part already started: not cancelled, the waiter is told. */
  readonly warn: readonly { readonly orderItemId: string; readonly quantity: number }[];
}

/** The plan for `itemId` going out of stock, over the open lines that might hold it. */
export function planStockOut(itemId: string, lines: readonly StockOutLine[]): StockOutPlan {
  const partsOf = new Map<string, StockOutLine[]>();
  for (const line of lines) {
    if (line.parentOrderItemId === null) continue;
    partsOf.set(line.parentOrderItemId, [...(partsOf.get(line.parentOrderItemId) ?? []), line]);
  }
  const cancel: { orderItemId: string; partIds: string[]; quantity: number }[] = [];
  const warn: { orderItemId: string; quantity: number }[] = [];
  for (const line of lines) {
    if (line.parentOrderItemId !== null) continue;
    const parts = partsOf.get(line.orderItemId) ?? [];
    if (parts.length === 0) {
      if (line.itemId === itemId && cancelledOnStockOut(line.state)) {
        cancel.push({ orderItemId: line.orderItemId, partIds: [], quantity: line.quantity });
      }
      continue;
    }
    const affected = parts.some((part) => part.itemId === itemId && !finished(part.state));
    if (!affected) continue;
    if (cancelledOnStockOut(line.state) && parts.every((part) => cancelledOnStockOut(part.state))) {
      cancel.push({
        orderItemId: line.orderItemId,
        partIds: parts.map((part) => part.orderItemId),
        quantity: line.quantity,
      });
    } else if (parts.some((part) => part.itemId === itemId && cancelledOnStockOut(part.state))) {
      warn.push({ orderItemId: line.orderItemId, quantity: line.quantity });
    }
  }
  return { cancel, warn };
}

/** A part already ended or delivered needs nothing. */
function finished(state: string): boolean {
  return ['PICKED_UP', 'SERVED', 'CANCELLED', 'VOIDED', 'REJECTED'].includes(state);
}
