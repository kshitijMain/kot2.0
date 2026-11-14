import type { InvoicePreviewRequest, InvoiceView } from '@rp/contracts';
import { particularsFrom } from '../billing/invoices.service.js';
import { billTextLines } from '../printing/escpos.js';

const ZERO_ID = '00000000-0000-7000-8000-000000000000';

/**
 * A sample bill printed from invoice settings being typed (ADR-0031): two dishes at 5 % GST,
 * through the renderer real bills use, so the preview is what the printer and the digital bill
 * will show. Nothing is saved or numbered.
 */
export function invoicePreviewLines(
  request: InvoicePreviewRequest,
  at: Date,
  timeZone: string,
): string[] {
  const particulars = particularsFrom({
    displayName: request.displayName,
    legalName: request.legalName,
    address: request.address,
    phone: request.phone,
    stateCode: request.stateCode,
    gstin: request.gstin,
    fssaiNumber: request.fssaiNumber,
    headerLines: request.headerLines.filter((line) => line !== ''),
    footerLines: request.footerLines.filter((line) => line !== ''),
    thankYouLine: request.thankYouLine,
    printPhone: request.printPhone,
    printFssai: request.printFssai,
    amountInWords: request.amountInWords,
  });
  const date = at.toISOString().slice(0, 10);
  const line = (description: string, quantity: number, unitPrice: number) => ({
    description,
    quantity,
    unitPrice,
    lineTotal: quantity * unitPrice,
    discount: 0,
    taxableValue: quantity * unitPrice,
    sacCode: '996331',
  });
  const lines = [line('Paneer Tikka (Full)', 2, 28_000), line('Butter Naan', 2, 6_000)];
  const taxable = lines.reduce((sum, entry) => sum + entry.taxableValue, 0);
  const half = Math.round(taxable * 0.025);
  const sample: InvoiceView = {
    id: ZERO_ID,
    billId: null,
    invoiceNumber: request.invoiceNumber,
    status: 'ISSUED',
    invoiceDate: date,
    financialYear: '',
    businessDate: date,
    issuedAt: at.toISOString(),
    issuedById: ZERO_ID,
    tableLabel: '3',
    particulars,
    customer: { name: null, phone: null, phoneConsent: false, gstin: null },
    priceMode: 'TAX_EXCLUSIVE',
    lines,
    taxLines: [
      { taxGroupId: ZERO_ID, code: 'CGST', rateBp: 250, taxableValue: taxable, amount: half },
      { taxGroupId: ZERO_ID, code: 'SGST', rateBp: 250, taxableValue: taxable, amount: half },
    ],
    subtotal: taxable,
    discountTotal: 0,
    serviceCharge: 0,
    taxTotal: half * 2,
    roundOff: 0,
    grandTotal: taxable + half * 2,
    printCount: 0,
    version: 1,
    voidedAt: null,
    voidReason: null,
    replacesInvoiceId: null,
  };
  return billTextLines(sample, timeZone);
}
