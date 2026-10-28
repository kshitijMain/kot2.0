import type { InvoiceView } from '@rp/contracts';
import { describe, expect, it } from 'vitest';
import {
  lineCells,
  type ParsedJob,
  paperWidthOf,
  parseEscPos,
} from '../../../../scripts/virtual-printer/escpos-parser.mjs';
import {
  type KotTicket,
  renderBill,
  renderDrawerKick,
  renderKotTicket,
  renderTestPage,
} from '../../src/printing/escpos.js';

/**
 * The virtual printer (development only, scripts/virtual-printer) reads what the server really
 * sends: the test page, a kitchen ticket and a bill, on both paper widths.
 */

const AT = new Date('2026-09-26T07:35:00Z');

const TICKET: KotTicket = {
  kind: 'NEW',
  kotNumber: 17,
  orderNumber: 42,
  stationName: 'Kitchen',
  destination: { type: 'TABLE', label: 'T4' },
  waiterName: 'Ravi',
  source: 'WAITER_APP',
  createdAt: AT,
  timeZone: 'Asia/Kolkata',
  reprint: false,
  lines: [
    {
      quantity: 2,
      name: 'Paneer Tikka',
      variantName: 'Full',
      modifiers: [{ name: 'Extra cheese', quantity: 1 }],
      instructions: 'Less spicy',
      comboName: null,
    },
  ],
};

const INVOICE: InvoiceView = {
  id: '01a0dc0d-781d-7218-95ef-f500b348d2f0',
  billId: null,
  invoiceNumber: 'INV/26-27/000042',
  status: 'ISSUED',
  invoiceDate: '2026-09-26',
  financialYear: '2026-27',
  businessDate: '2026-09-26',
  issuedAt: AT.toISOString(),
  issuedById: '01a0dc0d-781d-7218-95ef-f500b348d2f1',
  tableLabel: 'T4',
  particulars: {
    displayName: 'Spice Route',
    legalName: null,
    address: null,
    gstin: '27AAAAA0000A1Z5',
    fssaiNumber: null,
    placeOfSupply: null,
    phone: null,
    headerLines: [],
    footerLines: ['Thank you'],
    amountInWords: false,
  },
  customer: { name: null, phone: null, phoneConsent: false, gstin: null },
  priceMode: 'TAX_EXCLUSIVE',
  lines: [
    {
      description: 'Paneer Tikka (Full)',
      quantity: 1,
      unitPrice: 28_000,
      lineTotal: 28_000,
      discount: 0,
      taxableValue: 28_000,
      sacCode: '996331',
    },
  ],
  taxLines: [],
  subtotal: 28_000,
  discountTotal: 0,
  serviceCharge: 0,
  taxTotal: 0,
  roundOff: 0,
  grandTotal: 28_000,
  printCount: 0,
  version: 1,
  voidedAt: null,
  voidReason: null,
  replacesInvoiceId: null,
};

/** Every printed line of a job as text. */
const texts = (job: ParsedJob) =>
  job.receipts.flatMap((receipt) =>
    receipt.lines.map((line) => line.runs.map((run) => run.text).join('')),
  );

const lineWith = (job: ParsedJob, text: string) => {
  const line = job.receipts
    .flatMap((receipt) => receipt.lines)
    .find((entry) => entry.runs.some((run) => run.text.includes(text)));
  if (line === undefined) throw new Error(`No line with ${text}`);
  return line;
};

describe('the virtual printer (development tooling)', () => {
  it('[KDS-008] reads a test page: centred double-size title, a ruler as wide as the paper, a cut', () => {
    for (const paperWidthMm of [58, 80] as const) {
      const job = parseEscPos(
        renderTestPage({
          restaurantName: 'Spice Route',
          printerName: 'Kitchen printer',
          paperWidthMm,
          at: AT,
          timeZone: 'Asia/Kolkata',
        }),
      );
      expect(job.receipts).toHaveLength(1);
      expect(job.receipts[0]?.cut).toBe(true);
      expect(lineWith(job, 'TEST PAGE')).toMatchObject({
        align: 'centre',
        runs: [{ text: 'TEST PAGE', bold: true, width: 2, height: 2 }],
      });
      const ruler = lineWith(job, '1234567890');
      expect(lineCells(ruler)).toBe(paperWidthMm === 58 ? 32 : 48);
      expect(paperWidthOf(job)).toBe(paperWidthMm);
      expect(job.unknown).toEqual([]);
    }
  });

  it('[ORD-007] reads a kitchen ticket: the table large, dishes tall and bold, modifiers plain', () => {
    const job = parseEscPos(renderKotTicket(TICKET, 80));
    expect(lineWith(job, 'TABLE T4').runs[0]).toMatchObject({ width: 2, height: 2, bold: true });
    expect(lineWith(job, 'Paneer Tikka (Full)').runs[0]).toMatchObject({
      text: '2 x Paneer Tikka (Full)',
      width: 1,
      height: 2,
      bold: true,
    });
    expect(lineWith(job, 'Extra cheese').runs[0]).toMatchObject({ bold: false, height: 1 });
    expect(texts(job)).toContain('    ! Less spicy');
    expect(paperWidthOf(job)).toBe(80);
  });

  it('[BILL-002] reads a bill, the total tall and bold; prices come as "Rs", as the encoder sends', () => {
    const job = parseEscPos(
      renderBill(INVOICE, { paperWidthMm: 58, duplicate: false, timeZone: 'Asia/Kolkata' }),
    );
    expect(lineWith(job, 'TAX INVOICE').runs[0]?.bold).toBe(true);
    const total = lineWith(job, 'TOTAL Rs');
    expect(total.runs[0]).toMatchObject({ bold: true, height: 2 });
    expect(lineCells(total)).toBe(32);
    expect(paperWidthOf(job)).toBe(58);
    expect(paperWidthOf(job, 80)).toBe(80);
  });

  it('shows the rupee sign when one is sent as UTF-8, and counts cash drawer pulses', () => {
    const rupee = [...Buffer.from('Total ₹280.00', 'utf8')];
    const job = parseEscPos([0x1b, 0x40, ...rupee, 0x0a, ...renderDrawerKick()]);
    expect(texts(job)).toEqual(['Total ₹280.00']);
    expect(job.drawerKicks).toBe(1);
    expect(job.receipts[0]?.cut).toBe(false);
  });

  it('splits a job at each cut and names commands it does not draw', () => {
    const job = parseEscPos([
      ...Buffer.from('one\n'),
      0x1d,
      0x56,
      0x00,
      ...Buffer.from('two\n'),
      0x1d,
      0x56,
      0x42,
      0x03,
      0x1b,
      0x7a,
    ]);
    expect(job.receipts.map((receipt) => receipt.lines[0]?.runs[0]?.text)).toEqual(['one', 'two']);
    expect(job.receipts[1]?.lines).toHaveLength(4);
    expect(job.unknown).toEqual(['1b 7a']);
  });
});
