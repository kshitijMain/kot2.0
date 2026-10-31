import type { MenuSnapshot, OrderView } from '@rp/contracts';
import { createTranslator } from '@rp/i18n';
import { describe, expect, it } from 'vitest';
import type { CartLine } from '../src/cart.js';
import { issueText, menuNote, ruleOf, summaryOf, unavailableReason } from '../src/item-choice.js';
import { againLine, lineProblems, lineProblemText, requestAgainLine } from '../src/reorder.js';
import { IDS, MENU, sentOrder } from '../src/testing/index.js';

const t = createTranslator();
const item = (id: string) => {
  const found = MENU.items.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const extras = MENU.modifierGroups[0];
const orderItem = (n: number) => `0199a0e0-0000-7000-8000-${String(900 + n).padStart(12, '0')}`;

/** A sent order with a Full Paneer Tikka with cheese and butter, and a thali with rasmalai. */
function order(): OrderView {
  const base = sentOrder('SENT');
  const line = base.items[0];
  if (line === undefined) throw new Error('fixture');
  return {
    ...base,
    items: [
      {
        ...line,
        id: orderItem(1),
        itemId: IDS.tikka,
        name: 'Paneer Tikka',
        variantId: IDS.full,
        variantName: 'Full',
        modifiers: [
          { optionId: IDS.cheese, name: 'Cheese', priceDelta: 4_000 },
          { optionId: IDS.butter, name: 'Butter', priceDelta: 2_000 },
        ],
        quantity: 2,
        instructions: 'Less spicy',
      },
      { ...line, id: orderItem(2), itemId: IDS.thali, name: 'Veg Thali Combo' },
      { ...line, id: orderItem(3), itemId: IDS.dal, parentOrderItemId: orderItem(2) },
      {
        ...line,
        id: orderItem(4),
        itemId: IDS.rasmalai,
        name: 'Rasmalai',
        parentOrderItemId: orderItem(2),
      },
    ],
  };
}

function sentLine(sent: OrderView, index: number): OrderView['items'][number] {
  const line = sent.items[index];
  if (line === undefined) throw new Error(`No line ${String(index)}`);
  return line;
}

function cartLine(itemId: string, quantity: number, clientLineId: string): CartLine {
  return {
    clientLineId,
    itemId,
    name: item(itemId).name,
    summary: '',
    quantity,
    selection: {},
    instructions: '',
    unitPrice: item(itemId).basePrice,
  };
}

describe('[MENU-004] [MENU-012] choices in words', () => {
  it('says each modifier rule and what is wrong with a choice', () => {
    if (extras === undefined) throw new Error('fixture');
    expect(ruleOf(extras, t)).toBe('Optional, up to 2');
    expect(ruleOf({ ...extras, minSelections: 1, maxSelections: 1 }, t)).toBe('Choose 1');
    expect(ruleOf({ ...extras, minSelections: 1, maxSelections: 3 }, t)).toBe('Choose 1 to 3');
    const issue = (code: string) =>
      issueText({ code, groupId: IDS.extras, message: '' } as never, [extras], t);
    expect(issue('VARIANT_REQUIRED')).toBe(t('pos.item.issue.VARIANT_REQUIRED'));
    expect(issue('TOO_FEW_MODIFIERS')).toBe(t('pos.item.issue.TOO_FEW_MODIFIERS', { min: 0 }));
    expect(issue('TOO_MANY_MODIFIERS')).toBe(t('pos.item.issue.TOO_MANY_MODIFIERS', { max: 2 }));
    expect(issue('UNKNOWN_OPTION')).toBe(t('pos.item.issue.other'));
  });

  it('summarises a variant, options and combo choices', () => {
    expect(
      summaryOf(
        MENU,
        item(IDS.tikka),
        {
          variantId: IDS.half,
          modifiers: [{ groupId: IDS.extras, optionIds: [IDS.cheese, IDS.butter] }],
        },
        undefined,
      ),
    ).toBe('Half · Cheese, Butter');
    expect(summaryOf(MENU, item(IDS.thali), {}, [IDS.jamun])).toBe('Dessert: Gulab Jamun');
  });
});

describe('[MENU-005] a combo outside its dates or hours', () => {
  // Lunch thali, 12:00 to 15:00 in Kolkata, in September only.
  const lunch: MenuSnapshot = {
    ...MENU,
    timeZone: 'Asia/Kolkata',
    combos: MENU.combos.map((combo) => ({
      ...combo,
      activeFrom: '2026-09-01',
      activeUntil: '2026-09-30',
      timeWindow: { start: '12:00', end: '15:00' },
    })),
  };
  const at = (iso: string) => ({ menu: lunch, now: new Date(iso) });

  it('is offered in its hours and shown as such outside them, on every surface', () => {
    // 13:00 IST.
    expect(unavailableReason(item(IDS.thali), at('2026-09-26T07:30:00Z'))).toBeUndefined();
    expect(menuNote(lunch, item(IDS.thali), t, Date.parse('2026-09-26T07:30:00Z'))).toEqual({
      note: t('pos.menu.combo'),
    });
    // 16:00 IST.
    expect(unavailableReason(item(IDS.thali), at('2026-09-26T10:30:00Z'))).toBe('NOT_NOW');
    expect(menuNote(lunch, item(IDS.thali), t, Date.parse('2026-09-26T10:30:00Z'))).toEqual({
      unavailable: 'Only 12:00–15:00',
    });
    // 13:00 IST in October: past its dates.
    expect(unavailableReason(item(IDS.thali), at('2026-10-02T07:30:00Z'))).toBe('NOT_NOW');
    // Without the time, only stock and the switch count (as before).
    expect(unavailableReason(item(IDS.thali))).toBeUndefined();
    // Not a combo: hours do not apply.
    expect(unavailableReason(item(IDS.dal), at('2026-09-26T10:30:00Z'))).toBeUndefined();
  });

  it('by the restaurant’s clock, not the device’s', () => {
    // 13:00 in Kolkata is 07:30 UTC: a combo menu read in UTC would wrongly be closed.
    const utc = { ...lunch, timeZone: 'UTC' };
    expect(
      unavailableReason(item(IDS.thali), { menu: utc, now: new Date('2026-09-26T07:30:00Z') }),
    ).toBe('NOT_NOW');
    const { timeZone: _zone, ...unzoned } = lunch;
    expect(
      unavailableReason(item(IDS.thali), { menu: unzoned, now: new Date('2026-09-26T07:30:00Z') }),
    ).toBeUndefined();
  });

  it('is flagged in a cart waiting to be sent once its hours are over', () => {
    const line = {
      clientLineId: 'line-1',
      itemId: IDS.thali,
      name: 'Thali',
      summary: '',
      quantity: 1,
      selection: {},
      comboChoices: [IDS.jamun],
      instructions: '',
      unitPrice: 30_000,
    };
    const problems = lineProblems(lunch, [line], 'WAITER_APP', Date.parse('2026-09-26T10:30:00Z'));
    const problem = problems.get('line-1');
    expect(problem).toEqual({ kind: 'NOT_NOW', hours: '12:00–15:00' });
    expect(problem === undefined ? '' : lineProblemText(problem, t)).toBe('Only 12:00–15:00');
    expect(lineProblems(lunch, [line], 'WAITER_APP', Date.parse('2026-09-26T07:30:00Z')).size).toBe(
      0,
    );
  });
});

describe('[MENU-007] a dish served at some hours only', () => {
  // Breakfast: 07:00 to 11:00 in Kolkata.
  const breakfast: MenuSnapshot = {
    ...MENU,
    timeZone: 'Asia/Kolkata',
    items: MENU.items.map((entry) =>
      entry.id === IDS.dal ? { ...entry, timeWindow: { start: '07:00', end: '11:00' } } : entry,
    ),
  };
  const dal = () => {
    const found = breakfast.items.find((candidate) => candidate.id === IDS.dal);
    if (found === undefined) throw new Error('fixture');
    return found;
  };

  it('can be ordered in its hours and shows them outside them', () => {
    // 09:00 IST.
    const morning = Date.parse('2026-10-02T03:30:00Z');
    expect(unavailableReason(dal(), { menu: breakfast, now: morning })).toBeUndefined();
    expect(menuNote(breakfast, dal(), t, morning)).toEqual({});
    // 13:00 IST.
    const lunchtime = Date.parse('2026-10-02T07:30:00Z');
    expect(unavailableReason(dal(), { menu: breakfast, now: lunchtime })).toBe('NOT_NOW');
    expect(menuNote(breakfast, dal(), t, lunchtime)).toEqual({ unavailable: 'Only 07:00–11:00' });
    const line = {
      clientLineId: 'line-1',
      itemId: IDS.dal,
      name: 'Dal',
      summary: '',
      quantity: 1,
      selection: {},
      instructions: '',
      unitPrice: 25_000,
    };
    expect(lineProblems(breakfast, [line], 'WAITER_APP', lunchtime).get('line-1')).toEqual({
      kind: 'NOT_NOW',
      hours: '07:00–11:00',
    });
  });
});

describe('[WTR-010] [MENU-006] what the menu card says', () => {
  it('marks sold-out and switched-off dishes "Out of stock", and counts what is left', () => {
    expect(unavailableReason(item(IDS.jamun))).toBe('SOLD_OUT');
    expect(menuNote(MENU, item(IDS.jamun), t)).toEqual({ unavailable: 'Out of stock' });
    const off = { ...item(IDS.dal), available: false };
    expect(unavailableReason(off)).toBe('NOT_AVAILABLE');
    expect(menuNote(MENU, off, t)).toEqual({ unavailable: 'Out of stock' });
    expect(menuNote(MENU, { ...item(IDS.dal), stockCount: 3 }, t)).toEqual({ note: '3 left' });
    expect(menuNote(MENU, item(IDS.thali), t)).toEqual({ note: t('pos.menu.combo') });
    expect(menuNote(MENU, item(IDS.tikka), t)).toEqual({ note: t('pos.menu.options') });
    expect(menuNote(MENU, item(IDS.dal), t)).toEqual({});
  });
});

describe('[MENU-006] [MENU-005] a combo with a part out of stock (ADR-0023)', () => {
  const withItems = (changes: Record<string, Partial<(typeof MENU.items)[number]>>) => ({
    ...MENU,
    items: MENU.items.map((entry) => ({ ...entry, ...changes[entry.id] })),
  });

  it('is out of stock when a fixed part is, or every choice of a part is', () => {
    const noDal = withItems({ [IDS.dal]: { available: false } });
    const thali = noDal.items.find((entry) => entry.id === IDS.thali)!;
    expect(unavailableReason(thali, { menu: noDal, now: Date.parse('2026-09-26T07:30:00Z') })).toBe(
      'SOLD_OUT',
    );
    expect(menuNote(noDal, thali, t)).toEqual({ unavailable: 'Out of stock' });
    const noDesserts = withItems({
      [IDS.jamun]: { available: false },
      [IDS.rasmalai]: { stockCount: 0 },
    });
    expect(menuNote(noDesserts, thali, t)).toEqual({ unavailable: 'Out of stock' });
  });

  it('stays on sale while another choice of a part is in stock', () => {
    const noJamun = withItems({ [IDS.jamun]: { available: false } });
    const thali = noJamun.items.find((entry) => entry.id === IDS.thali)!;
    expect(menuNote(noJamun, thali, t)).toEqual({ note: t('pos.menu.combo') });
  });
});

describe('[NFR-U03] ordering the same again', () => {
  it('repeats a sent line with its variant, options and note, one of it, priced as now', () => {
    const sent = order();
    const again = againLine(MENU, sent, sentLine(sent, 0), 'WAITER_APP');
    expect(again).toEqual({
      itemId: IDS.tikka,
      name: 'Paneer Tikka',
      summary: 'Full · Cheese, Butter',
      quantity: 1,
      selection: {
        variantId: IDS.full,
        modifiers: [{ groupId: IDS.extras, optionIds: [IDS.cheese, IDS.butter] }],
      },
      instructions: 'Less spicy',
      // Full ₹280 + cheese ₹40 + butter ₹20.
      unitPrice: 34_000,
    });
  });

  it('repeats a combo with the same choice for each slot', () => {
    const sent = order();
    const thali = sentLine(sent, 1);
    expect(againLine(MENU, sent, thali, 'WAITER_APP')).toMatchObject({
      itemId: IDS.thali,
      comboChoices: [IDS.rasmalai],
      summary: 'Dessert: Rasmalai',
      instructions: '',
    });
  });

  it('asks again when the menu changed: gone, off this channel, or a choice no longer offered', () => {
    const sent = order();
    const tikka = sentLine(sent, 0);
    const without = (change: Partial<MenuSnapshot>): MenuSnapshot => ({ ...MENU, ...change });
    expect(againLine(MENU, sent, tikka, 'QR')).toBeUndefined();
    expect(
      againLine(
        without({ items: MENU.items.filter((entry) => entry.id !== IDS.tikka) }),
        sent,
        tikka,
        'WAITER_APP',
      ),
    ).toBeUndefined();
    expect(
      againLine(
        without({
          items: MENU.items.map((entry) =>
            entry.id === IDS.tikka ? { ...entry, variants: entry.variants.slice(0, 1) } : entry,
          ),
        }),
        sent,
        tikka,
        'WAITER_APP',
      ),
    ).toBeUndefined();
    expect(againLine(without({ modifierGroups: [] }), sent, tikka, 'WAITER_APP')).toBeUndefined();
    // Too many options for the group's rule now.
    const strict = extras === undefined ? [] : [{ ...extras, maxSelections: 1 }];
    expect(
      againLine(without({ modifierGroups: strict }), sent, tikka, 'WAITER_APP'),
    ).toBeUndefined();
    // A combo whose parts do not match its slots.
    const thali = sentLine(sent, 1);
    const noParts = {
      ...sent,
      items: sent.items.filter((line) => line.parentOrderItemId === null),
    };
    expect(againLine(MENU, noParts, thali, 'WAITER_APP')).toBeUndefined();
  });
});

describe('[WTR-010] cart lines the kitchen cannot make now', () => {
  it('finds sold-out, switched-off and off-menu lines, and more than the stock left', () => {
    const menu: MenuSnapshot = {
      ...MENU,
      items: MENU.items.map((entry) => {
        if (entry.id === IDS.dal) return { ...entry, stockCount: 3 };
        if (entry.id === IDS.tikka) return { ...entry, available: false };
        return entry;
      }),
    };
    const lines = [
      cartLine(IDS.dal, 2, 'a'),
      cartLine(IDS.dal, 2, 'b'),
      cartLine(IDS.tikka, 1, 'c'),
      cartLine(IDS.jamun, 1, 'd'),
      cartLine(IDS.rasmalai, 1, 'e'),
      cartLine(IDS.thali, 1, 'f'),
    ];
    const problems = lineProblems(menu, lines, 'WAITER_APP');
    expect(Object.fromEntries(problems)).toEqual({
      a: { kind: 'TOO_FEW_LEFT', left: 3 },
      b: { kind: 'TOO_FEW_LEFT', left: 3 },
      c: { kind: 'NOT_AVAILABLE' },
      d: { kind: 'SOLD_OUT' },
      e: { kind: 'OFF_MENU' },
    });
    expect([...problems.values()].map((problem) => lineProblemText(problem, t))).toEqual([
      'Only 3 left',
      'Only 3 left',
      'Out of stock',
      'Out of stock',
      'No longer on the menu',
    ]);
    expect(lineProblems(menu, [cartLine(IDS.dal, 3, 'a')], 'WAITER_APP').size).toBe(0);
  });
});

describe('[QR-004] "Order again" on the QR page (P9-04)', () => {
  const sent = {
    clientLineId: '0199a0e0-0000-7000-8000-000000000a01',
    itemId: IDS.tikka,
    quantity: 2,
    variantId: IDS.full,
    modifiers: [{ groupId: IDS.extras, optionIds: [IDS.cheese] }],
    instructions: 'Less spicy',
  };

  it('puts a sent line back as it was, priced from the menu now', () => {
    const again = requestAgainLine(MENU, sent, 'WAITER_APP');
    expect(again).toMatchObject({
      itemId: IDS.tikka,
      quantity: 2,
      selection: {
        variantId: IDS.full,
        modifiers: [{ groupId: IDS.extras, optionIds: [IDS.cheese] }],
      },
      instructions: 'Less spicy',
      summary: 'Full · Cheese',
    });
    expect(again?.unitPrice).toBeGreaterThan(0);
  });

  it('keeps a combo’s choices, and gives up when they no longer fit', () => {
    const thali = { ...sent, itemId: IDS.thali, variantId: undefined, modifiers: [] };
    expect(
      requestAgainLine(MENU, { ...thali, comboChoices: [IDS.jamun] }, 'WAITER_APP')?.comboChoices,
    ).toEqual([IDS.jamun]);
    expect(
      requestAgainLine(MENU, { ...thali, comboChoices: [IDS.tikka] }, 'WAITER_APP'),
    ).toBeUndefined();
    expect(requestAgainLine(MENU, { ...thali, comboChoices: [] }, 'WAITER_APP')).toBeUndefined();
  });

  it('gives up on a dish out of stock, gone from the QR menu, or with an option it no longer has', () => {
    const soldOut: MenuSnapshot = {
      ...MENU,
      items: MENU.items.map((entry) =>
        entry.id === IDS.tikka ? { ...entry, stockCount: 0 } : entry,
      ),
    };
    expect(requestAgainLine(soldOut, sent, 'WAITER_APP')).toBeUndefined();
    // The fixture's tikka is not on the QR menu.
    expect(requestAgainLine(MENU, sent, 'QR')).toBeUndefined();
    expect(requestAgainLine(MENU, { ...sent, itemId: IDS.full }, 'WAITER_APP')).toBeUndefined();
    expect(
      requestAgainLine(
        MENU,
        { ...sent, modifiers: [{ groupId: IDS.extras, optionIds: [IDS.full] }] },
        'QR',
      ),
    ).toBeUndefined();
  });
});
