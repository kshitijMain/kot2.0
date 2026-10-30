import { describe, expect, it } from 'vitest';
import { MyKotTablesResponse, TableRequest } from '../src/index.js';

const id = (n: number) => `01926a3e-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('[TBL-001] tables', () => {
  it('takes a label, seats and a section', () => {
    const table = { label: 'Terrace 3', capacity: 4, sectionId: id(1), displayOrder: 0 };
    expect(TableRequest.safeParse(table).success).toBe(true);
    expect(TableRequest.safeParse({ ...table, capacity: 0 }).success).toBe(false);
    expect(TableRequest.safeParse({ ...table, label: ' ' }).success).toBe(false);
    expect(TableRequest.safeParse({ ...table, label: 'x'.repeat(21) }).success).toBe(false);
  });
});

describe('[WTR-002] the tables a waiter sent KOTs to (ADR-0023)', () => {
  it('lists table ids for the business day; there are no waiter assignments', () => {
    expect(
      MyKotTablesResponse.safeParse({ businessDate: '2026-10-30', tableIds: [id(1)] }).success,
    ).toBe(true);
    expect(MyKotTablesResponse.safeParse({ tableIds: [id(1)] }).success).toBe(false);
  });
});
