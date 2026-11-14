import { describe, expect, it } from 'vitest';
import { buildZReport, type ZInvoice } from '../src/z-report.js';

const invoice = (number: string, status: ZInvoice['status'], grandTotal: number): ZInvoice => ({
  invoiceNumber: number,
  status,
  subtotal: grandTotal - 500,
  discountTotal: 100,
  serviceCharge: 0,
  taxTotal: 600,
  roundOff: 0,
  grandTotal,
});

describe('[BILL-013] [RPT-005] the Z-report', () => {
  const report = buildZReport({
    businessDate: '2026-09-26',
    orders: 7,
    invoices: [
      invoice('INV/26-27/000001', 'VOIDED', 61_200),
      invoice('INV/26-27/000002', 'SETTLED', 10_500),
      invoice('INV/26-27/000003', 'SETTLED', 21_000),
      invoice('INV/26-27/000004', 'ISSUED', 5_000),
    ],
    taxLines: [
      { code: 'CGST', rateBp: 250, taxableValue: 10_000, amount: 250 },
      { code: 'SGST', rateBp: 250, taxableValue: 10_000, amount: 250 },
      { code: 'CGST', rateBp: 250, taxableValue: 20_000, amount: 500 },
      { code: 'CGST', rateBp: 900, taxableValue: 2_000, amount: 180 },
    ],
    payments: [
      { mode: 'CASH', label: null, amount: 10_500, shiftId: 's1' },
      { mode: 'CARD', label: null, amount: 15_000, shiftId: 's1' },
      { mode: 'OTHER', label: 'Dineout', amount: 6_000, shiftId: null },
      { mode: 'CARD', label: null, amount: 0, shiftId: null },
    ],
    shifts: [
      {
        shiftId: 's1',
        staffId: 'a',
        openingFloat: 200_000,
        expectedCash: 210_500,
        countedCash: 210_000,
        variance: -500,
        notCounted: false,
      },
      {
        shiftId: 's2',
        staffId: 'b',
        openingFloat: 0,
        expectedCash: 0,
        countedCash: 100,
        variance: 100,
        notCounted: false,
      },
    ],
    cashIn: 1_000,
    cashOut: 2_000,
  });

  it('totals only invoices that stand, and keeps voided numbers in the register', () => {
    expect(report.invoices).toEqual({
      count: 3,
      settled: 2,
      unsettled: 1,
      voided: ['INV/26-27/000001'],
      numbers: ['INV/26-27/000001', 'INV/26-27/000002', 'INV/26-27/000003', 'INV/26-27/000004'],
    });
    expect(report.netSales).toBe(36_500);
    expect(report.settledSales).toBe(31_500);
    expect(report.grossSales).toBe(35_000);
    expect(report.discounts).toBe(300);
    expect(report.orders).toBe(7);
  });

  it('groups tax by component and rate, and payments by mode', () => {
    expect(report.taxes).toEqual([
      { code: 'CGST', rateBp: 250, taxableValue: 30_000, amount: 750 },
      { code: 'SGST', rateBp: 250, taxableValue: 10_000, amount: 250 },
      { code: 'CGST', rateBp: 900, taxableValue: 2_000, amount: 180 },
    ]);
    expect(report.payments).toEqual([
      { mode: 'CASH', label: null, count: 1, amount: 10_500 },
      { mode: 'CARD', label: null, count: 2, amount: 15_000 },
      { mode: 'OTHER', label: 'Dineout', count: 1, amount: 6_000 },
    ]);
    expect(report.paymentsTotal).toBe(31_500);
  });

  it('[AUD-006] adds up the shift variances', () => {
    expect(report.totalVariance).toBe(-400);
    expect(report.cash).toEqual({ cashIn: 1_000, cashOut: 2_000, outsideShift: 0 });
  });
});

describe('[BILL-013] cash outside a shift (ADR-0029)', () => {
  const outside = (payments: Parameters<typeof buildZReport>[0]['payments']) =>
    buildZReport({
      businessDate: '2026-09-26',
      orders: 1,
      invoices: [],
      taxLines: [],
      payments,
      shifts: [],
      cashIn: 0,
      cashOut: 0,
    });

  it('adds up only the cash linked to no shift, and leaves the total cash as it was', () => {
    const report = outside([
      { mode: 'CASH', label: null, amount: 30_000, shiftId: null },
      { mode: 'CASH', label: null, amount: 10_000, shiftId: 's1' },
      // Only cash is ever "in a drawer": a UPI payment with no shift is not untracked cash.
      { mode: 'UPI', label: null, amount: 7_000, shiftId: null },
      { mode: 'OTHER', label: 'Cheque', amount: 2_000, shiftId: null },
    ]);
    expect(report.cash.outsideShift).toBe(30_000);
    expect(report.payments.find((line) => line.mode === 'CASH')?.amount).toBe(40_000);
    expect(report.paymentsTotal).toBe(49_000);
  });

  it('is nothing when all the cash went into shifts', () => {
    expect(
      outside([{ mode: 'CASH', label: null, amount: 500, shiftId: 's1' }]).cash.outsideShift,
    ).toBe(0);
  });

  it('leaves a shift closed as "not counted" out of the difference', () => {
    const report = buildZReport({
      businessDate: '2026-09-26',
      orders: 0,
      invoices: [],
      taxLines: [],
      payments: [],
      shifts: [
        {
          shiftId: 's1',
          staffId: 'a',
          openingFloat: 0,
          expectedCash: 9_000,
          countedCash: null,
          variance: null,
          notCounted: true,
        },
      ],
      cashIn: 0,
      cashOut: 0,
    });
    expect(report.totalVariance).toBe(0);
    expect(report.shifts[0]?.notCounted).toBe(true);
  });
});
