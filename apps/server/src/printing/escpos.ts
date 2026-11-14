import type { InvoiceView } from '@rp/contracts';
import { amountInWords, formatRupees, taxByCodeAndRate, toLocalDateTime } from '@rp/domain';

/**
 * ESC/POS rendering for kitchen tickets and test pages (P1-07a, KDS-008). Pure: it turns a ticket
 * into the bytes a thermal printer takes, so it is tested byte for byte without a printer.
 *
 * Only the commands every ESC/POS printer understands are used: initialise, alignment, bold,
 * character size, line feed and cut. Text is reduced to printable ASCII, because the code page
 * differs from printer to printer and a wrong guess prints garbage in the kitchen.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_CENTRE = [ESC, 0x61, 1];
const BOLD_ON = [ESC, 0x45, 1];
const BOLD_OFF = [ESC, 0x45, 0];
const SIZE_NORMAL = [GS, 0x21, 0x00];
const SIZE_DOUBLE = [GS, 0x21, 0x11];
const SIZE_TALL = [GS, 0x21, 0x01];
/** White on black (GS B); a printer without it prints the text plainly, still readable. */
const REVERSE_ON = [GS, 0x42, 1];
const REVERSE_OFF = [GS, 0x42, 0];
/** Feed three lines so the last text clears the cutter, then a partial cut. */
const FEED_AND_CUT = [GS, 0x56, 0x42, 0x03];

export type PaperWidthMm = 58 | 80;

/** Rows written before P1-07a could hold any width; anything but 58 prints as 80 mm. */
export function paperWidthOf(printer: { readonly paperWidthMm: number }): PaperWidthMm {
  return printer.paperWidthMm === 58 ? 58 : 80;
}

/** Characters per line in the printer's standard font (font A, 12 x 24 dots). */
export function charactersPerLine(paperWidthMm: PaperWidthMm): number {
  return paperWidthMm === 58 ? 32 : 48;
}

export interface KotTicketModifier {
  readonly name: string;
  readonly quantity: number;
}

export interface KotTicketLine {
  /** Negative on a MODIFIED ticket that reduces a line. */
  readonly quantity: number;
  readonly name: string;
  readonly variantName: string | null;
  readonly modifiers: readonly KotTicketModifier[];
  readonly instructions: string | null;
  /** The combo this line is part of, so the kitchen sees what belongs together. */
  readonly comboName: string | null;
}

export interface KotTicket {
  readonly kind: 'NEW' | 'MODIFIED' | 'CANCELLED';
  readonly kotNumber: number;
  readonly orderNumber: number;
  readonly stationName: string;
  /** Table label for dine-in, token for takeaway (TBL-008). */
  readonly destination:
    | { readonly type: 'TABLE'; readonly label: string }
    | { readonly type: 'TAKEAWAY'; readonly token: number | null };
  /** Whoever sent the KOT (ADR-0031), not whoever opened the table. */
  readonly sentByName: string | null;
  readonly source: 'POS' | 'WAITER_APP' | 'TABLE_TABLET' | 'QR';
  readonly createdAt: Date;
  readonly timeZone: string;
  readonly lines: readonly KotTicketLine[];
  /** Printed again on request or on another printer (KDS-008). */
  readonly reprint: boolean;
  /** Guests at the table; null for a takeaway (ADR-0031). */
  readonly covers?: number | null;
  /** Which new KOT this is for the table, 1 for the first (ADR-0031: "2nd KOT for this table"). */
  readonly tableKotNumber?: number | null;
  /** The ticket sends dishes that were held for later (ORD-016). */
  readonly fired?: boolean;
  /** Dishes of the order at this station still held: listed, not to cook yet (ORD-016). */
  readonly held?: readonly {
    readonly quantity: number;
    readonly name: string;
    readonly variantName: string | null;
  }[];
}

const KIND_BANNERS: Readonly<Record<KotTicket['kind'], string | null>> = {
  NEW: null,
  MODIFIED: 'CHANGED',
  CANCELLED: 'CANCELLED',
};

/** A phone keyboard's quotes and dashes, printed as the plain ones (QA-019). */
const PLAIN_PUNCTUATION: readonly (readonly [RegExp, string])[] = [
  [/[\u2018\u2019\u201a\u201b\u2032]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, '-'],
];

/**
 * Printable ASCII only: accents are dropped, curly quotes and dashes made plain, anything else
 * becomes "?". No control character can reach the printer, so text never acts as a command.
 */
export function toPrintable(text: string): string {
  let plain = text.normalize('NFKD');
  for (const [pattern, replacement] of PLAIN_PUNCTUATION) {
    plain = plain.replace(pattern, replacement);
  }
  return plain
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Breaks text into lines of at most `width` characters, at spaces where it can. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of toPrintable(text)
    .split(' ')
    .filter((part) => part !== '')) {
    let rest = word;
    while (rest.length > 0) {
      const room = current === '' ? width : width - current.length - 1;
      if (rest.length <= room) {
        current = current === '' ? rest : `${current} ${rest}`;
        rest = '';
      } else if (current !== '') {
        lines.push(current);
        current = '';
      } else {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
    }
  }
  if (current !== '') lines.push(current);
  return lines.length === 0 ? [''] : lines;
}

/** `left` and `right` on one line, `right` flush right; `left` is shortened if both do not fit. */
function spread(left: string, right: string, width: number): string {
  const safeRight = toPrintable(right).slice(0, width);
  const room = Math.max(width - safeRight.length - 1, 0);
  const safeLeft = toPrintable(left).slice(0, room);
  return `${safeLeft}${' '.repeat(width - safeLeft.length - safeRight.length)}${safeRight}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** "26-09-2026 13:05" in the restaurant's time zone (timestamps are shown in IST). */
export function formatLocal(instant: Date, timeZone: string): string {
  const local = toLocalDateTime(instant, timeZone);
  return `${pad2(local.day)}-${pad2(local.month)}-${String(local.year)} ${pad2(local.hour)}:${pad2(local.minute)}`;
}

class Receipt {
  private readonly bytes: number[] = [...INIT];
  /** The text without printer commands (the archive's invoice books, P7-06b). */
  readonly texts: string[] = [];

  command(sequence: readonly number[]): this {
    this.bytes.push(...sequence);
    return this;
  }

  line(text = ''): this {
    this.texts.push(toPrintable(text));
    for (const char of toPrintable(text)) this.bytes.push(char.charCodeAt(0));
    this.bytes.push(LF);
    return this;
  }

  lines(texts: readonly string[]): this {
    for (const text of texts) this.line(text);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from([...this.bytes, ...FEED_AND_CUT]);
  }
}

function destinationText(destination: KotTicket['destination']): string {
  if (destination.type === 'TABLE') return `TABLE ${destination.label}`;
  return destination.token === null ? 'TAKEAWAY' : `TAKEAWAY #${String(destination.token)}`;
}

function quantityText(quantity: number): string {
  return `${String(quantity)} x `;
}

/** "1 item", "3 items": the word agrees with the number (ADR-0031). */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(value: number): string {
  const tens = value % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : value % 10 === 1
        ? 'st'
        : value % 10 === 2
          ? 'nd'
          : value % 10 === 3
            ? 'rd'
            : 'th';
  return `${String(value)}${suffix}`;
}

/** Centres text in a full-width line, so an inverted banner runs across the paper. */
function banner(text: string, width: number): string[] {
  return wrap(text, width).map((part) => {
    const left = Math.floor((width - part.length) / 2);
    return `${' '.repeat(left)}${part}`.padEnd(width);
  });
}

const SOURCE_NOTES: Readonly<Record<KotTicket['source'], string | null>> = {
  POS: null,
  WAITER_APP: null,
  TABLE_TABLET: 'table tablet order',
  QR: 'QR order',
};

/**
 * A kitchen order ticket (ORD-007, KDS-008), laid out for reading at a glance (ADR-0031): the
 * table or takeaway number very large, the station as an inverted banner, the KOT number and time
 * large, who sent it, the guests and whether the table had KOTs before; then each dish large with
 * its quantity, size, add-ons and notes indented under it, dishes held for later marked, and a
 * footer counting lines and items in words that agree with the number. Reprints, changed and
 * cancelled slips say so in an inverted banner of their own.
 */
export function renderKotTicket(ticket: KotTicket, paperWidthMm: PaperWidthMm): Uint8Array {
  const width = charactersPerLine(paperWidthMm);
  const doubleWidth = Math.floor(width / 2);
  const receipt = new Receipt();

  receipt.command(ALIGN_CENTRE).command(SIZE_DOUBLE).command(BOLD_ON);
  receipt.lines(wrap(destinationText(ticket.destination), doubleWidth));
  receipt.command(REVERSE_ON);
  receipt.lines(banner(ticket.stationName.toUpperCase(), doubleWidth));
  receipt.command(REVERSE_OFF);
  const kind = KIND_BANNERS[ticket.kind];
  for (const text of [kind, ticket.reprint ? 'REPRINT' : null]) {
    if (text === null) continue;
    // A white line keeps it apart from the station's banner.
    receipt.command(SIZE_NORMAL).line().command(SIZE_DOUBLE);
    receipt.command(REVERSE_ON).lines(banner(text, doubleWidth)).command(REVERSE_OFF);
  }
  if (ticket.fired === true) receipt.lines(wrap('FIRE: HELD DISHES', doubleWidth));
  receipt.command(SIZE_NORMAL).command(BOLD_OFF);
  if (ticket.kind === 'CANCELLED') receipt.lines(wrap('Do not cook these.', width));

  receipt.command(ALIGN_LEFT).command(SIZE_TALL).command(BOLD_ON);
  receipt.line(
    spread(
      `KOT ${String(ticket.kotNumber)}`,
      formatLocal(ticket.createdAt, ticket.timeZone).slice(-5),
      width,
    ),
  );
  receipt.command(SIZE_NORMAL).command(BOLD_OFF);
  if (ticket.sentByName !== null) {
    const note = SOURCE_NOTES[ticket.source];
    receipt.lines(wrap(`Sent by: ${ticket.sentByName}${note === null ? '' : ` (${note})`}`, width));
  }
  const covers = ticket.destination.type === 'TABLE' ? (ticket.covers ?? null) : null;
  receipt.line(
    [
      ...(covers === null ? [] : [counted(covers, 'guest', 'guests')]),
      `Order ${String(ticket.orderNumber)}`,
    ].join(', '),
  );
  const nth = ticket.tableKotNumber ?? null;
  if (ticket.kind === 'NEW' && ticket.destination.type === 'TABLE' && nth !== null && nth > 1) {
    receipt
      .command(BOLD_ON)
      .line(`${ordinal(nth)} KOT for this table`)
      .command(BOLD_OFF);
  }
  receipt.line('-'.repeat(width));

  for (const item of ticket.lines) {
    const quantity = quantityText(item.quantity);
    const indent = ' '.repeat(quantity.length);
    const name = item.variantName === null ? item.name : `${item.name} (${item.variantName})`;
    const nameLines = wrap(name, width - quantity.length);
    receipt.command(SIZE_TALL).command(BOLD_ON);
    receipt.lines(nameLines.map((text, index) => `${index === 0 ? quantity : indent}${text}`));
    receipt.command(SIZE_NORMAL).command(BOLD_OFF);
    for (const modifier of item.modifiers) {
      const label =
        modifier.quantity === 1 ? modifier.name : `${modifier.name} x${String(modifier.quantity)}`;
      receipt.lines(wrap(`+ ${label}`, width - indent.length).map((text) => `${indent}${text}`));
    }
    if (item.instructions !== null && item.instructions.trim() !== '') {
      receipt.lines(
        wrap(`! ${item.instructions}`, width - indent.length).map((text) => `${indent}${text}`),
      );
    }
    if (item.comboName !== null) {
      receipt.lines(
        wrap(`(part of ${item.comboName})`, width - indent.length).map(
          (text) => `${indent}${text}`,
        ),
      );
    }
  }

  const held = ticket.held ?? [];
  if (held.length > 0) {
    receipt.line('-'.repeat(width));
    receipt.command(BOLD_ON).lines(wrap('ON HOLD - DO NOT COOK YET', width)).command(BOLD_OFF);
    for (const item of held) {
      const name = item.variantName === null ? item.name : `${item.name} (${item.variantName})`;
      receipt.lines(wrap(`${quantityText(item.quantity)}${name}`, width));
    }
  }

  receipt.line('-'.repeat(width));
  const count = ticket.lines.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
  receipt.line(
    spread(
      `${counted(ticket.lines.length, 'line', 'lines')}, ${counted(count, 'item', 'items')}`,
      formatLocal(ticket.createdAt, ticket.timeZone).slice(0, 10),
      width,
    ),
  );
  return receipt.finish();
}

export interface TestPage {
  readonly restaurantName: string;
  readonly printerName: string;
  readonly paperWidthMm: PaperWidthMm;
  readonly at: Date;
  readonly timeZone: string;
}

/**
 * The test page for setup (ONB-004 step 6): says which printer it came from, and a ruler across
 * the full width so the installer can confirm the paper width matches the printer.
 */
export function renderTestPage(page: TestPage): Uint8Array {
  const width = charactersPerLine(page.paperWidthMm);
  const ruler = Array.from({ length: width }, (_, index) => String((index + 1) % 10)).join('');
  return new Receipt()
    .command(ALIGN_CENTRE)
    .command(SIZE_DOUBLE)
    .command(BOLD_ON)
    .lines(wrap('TEST PAGE', Math.floor(width / 2)))
    .command(SIZE_NORMAL)
    .command(BOLD_OFF)
    .lines(wrap(page.restaurantName, width))
    .command(ALIGN_LEFT)
    .line('-'.repeat(width))
    .lines(wrap(`Printer: ${page.printerName}`, width))
    .line(`Paper: ${String(page.paperWidthMm)} mm, ${String(width)} characters`)
    .line(formatLocal(page.at, page.timeZone))
    .line(ruler)
    .line('-'.repeat(width))
    .lines(wrap('If this page printed in full, the printer is ready.', width))
    .finish();
}

export interface PrintNoticePage {
  /** Large heading, e.g. "MOVED". */
  readonly title: string;
  readonly lines: readonly string[];
  readonly stationName: string;
  readonly createdAt: Date;
  readonly timeZone: string;
}

/**
 * A note for a station that is not a ticket to cook from, e.g. "Moved from T4 to T7" when a table
 * moves (TBL-005: the tickets already printed stay valid, so they are not printed again).
 */
export function renderNotice(notice: PrintNoticePage, paperWidthMm: PaperWidthMm): Uint8Array {
  const width = charactersPerLine(paperWidthMm);
  return new Receipt()
    .command(ALIGN_CENTRE)
    .command(SIZE_DOUBLE)
    .command(BOLD_ON)
    .lines(wrap(notice.title, Math.floor(width / 2)))
    .command(SIZE_NORMAL)
    .command(BOLD_OFF)
    .lines(wrap(notice.stationName, width))
    .command(ALIGN_LEFT)
    .line('-'.repeat(width))
    .command(SIZE_TALL)
    .command(BOLD_ON)
    .lines(notice.lines.flatMap((text) => wrap(text, width)))
    .command(SIZE_NORMAL)
    .command(BOLD_OFF)
    .line('-'.repeat(width))
    .line(formatLocal(notice.createdAt, notice.timeZone))
    .finish();
}

/** "2.5%" from basis points. */
function percent(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100);
  const fraction = String(rateBp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? `${String(whole)}%` : `${String(whole)}.${fraction}%`;
}

const money = (paise: number): string => formatRupees(paise, { symbol: false });

/**
 * The printed bill: a GST tax invoice (BILL-002, BILL-014). The seller's particulars and header,
 * the invoice number, date and place of supply, the customer's GSTIN for B2B, the lines with any
 * discount, the tax per component and rate, the round-off and the total (in words too, BILL-001),
 * the SAC codes and the footer. A reprint says DUPLICATE in large letters (BILL-009). The logo is added when menu photos
 * exist (P1-04).
 */
export function renderBill(
  invoice: InvoiceView,
  options: {
    readonly paperWidthMm: PaperWidthMm;
    readonly duplicate: boolean;
    readonly timeZone: string;
  },
): Uint8Array {
  return buildBill(invoice, options).finish();
}

/** The bill as plain text lines, as printed on 80 mm paper (the archive's invoice books). */
export function billTextLines(invoice: InvoiceView, timeZone: string): string[] {
  return buildBill(invoice, { paperWidthMm: 80, duplicate: false, timeZone }).texts;
}

function buildBill(
  invoice: InvoiceView,
  options: {
    readonly paperWidthMm: PaperWidthMm;
    readonly duplicate: boolean;
    readonly timeZone: string;
  },
): Receipt {
  const width = charactersPerLine(options.paperWidthMm);
  const half = Math.floor(width / 2);
  const { particulars } = invoice;
  const receipt = new Receipt()
    .command(ALIGN_CENTRE)
    .command(SIZE_DOUBLE)
    .command(BOLD_ON)
    .lines(wrap(particulars.displayName, half))
    .command(SIZE_NORMAL)
    .command(BOLD_OFF);
  if (particulars.legalName !== null && particulars.legalName !== particulars.displayName) {
    receipt.lines(wrap(particulars.legalName, width));
  }
  if (particulars.address !== null) {
    const { line1, line2, city, pincode } = particulars.address;
    receipt.lines(wrap(line1, width));
    if (line2 !== undefined) receipt.lines(wrap(line2, width));
    receipt.lines(wrap(`${city} - ${pincode}`, width));
  }
  if (particulars.phone !== null) receipt.line(`Phone: ${particulars.phone}`);
  if (particulars.gstin !== null) receipt.line(`GSTIN: ${particulars.gstin}`);
  if (particulars.fssaiNumber !== null) receipt.line(`FSSAI: ${particulars.fssaiNumber}`);
  for (const text of particulars.headerLines) receipt.lines(wrap(text, width));

  receipt
    .command(BOLD_ON)
    .line(particulars.gstin === null ? 'BILL' : 'TAX INVOICE')
    .command(BOLD_OFF);
  if (invoice.status === 'VOIDED') {
    receipt.command(SIZE_DOUBLE).command(BOLD_ON).lines(wrap('VOID', half));
    receipt.command(SIZE_NORMAL).command(BOLD_OFF);
  }
  if (options.duplicate) {
    receipt.command(SIZE_DOUBLE).command(BOLD_ON).lines(wrap('DUPLICATE', half));
    receipt.command(SIZE_NORMAL).command(BOLD_OFF);
  }

  receipt.command(ALIGN_LEFT);
  receipt.line(
    spread(
      `No: ${invoice.invoiceNumber}`,
      invoice.tableLabel === null ? 'Takeaway' : `Table ${invoice.tableLabel}`,
      width,
    ),
  );
  receipt.line(`Date: ${formatLocal(new Date(invoice.issuedAt), options.timeZone)}`);
  if (particulars.placeOfSupply !== null) {
    receipt.line(`Place of supply: ${particulars.placeOfSupply}`);
  }
  if (invoice.customer.name !== null)
    receipt.lines(wrap(`Customer: ${invoice.customer.name}`, width));
  // P9-02: the number the diner gave for the bill (BILL-011), only kept with their consent.
  if (invoice.customer.phone !== null && invoice.customer.phoneConsent) {
    receipt.line(`Mobile: ${invoice.customer.phone}`);
  }
  if (invoice.customer.gstin !== null) receipt.line(`Customer GSTIN: ${invoice.customer.gstin}`);
  receipt.line('-'.repeat(width));

  for (const line of invoice.lines) {
    receipt.lines(wrap(line.description, width));
    receipt.line(
      spread(`  ${String(line.quantity)} x ${money(line.unitPrice)}`, money(line.lineTotal), width),
    );
    if (line.discount > 0) receipt.line(spread('  Discount', `-${money(line.discount)}`, width));
  }
  receipt.line('-'.repeat(width));
  receipt.line(spread('Subtotal', money(invoice.subtotal), width));
  if (invoice.discountTotal > 0) {
    receipt.line(spread('Discounts', `-${money(invoice.discountTotal)}`, width));
  }
  if (invoice.serviceCharge > 0) {
    receipt.line(spread('Service charge (voluntary)', money(invoice.serviceCharge), width));
  }
  // One line per tax and rate (P9-25): the service charge's tax joins the dishes'.
  for (const tax of taxByCodeAndRate(invoice.taxLines)) {
    receipt.line(
      spread(
        `${tax.code} @ ${percent(tax.rateBp)} on ${money(tax.taxableValue ?? 0)}`,
        money(tax.amount),
        width,
      ),
    );
  }
  if (invoice.roundOff !== 0) {
    receipt.line(
      spread('Round off', `${invoice.roundOff > 0 ? '+' : ''}${money(invoice.roundOff)}`, width),
    );
  }
  receipt.command(SIZE_TALL).command(BOLD_ON);
  receipt.line(spread('TOTAL Rs', money(invoice.grandTotal), width));
  receipt.command(SIZE_NORMAL).command(BOLD_OFF);
  if (particulars.amountInWords) receipt.lines(wrap(amountInWords(invoice.grandTotal), width));
  receipt.line('-'.repeat(width));
  const sacCodes = [
    ...new Set(invoice.lines.flatMap((line) => (line.sacCode === null ? [] : [line.sacCode]))),
  ];
  if (sacCodes.length > 0) receipt.lines(wrap(`SAC: ${sacCodes.join(', ')}`, width));
  receipt.command(ALIGN_CENTRE);
  for (const text of particulars.footerLines) receipt.lines(wrap(text, width));
  return receipt;
}

/**
 * Opens the cash drawer wired to the receipt printer (BILL-016): a 50 ms pulse on drawer pin 2
 * (`ESC p 0`), the connector almost every drawer uses. Nothing prints and no paper moves; a
 * printer without a drawer ignores it.
 */
export function renderDrawerKick(): Uint8Array {
  return Uint8Array.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
}
