import type { InvoiceView } from '@rp/contracts';
import type { QrBillInvoice, QrTableBill, QrUpiPayee } from '@rp/contracts/relay';

/**
 * The table's printed bill as its diners see it on the QR page (P9-03, ADR-0024): what the paper
 * says, amounts in paise, without the diner's number or anything about staff. Voided invoices
 * are left out (a re-issued one replaces them).
 */
export function qrBillInvoiceOf(invoice: InvoiceView): QrBillInvoice {
  return {
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt,
    status: invoice.status === 'SETTLED' ? 'SETTLED' : 'ISSUED',
    lines: invoice.lines.slice(0, 300).map((line) => ({
      description: line.description.slice(0, 200) || '—',
      quantity: line.quantity,
      amount: line.lineTotal,
    })),
    subtotal: invoice.subtotal,
    discountTotal: invoice.discountTotal,
    serviceCharge: invoice.serviceCharge,
    taxLines: invoice.taxLines.slice(0, 20).map((tax) => ({
      // Basis points as a percentage for the label only, e.g. 250 → "2.5%".
      label: `${tax.code} ${String(tax.rateBp / 100)}%`.slice(0, 40),
      amount: tax.amount,
    })),
    roundOff: invoice.roundOff,
    grandTotal: invoice.grandTotal,
  };
}

/** The table's bill, or null when nothing is printed for its sitting (or all of it was voided). */
export function qrTableBillOf(
  invoices: readonly InvoiceView[],
  upi: QrUpiPayee | null,
): QrTableBill | null {
  const shown = invoices.filter((invoice) => invoice.status !== 'VOIDED').slice(0, 20);
  return shown.length === 0 ? null : { invoices: shown.map(qrBillInvoiceOf), upi };
}
