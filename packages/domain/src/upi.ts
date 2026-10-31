/**
 * Paying a printed bill by UPI from the diner's phone (P9-03, ADR-0024): links that open a UPI
 * app with the payee, the amount and the bill filled in, in NPCI's deep-link format
 * (`upi://pay?pa=&pn=&am=&cu=INR&tn=&tr=`). The payment is not confirmed to the restaurant by the
 * link (BRD decision Q4: no payment integration): staff check their UPI app and settle the bill.
 *
 * Use a business (merchant) UPI ID: UPI apps may decline an amount-filled link to a personal one,
 * while a scanned QR code of the same link still works.
 */

export interface UpiPayment {
  /** The restaurant's UPI ID, e.g. `mannat@okhdfcbank`. */
  readonly upiId: string;
  /** The name the diner's app shows. */
  readonly payeeName: string;
  /** Integer paise (BRD §9.4). */
  readonly amountPaise: number;
  /** Shown in the diner's app, e.g. "Mannat bill INV/26-27/000007". At most 80 characters. */
  readonly note: string;
  /** The restaurant's reference for the payment, e.g. the invoice number. At most 35 characters. */
  readonly reference?: string;
}

/** The UPI apps a phone may have, by the link each opens (iPhones need the app's own). */
export const UPI_APPS = ['ANY', 'GPAY', 'PHONEPE', 'PAYTM'] as const;
export type UpiApp = (typeof UPI_APPS)[number];

const PREFIX: Readonly<Record<UpiApp, string>> = {
  ANY: 'upi://pay',
  GPAY: 'gpay://upi/pay',
  PHONEPE: 'phonepe://pay',
  PAYTM: 'paytmmp://pay',
};

/** Rupees with two decimals from integer paise, without floating point: 61200 → "612.00". */
export function upiAmount(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    throw new RangeError('A UPI amount is a positive whole number of paise');
  }
  return `${String(Math.floor(paise / 100))}.${String(paise % 100).padStart(2, '0')}`;
}

/** The characters NPCI's apps read safely in a note or reference; anything else is dropped. */
const plain = (text: string, max: number) =>
  text
    .replace(/[^A-Za-z0-9 ./_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** The link that opens `app` (any UPI app by default) with the payment filled in. */
export function upiPayLink(payment: UpiPayment, app: UpiApp = 'ANY'): string {
  const note = plain(payment.note, 80);
  const reference = payment.reference === undefined ? '' : plain(payment.reference, 35);
  const params: [string, string][] = [
    ['pa', payment.upiId],
    ['pn', plain(payment.payeeName, 50) || 'Restaurant'],
    ['am', upiAmount(payment.amountPaise)],
    ['cu', 'INR'],
    ...(note === '' ? [] : [['tn', note] as [string, string]]),
    ...(reference === '' ? [] : [['tr', reference] as [string, string]]),
  ];
  // Spaces as %20, never "+", which some UPI apps show as it is.
  return `${PREFIX[app]}?${params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`;
}
