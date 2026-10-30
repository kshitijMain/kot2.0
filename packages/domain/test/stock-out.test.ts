import { describe, expect, it } from 'vitest';
import { cancelledOnStockOut, planStockOut, type StockOutLine } from '../src/index.js';

const line = (id: string, overrides: Partial<StockOutLine> = {}): StockOutLine => ({
  orderItemId: id,
  itemId: 'dal',
  state: 'SENT',
  quantity: 1,
  parentOrderItemId: null,
  ...overrides,
});

describe('[MENU-006] [ORD-011] a dish marked out of stock (ADR-0023)', () => {
  it('cancels only units not yet being prepared', () => {
    expect(cancelledOnStockOut('SENT')).toBe(true);
    expect(cancelledOnStockOut('PENDING_APPROVAL')).toBe(true);
    for (const state of ['HELD', 'PREPARING', 'READY', 'PICKED_UP', 'SERVED', 'CANCELLED'])
      expect(cancelledOnStockOut(state)).toBe(false);
  });

  it('plans the lines of the dish: sent ones cancelled, started ones left alone', () => {
    const plan = planStockOut('dal', [
      line('a', { quantity: 2 }),
      line('b', { state: 'PREPARING' }),
      line('c', { state: 'READY' }),
      line('d', { itemId: 'naan' }),
      line('e', { state: 'PENDING_APPROVAL', quantity: 3 }),
    ]);
    expect(plan).toEqual({
      cancel: [
        { orderItemId: 'a', partIds: [], quantity: 2 },
        { orderItemId: 'e', partIds: [], quantity: 3 },
      ],
      warn: [],
    });
  });

  it('cancels a whole combo whose parts have not started, and only warns when one has', () => {
    const lines = [
      line('thali', { itemId: 'thali-combo' }),
      line('thali-dal', { parentOrderItemId: 'thali' }),
      line('thali-naan', { itemId: 'naan', parentOrderItemId: 'thali' }),
      line('meal', { itemId: 'meal-combo', quantity: 2 }),
      line('meal-dal', { parentOrderItemId: 'meal', quantity: 2 }),
      line('meal-roti', { itemId: 'roti', parentOrderItemId: 'meal', state: 'PREPARING' }),
      line('done', { itemId: 'done-combo', state: 'SERVED' }),
      line('done-dal', { parentOrderItemId: 'done', state: 'SERVED' }),
    ];
    expect(planStockOut('dal', lines)).toEqual({
      cancel: [{ orderItemId: 'thali', partIds: ['thali-dal', 'thali-naan'], quantity: 1 }],
      warn: [{ orderItemId: 'meal', quantity: 2 }],
    });
  });

  it('plans nothing for a dish nobody has ordered', () => {
    expect(planStockOut('paneer', [line('a')])).toEqual({ cancel: [], warn: [] });
  });
});
