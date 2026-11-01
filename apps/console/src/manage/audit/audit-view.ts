/**
 * The audit viewer (P4-07a, AUD-005): actions and record types as the log records them (data,
 * not interface text), made readable, and the recorded values shown as they were stored.
 */

/** Words read as letters: they stay in capitals ("Table QR codes issued", not "qr"; P9-24). */
const ACRONYMS: ReadonlySet<string> = new Set([
  'qr',
  'kot',
  'kots',
  'kds',
  'pos',
  'pin',
  'pins',
  'upi',
  'gst',
  'gstin',
  'otp',
  'csv',
  'pdf',
  'apk',
  'id',
  'tls',
  'ca',
]);

/** "INVOICE_VOIDED" → "Invoice voided"; "order_item" → "Order item"; "KOT_REPRINTED" → "KOT reprinted". */
export function readable(code: string): string {
  const words = code
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word))
    .join(' ');
  return words === '' ? code : words.charAt(0).toUpperCase() + words.slice(1);
}

/** A recorded value as indented JSON, or undefined when nothing was recorded. */
export function recorded(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object' && Object.keys(value).length === 0) return undefined;
  return JSON.stringify(value, null, 2);
}

/** The first characters of an id, enough to tell records apart on screen. */
export function shortId(id: string | null): string {
  return id === null ? '' : id.slice(0, 8);
}
