import { z } from 'zod';
import { InvoiceView } from './billing.js';
import { Id, IsoDate, Paise, PaymentMode, Timestamp } from './common.js';

/**
 * The bill history (P9-27, RPT-006, DATA-012): the Owner and managers find any invoice still on
 * the PC by business dates, its number or the guest's phone number, newest first, 50 at a time.
 * Read on the PC only: the phones and tablets keep today's data (tier 1); older years are in
 * their archive (tier 3, DATA-009).
 */

/** Invoices a page holds at most. */
export const BILL_HISTORY_PAGE = 50;

export const BillHistoryQuery = z
  .strictObject({
    /** Business dates, both ends included; either may be left out. */
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    /** The invoice number as printed ("INV/26-27/000123"), or only its running number ("123"). */
    number: z.string().trim().min(1).max(32).optional(),
    /** The guest's phone number however it was typed; its last ten digits are compared. */
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s().-]{6,24}$/)
      .optional(),
    /** Where the previous page ended (its `nextCursor`). */
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(BILL_HISTORY_PAGE).default(BILL_HISTORY_PAGE),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'The start date must not be after the end date.',
    path: ['to'],
  });
export type BillHistoryQuery = z.infer<typeof BillHistoryQuery>;

export const BillHistoryEntry = z.object({
  invoiceId: Id,
  invoiceNumber: z.string(),
  businessDate: IsoDate,
  issuedAt: Timestamp,
  /** The table it was billed at, or null for a takeaway. */
  tableLabel: z.string().nullable(),
  /** The takeaway token, when there was one. */
  takeawayToken: z.int().positive().nullable(),
  grandTotal: Paise,
  status: z.enum(['ISSUED', 'SETTLED', 'VOIDED']),
  /** How it was paid, each mode once (OTHER with its name), in the order taken. */
  payments: z.array(z.object({ mode: PaymentMode, label: z.string().nullable() })),
});
export type BillHistoryEntry = z.infer<typeof BillHistoryEntry>;

export const BillHistoryResponse = z.object({
  invoices: z.array(BillHistoryEntry),
  /** Pass as `cursor` for the next page; null after the last. */
  nextCursor: z.string().nullable(),
});
export type BillHistoryResponse = z.infer<typeof BillHistoryResponse>;

export const BillHistoryParams = z.strictObject({ id: Id });
export type BillHistoryParams = z.infer<typeof BillHistoryParams>;

/** One invoice from the history, and its text as printed. */
export const BillHistoryInvoiceResponse = z.object({
  invoice: InvoiceView,
  printed: z.array(z.string()),
});
export type BillHistoryInvoiceResponse = z.infer<typeof BillHistoryInvoiceResponse>;
