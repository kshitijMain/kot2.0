import { describe, expect, it } from 'vitest';
import { taxByCodeAndRate } from '../src/bill.js';

describe('[BILL-005] one line per tax and rate on the bill (P9-25)', () => {
  it('adds the service charge’s CGST to the dishes’, keeping other rates apart', () => {
    expect(
      taxByCodeAndRate([
        { code: 'CGST', rateBp: 250, amount: 1475, taxableValue: 59_000 },
        { code: 'SGST', rateBp: 250, amount: 1475, taxableValue: 59_000 },
        { code: 'CGST', rateBp: 900, amount: 900, taxableValue: 10_000 },
        { code: 'CGST', rateBp: 250, amount: 74, taxableValue: 2950 },
        { code: 'SGST', rateBp: 250, amount: 74 },
      ]),
    ).toEqual([
      { code: 'CGST', rateBp: 250, amount: 1549, taxableValue: 61_950 },
      { code: 'SGST', rateBp: 250, amount: 1549 },
      { code: 'CGST', rateBp: 900, amount: 900, taxableValue: 10_000 },
    ]);
  });
});
