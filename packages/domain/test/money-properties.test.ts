import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyPayments,
  type BillInput,
  type BillResult,
  buildZReport,
  computeBill,
  computeGroupTax,
  type DiscountValue,
  DomainError,
  type PaymentInput,
  splitBill,
  sum,
  type TaxGroup,
  type ZInvoice,
} from '../src/index.js';

/**
 * Property-based tests (QA audit, category D): for thousands of random bills, the totals always
 * add up, GST never loses or invents a paisa, splits always add up to the bill, payments never
 * exceed it, and the day's report always equals its invoices and payments.
 */

const RUNS = { numRuns: 2_000 };

const GROUPS: readonly TaxGroup[] = [
  {
    id: 'gst5',
    name: 'GST 5 %',
    components: [
      { code: 'CGST', rateBp: 250 },
      { code: 'SGST', rateBp: 250 },
    ],
  },
  {
    id: 'gst18',
    name: 'GST 18 %',
    components: [
      { code: 'CGST', rateBp: 900 },
      { code: 'SGST', rateBp: 900 },
    ],
  },
  {
    id: 'gst12',
    name: 'GST 12 %',
    components: [
      { code: 'CGST', rateBp: 600 },
      { code: 'SGST', rateBp: 600 },
    ],
  },
  { id: 'gst0', name: 'Exempt', components: [{ code: 'GST', rateBp: 0 }] },
];

const groupIds = GROUPS.map((group) => group.id);

/** A discount on `base`: a percentage, or a flat amount no more than the base. */
const discountOn = (base: number): fc.Arbitrary<DiscountValue | undefined> =>
  fc.oneof(
    fc.constant(undefined),
    fc.integer({ min: 0, max: 10_000 }).map((rateBp) => ({ kind: 'PERCENT' as const, rateBp })),
    fc.integer({ min: 0, max: base }).map((amount) => ({ kind: 'FLAT' as const, amount })),
  );

/** Menu prices (₹0 to ₹5,000), any discounts and options, up to `maxLines` lines. */
const billsWith = (maxLines: number, maxQuantity: number): fc.Arbitrary<BillInput> =>
  fc
    .array(
      fc.record({
        unitPrice: fc.integer({ min: 0, max: 500_000 }),
        quantity: fc.integer({ min: 1, max: maxQuantity }),
        taxGroupId: fc.constantFrom(...groupIds),
        complimentary: fc.integer({ min: 0, max: 9 }).map((roll) => roll === 0),
      }),
      { minLength: 1, maxLength: maxLines },
    )
    .chain((lines) =>
      fc
        .tuple(
          fc.tuple(...lines.map((line) => discountOn(line.unitPrice * line.quantity))),
          fc.constantFrom('TAX_EXCLUSIVE' as const, 'TAX_INCLUSIVE' as const),
          fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
          fc.option(
            fc.record({
              rateBp: fc.integer({ min: 0, max: 2_000 }),
              taxGroupId: fc.constantFrom(...groupIds),
            }),
            { nil: null },
          ),
          fc.constantFrom(
            { kind: 'NONE' as const },
            { kind: 'NEAREST' as const, unit: 100 },
            { kind: 'NEAREST' as const, unit: 50 },
          ),
        )
        .map(([discounts, priceMode, billPercent, serviceCharge, roundOff]): BillInput => ({
          priceMode,
          lines: lines.map((line, index) => ({
            id: `line-${String(index)}`,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            taxGroupId: line.taxGroupId,
            complimentary: line.complimentary,
            ...(discounts[index] !== undefined && { discount: discounts[index] }),
          })),
          taxGroups: GROUPS,
          ...(billPercent !== undefined && {
            billDiscount: { kind: 'PERCENT' as const, rateBp: billPercent },
          }),
          serviceCharge,
          roundOff,
        })),
    );

/** Quantities 1 to 99, up to 30 lines. */
const bills = billsWith(30, 99);

const isWholePaise = (value: number) => Number.isSafeInteger(value) && value >= 0;

function expectBillAddsUp(input: BillInput, bill: BillResult): void {
  // Every amount is whole paise, never negative (except the round-off).
  for (const value of [
    bill.subtotal,
    bill.discountTotal,
    bill.serviceCharge,
    bill.taxableValueTotal,
    bill.taxTotal,
    bill.totalBeforeRoundOff,
    bill.grandTotal,
  ]) {
    expect(isWholePaise(value)).toBe(true);
  }
  expect(bill.subtotal).toBe(sum(bill.lines.map((line) => line.grossAmount)));
  for (const [index, line] of bill.lines.entries()) {
    const ordered = input.lines[index];
    expect(line.grossAmount).toBe((ordered?.unitPrice ?? 0) * (ordered?.quantity ?? 0));
    expect(line.netAmount).toBe(line.grossAmount - line.itemDiscount - line.billDiscountShare);
    expect(line.netAmount).toBeGreaterThanOrEqual(0);
  }
  expect(bill.discountTotal).toBe(bill.itemDiscountTotal + bill.billDiscountTotal);
  expect(bill.itemDiscountTotal).toBe(sum(bill.lines.map((line) => line.itemDiscount)));
  expect(bill.billDiscountTotal).toBe(sum(bill.lines.map((line) => line.billDiscountShare)));
  expect(bill.discountTotal).toBeLessThanOrEqual(bill.subtotal);
  // Tax: the lines' tax is the sum of their components; nothing lost or invented.
  expect(bill.taxTotal).toBe(sum(bill.taxLines.map((line) => line.taxTotal)));
  for (const line of bill.taxLines) {
    expect(line.taxTotal).toBe(sum(line.components.map((component) => component.amount)));
    const [first, second] = line.components;
    if (first !== undefined && first.rateBp === second?.rateBp) {
      // CGST and SGST at the same rate differ by a paisa at most.
      expect(Math.abs(first.amount - second.amount)).toBeLessThanOrEqual(1);
    }
    for (const component of line.components) {
      const exact = (line.taxableValue * component.rateBp) / 10_000;
      expect(Math.abs(component.amount - exact)).toBeLessThanOrEqual(1);
    }
  }
  expect(bill.taxableValueTotal).toBe(sum(bill.taxLines.map((line) => line.taxableValue)));
  expect(bill.totalBeforeRoundOff).toBe(bill.taxableValueTotal + bill.taxTotal);
  expect(bill.grandTotal).toBe(bill.totalBeforeRoundOff + bill.roundOff);
  if (input.roundOff.kind === 'NEAREST') {
    expect(bill.grandTotal % input.roundOff.unit).toBe(0);
    expect(Math.abs(bill.roundOff)).toBeLessThanOrEqual(input.roundOff.unit / 2);
  } else {
    expect(bill.roundOff).toBe(0);
  }
  if (
    input.priceMode === 'TAX_INCLUSIVE' &&
    (input.serviceCharge === null || input.serviceCharge === undefined)
  ) {
    // Menu prices include tax: the guest pays what the menu says, less discounts.
    expect(bill.totalBeforeRoundOff).toBe(sum(bill.lines.map((line) => line.netAmount)));
  }
}

describe('[BILL-001] [BILL-004] [BILL-005] [BILL-006] property: every bill adds up (QA category D)', () => {
  it('totals, discounts, GST components and round-off always add up', () => {
    fc.assert(
      fc.property(bills, (input) => {
        expectBillAddsUp(input, computeBill(input));
      }),
      RUNS,
    );
  });

  it('GST on one amount: taxable value plus tax is the whole, in both price modes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.constantFrom(...GROUPS),
        fc.constantFrom('TAX_EXCLUSIVE' as const, 'TAX_INCLUSIVE' as const),
        (amount, group, mode) => {
          const tax = computeGroupTax(amount, group, mode);
          expect(tax.grossTotal).toBe(tax.taxableValue + tax.taxTotal);
          expect(tax.taxTotal).toBe(sum(tax.components.map((component) => component.amount)));
          expect(mode === 'TAX_EXCLUSIVE' ? tax.taxableValue : tax.grossTotal).toBe(amount);
        },
      ),
      RUNS,
    );
  });
});

describe('[BILL-007] property: a split always adds up to the bill (QA category D)', () => {
  /** A bill and a split of it into 2 to 6 parts, by items (quantities) or equally. */
  const splits = billsWith(10, 10).chain((input) => {
    const bill = computeBill(input);
    // Each unit of each line goes to a part; the first units go one to each part, so no part is
    // empty (a bill with fewer units than parts is split equally instead).
    const units = bill.lines.flatMap((line, index) =>
      Array.from({ length: line.quantity }, () => index),
    );
    const byItems = fc
      .integer({ min: 2, max: Math.max(2, Math.min(6, units.length)) })
      .chain((parts) =>
        fc
          .array(fc.integer({ min: 0, max: parts - 1 }), {
            minLength: units.length,
            maxLength: units.length,
          })
          .map((owners) => {
            const owner = (unit: number) => (unit < parts ? unit : (owners[unit] ?? 0));
            return Array.from({ length: parts }, (_, part) =>
              bill.lines.map(
                (_line, index) =>
                  units.filter((line, unit) => line === index && owner(unit) === part).length,
              ),
            );
          }),
      );
    const equally = fc
      .integer({ min: 2, max: 6 })
      .map((parts) => Array.from({ length: parts }, () => bill.lines.map(() => 1)));
    return fc.tuple(fc.constant(bill), units.length >= 2 ? fc.oneof(byItems, equally) : equally);
  });

  it('parts add up exactly: gross, discounts, service charge, each tax, round-off, total', () => {
    fc.assert(
      fc.property(splits, ([bill, shares]) => {
        const parts = splitBill(bill, shares);
        expect(parts).toHaveLength(shares.length);
        const total = (pick: (part: (typeof parts)[number]) => number) => sum(parts.map(pick));
        expect(total((part) => part.subtotal)).toBe(bill.subtotal);
        expect(total((part) => part.discountTotal)).toBe(bill.discountTotal);
        expect(total((part) => part.serviceCharge)).toBe(bill.serviceCharge);
        expect(total((part) => part.taxTotal)).toBe(bill.taxTotal);
        expect(total((part) => part.roundOff)).toBe(bill.roundOff);
        expect(total((part) => part.grandTotal)).toBe(bill.grandTotal);
        for (const part of parts) {
          expect(part.grandTotal).toBe(part.totalBeforeRoundOff + part.roundOff);
          expect(part.grandTotal).toBeGreaterThanOrEqual(0);
        }
        for (const taxLine of bill.taxLines) {
          for (const component of taxLine.components) {
            const shared = sum(
              parts.flatMap((part) =>
                part.taxLines
                  .filter(
                    (line) =>
                      line.taxGroupId === taxLine.taxGroupId && line.source === taxLine.source,
                  )
                  .flatMap((line) =>
                    line.components
                      .filter((each) => each.code === component.code)
                      .map((each) => each.amount),
                  ),
              ),
            );
            expect(shared).toBe(component.amount);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('[BILL-008] [BILL-013] property: payments never exceed the bill (QA category D)', () => {
  const payment: fc.Arbitrary<PaymentInput> = fc.oneof(
    fc
      .tuple(fc.integer({ min: 1, max: 200_000 }), fc.integer({ min: 0, max: 50_000 }))
      .map(([amount, extra]) => ({ mode: 'CASH' as const, amount, tendered: amount + extra })),
    fc
      .tuple(
        fc.constantFrom('CARD' as const, 'UPI' as const, 'OTHER' as const),
        fc.integer({ min: 1, max: 200_000 }),
      )
      .map(([mode, amount]) => ({ mode, amount })),
  );

  it('records exactly what was paid, settles only at the total, refuses more', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.array(payment, { minLength: 1, maxLength: 5 }),
        (total, before, payments) => {
          const alreadyPaid = Math.min(before, total);
          const taken = sum(payments.map((each) => each.amount));
          if (alreadyPaid + taken > total) {
            expect(() => applyPayments(total, alreadyPaid, payments)).toThrow(DomainError);
            return;
          }
          const outcome = applyPayments(total, alreadyPaid, payments);
          expect(outcome.paid).toBe(alreadyPaid + taken);
          expect(outcome.remaining).toBe(total - outcome.paid);
          expect(outcome.settled).toBe(outcome.paid === total);
          for (const recorded of outcome.payments) {
            if (recorded.mode === 'CASH') {
              expect(recorded.change).toBe((recorded.tendered ?? 0) - recorded.amount);
              expect(recorded.change).toBeGreaterThanOrEqual(0);
            } else {
              expect(recorded.change).toBeNull();
            }
          }
        },
      ),
      RUNS,
    );
  });

  it('shares an amount out without losing or inventing a paisa', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1_000 }), { minLength: 1, maxLength: 50 }),
        (amount, weights) => {
          fc.pre(sum(weights) > 0);
          const parts = allocate(amount, weights);
          expect(sum(parts)).toBe(amount);
          const weightTotal = sum(weights);
          for (const [index, part] of parts.entries()) {
            expect(Number.isSafeInteger(part) && part >= 0).toBe(true);
            const exact = (amount * (weights[index] ?? 0)) / weightTotal;
            expect(Math.abs(part - exact)).toBeLessThan(1);
          }
        },
      ),
      RUNS,
    );
  });
});

describe('[BILL-013] [RPT-001] property: the day’s report equals its invoices and payments (QA category D)', () => {
  const day = fc.array(
    bills.chain((input) =>
      fc
        .tuple(fc.constantFrom('ISSUED' as const, 'SETTLED' as const, 'VOIDED' as const))
        .map(([status]) => ({ bill: computeBill(input), status })),
    ),
    { minLength: 0, maxLength: 15 },
  );

  it('sales, tax and totals are the sums of the live invoices; payments are all counted', () => {
    fc.assert(
      fc.property(
        day,
        fc.array(fc.integer({ min: 1, max: 300_000 }), { maxLength: 20 }),
        (invoices, paid) => {
          const zInvoices: ZInvoice[] = invoices.map(({ bill, status }, index) => ({
            invoiceNumber: `INV/${String(index + 1)}`,
            status,
            subtotal: bill.subtotal,
            discountTotal: bill.discountTotal,
            serviceCharge: bill.serviceCharge,
            taxTotal: bill.taxTotal,
            roundOff: bill.roundOff,
            grandTotal: bill.grandTotal,
          }));
          const live = invoices.filter((invoice) => invoice.status !== 'VOIDED');
          const report = buildZReport({
            businessDate: '2027-03-31',
            invoices: zInvoices,
            taxLines: live.flatMap(({ bill }) =>
              bill.taxLines.flatMap((line) =>
                line.components.map((component) => ({
                  code: component.code,
                  rateBp: component.rateBp,
                  taxableValue: line.taxableValue,
                  amount: component.amount,
                })),
              ),
            ),
            payments: paid.map((amount, index) => ({
              mode: index % 2 === 0 ? ('CASH' as const) : ('UPI' as const),
              label: null,
              amount,
            })),
            shifts: [],
            cashIn: 0,
            cashOut: 0,
            orders: invoices.length,
          });
          const liveSum = (pick: (bill: BillResult) => number) =>
            sum(live.map(({ bill }) => pick(bill)));
          expect(report.grossSales).toBe(liveSum((bill) => bill.subtotal));
          expect(report.discounts).toBe(liveSum((bill) => bill.discountTotal));
          expect(report.taxTotal).toBe(liveSum((bill) => bill.taxTotal));
          expect(report.netSales).toBe(liveSum((bill) => bill.grandTotal));
          expect(report.netSales).toBe(
            report.grossSales -
              report.discounts +
              report.serviceCharge +
              report.taxTotal +
              report.roundOff -
              // Tax-inclusive bills carry their tax inside the gross: take it out once.
              liveSum((bill) =>
                bill.priceMode === 'TAX_INCLUSIVE' ? bill.taxTotal - serviceTaxOf(bill) : 0,
              ),
          );
          expect(sum(report.taxes.map((tax) => tax.amount))).toBe(report.taxTotal);
          expect(report.paymentsTotal).toBe(sum(paid));
          expect(sum(report.payments.map((each) => each.amount))).toBe(sum(paid));
          expect(report.invoices.count + report.invoices.voided.length).toBe(invoices.length);
        },
      ),
      { numRuns: 500 },
    );
  });
});

/** The tax charged on a bill's service charge (always on top of the price). */
function serviceTaxOf(bill: BillResult): number {
  return sum(
    bill.taxLines.filter((line) => line.source === 'SERVICE_CHARGE').map((line) => line.taxTotal),
  );
}

describe('[BILL-005] a large bill with a large discount (QA-020)', () => {
  it('is shared out exactly, although amount × weight passes 2^53', () => {
    const parts = allocate(990_000_000, [990_000_000, 495_000_000, 1]);
    expect(sum(parts)).toBe(990_000_000);
    const weights = [990_000_000, 495_000_000, 1];
    for (const [index, part] of parts.entries()) {
      const exact = (990_000_000 * (weights[index] ?? 0)) / sum(weights);
      expect(Math.abs(part - exact)).toBeLessThan(1);
    }
    const bill = computeBill({
      priceMode: 'TAX_EXCLUSIVE',
      lines: [
        { id: 'a', unitPrice: 10_000_000, quantity: 99, taxGroupId: 'gst5' },
        { id: 'b', unitPrice: 10_000_000, quantity: 50, taxGroupId: 'gst18' },
      ],
      taxGroups: GROUPS,
      billDiscount: { kind: 'PERCENT', rateBp: 10_000 },
      roundOff: { kind: 'NONE' },
    });
    expect(bill.grandTotal).toBe(0);
    expect(bill.billDiscountTotal).toBe(1_490_000_000);
  });
});

describe('[BILL-008] the last paisa (QA audit, category F)', () => {
  it('a bill paid one paisa short is not settled; paid in full it is', () => {
    expect(applyPayments(23_100, 0, [{ mode: 'UPI', amount: 23_099 }])).toMatchObject({
      settled: false,
      remaining: 1,
    });
    expect(applyPayments(23_100, 23_099, [{ mode: 'CASH', amount: 1 }])).toMatchObject({
      settled: true,
      remaining: 0,
    });
  });
});
