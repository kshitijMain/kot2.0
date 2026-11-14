import { describe, expect, it } from 'vitest';
import {
  charactersPerLine,
  formatLocal,
  type KotTicket,
  renderDrawerKick,
  renderKotTicket,
  renderNotice,
  renderTestPage,
  toPrintable,
  wrap,
} from '../../src/printing/escpos.js';

/** Shows ESC/POS bytes as text: commands in angle brackets, one printed line per row. */
function readable(bytes: Uint8Array): string {
  const names: Record<string, string> = {
    '1b40': '<INIT>',
    '1b6100': '<LEFT>',
    '1b6101': '<CENTRE>',
    '1b4501': '<BOLD>',
    '1b4500': '</BOLD>',
    '1d2100': '<NORMAL>',
    '1d2111': '<DOUBLE>',
    '1d2101': '<TALL>',
    '1d564203': '<CUT>',
    '1d4201': '<REVERSE>',
    '1d4200': '</REVERSE>',
  };
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    if (byte === 0x1b || byte === 0x1d) {
      const length =
        byte === 0x1d && bytes[index + 1] === 0x56
          ? 4
          : byte === 0x1b && bytes[index + 1] === 0x40
            ? 2
            : 3;
      const hex = Array.from(bytes.slice(index, index + length), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      out += names[hex] ?? `<${hex}>`;
      index += length;
    } else if (byte === 0x0a) {
      out += '\n';
      index += 1;
    } else {
      out += String.fromCharCode(byte);
      index += 1;
    }
  }
  return out;
}

const TICKET: KotTicket = {
  kind: 'NEW',
  kotNumber: 17,
  orderNumber: 42,
  stationName: 'Kitchen',
  destination: { type: 'TABLE', label: 'T4' },
  sentByName: 'Ravi Kumar',
  source: 'WAITER_APP',
  createdAt: new Date('2026-09-26T07:35:00Z'),
  timeZone: 'Asia/Kolkata',
  reprint: false,
  lines: [
    {
      quantity: 2,
      name: 'Paneer Tikka',
      variantName: 'Full',
      modifiers: [
        { name: 'Extra mint chutney', quantity: 1 },
        { name: 'Onion rings', quantity: 2 },
      ],
      instructions: 'Less spicy, well done',
      comboName: null,
    },
    {
      quantity: 1,
      name: 'Dal Makhani',
      variantName: null,
      modifiers: [],
      instructions: null,
      comboName: 'Veg Thali',
    },
  ],
};

describe('ESC/POS rendering', () => {
  it('[KDS-008] fits 48 characters on 80 mm paper and 32 on 58 mm', () => {
    expect(charactersPerLine(80)).toBe(48);
    expect(charactersPerLine(58)).toBe(32);
  });

  it('[KDS-008] reduces text to printable ASCII so every printer prints it', () => {
    expect(toPrintable('Crème brûlée ₹ 50\nnew line')).toBe('Creme brulee ? 50 new line');
  });

  it('[KDS-008] wraps at spaces and splits words longer than a line', () => {
    expect(wrap('Butter chicken with garlic naan', 12)).toEqual([
      'Butter',
      'chicken with',
      'garlic naan',
    ]);
    expect(wrap('Supercalifragilistic', 8)).toEqual(['Supercal', 'ifragili', 'stic']);
    expect(wrap('', 8)).toEqual(['']);
  });

  it('shows times in the restaurant time zone', () => {
    expect(formatLocal(new Date('2026-09-26T07:35:00Z'), 'Asia/Kolkata')).toBe('26-09-2026 13:05');
  });

  it('[ORD-007] [KDS-008] renders a dine-in KOT for 80 mm paper', () => {
    const bytes = renderKotTicket(TICKET, 80);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x03]);
    expect(readable(bytes)).toMatchInlineSnapshot(`
      "<INIT><CENTRE><DOUBLE><BOLD>TABLE T4
      <REVERSE>        KITCHEN         
      </REVERSE><NORMAL></BOLD><LEFT><TALL><BOLD>KOT 17                                     13:05
      <NORMAL></BOLD>Sent by: Ravi Kumar
      Order 42
      ------------------------------------------------
      <TALL><BOLD>2 x Paneer Tikka (Full)
      <NORMAL></BOLD>    + Extra mint chutney
          + Onion rings x2
          ! Less spicy, well done
      <TALL><BOLD>1 x Dal Makhani
      <NORMAL></BOLD>    (part of Veg Thali)
      ------------------------------------------------
      2 lines, 3 items                      26-09-2026
      <CUT>"
    `);
  });

  it('[ORD-011] [KDS-008] marks changed, cancelled and reprinted tickets, on 58 mm paper', () => {
    const text = readable(
      renderKotTicket(
        {
          ...TICKET,
          kind: 'MODIFIED',
          reprint: true,
          destination: { type: 'TAKEAWAY', token: 12 },
          sentByName: null,
          source: 'POS',
          lines: [{ ...TICKET.lines[1]!, quantity: -1, comboName: null }],
        },
        58,
      ),
    );
    expect(text).toMatchInlineSnapshot(`
      "<INIT><CENTRE><DOUBLE><BOLD>TAKEAWAY #12
      <REVERSE>    KITCHEN     
      </REVERSE><NORMAL>
      <DOUBLE><REVERSE>    CHANGED     
      </REVERSE><NORMAL>
      <DOUBLE><REVERSE>    REPRINT     
      </REVERSE><NORMAL></BOLD><LEFT><TALL><BOLD>KOT 17                     13:05
      <NORMAL></BOLD>Order 42
      --------------------------------
      <TALL><BOLD>-1 x Dal Makhani
      <NORMAL></BOLD>--------------------------------
      1 line, 1 item        26-09-2026
      <CUT>"
    `);
    // ADR-0031: an inverted banner instead of "** CANCELLED **".
    expect(readable(renderKotTicket({ ...TICKET, kind: 'CANCELLED' }, 80))).toMatch(
      /<REVERSE> +CANCELLED +\n/,
    );
  });

  it('[ORD-007] [KDS-008] reads at a glance: place, station banner, KOT and time, sender (ADR-0031)', () => {
    const ticket: KotTicket = { ...TICKET, covers: 4, tableKotNumber: 2 };
    for (const width of [80, 58] as const) {
      const text = readable(renderKotTicket(ticket, width));
      // The table first and largest, then the station as an inverted banner.
      expect(text.startsWith('<INIT><CENTRE><DOUBLE><BOLD>TABLE T4\n')).toBe(true);
      expect(text).toMatch(/<DOUBLE><BOLD>TABLE T4\n<REVERSE> +KITCHEN +\n<\/REVERSE>/);
      expect(text).toMatch(/<TALL><BOLD>KOT 17 +13:05\n/);
      expect(text).toContain('Sent by: Ravi Kumar\n');
      expect(text).toContain('4 guests');
      expect(text).toContain('2nd KOT for this table');
      // No device or app name: it is not what the kitchen needs.
      expect(text).not.toContain('Waiter app');
    }
  });

  it('[KDS-008] counts lines and items in words that agree with the number (ADR-0031)', () => {
    const one: KotTicket = { ...TICKET, lines: [{ ...TICKET.lines[1]!, comboName: null }] };
    const text = readable(renderKotTicket(one, 80));
    expect(text).toContain('1 line');
    expect(text).toContain('1 item');
    expect(text).not.toContain('1 lines');
    expect(text).not.toContain('1 items');
    expect(readable(renderKotTicket(TICKET, 80))).toContain('2 lines, 3 items');
    // The first KOT of a table says nothing about it; a takeaway has no guests.
    expect(text).not.toContain('KOT for this table');
    expect(
      readable(renderKotTicket({ ...TICKET, destination: { type: 'TAKEAWAY', token: 12 } }, 80)),
    ).not.toContain('guests');
  });

  it('[ORD-016] [KDS-008] marks dishes held for later and tickets that fire them (ADR-0031)', () => {
    const held = readable(
      renderKotTicket(
        { ...TICKET, held: [{ quantity: 1, name: 'Gulab Jamun', variantName: null }] },
        80,
      ),
    );
    expect(held).toContain('ON HOLD - DO NOT COOK YET');
    expect(held).toMatch(/ON HOLD - DO NOT COOK YET\n.*1 x Gulab Jamun/);
    expect(readable(renderKotTicket({ ...TICKET, fired: true }, 80))).toContain(
      'FIRE: HELD DISHES',
    );
  });

  it('[ORD-011] [KDS-008] marks reprints and cancelled slips large and inverted (ADR-0031)', () => {
    const reprint = readable(renderKotTicket({ ...TICKET, reprint: true }, 58));
    expect(reprint).toMatch(/<REVERSE> +REPRINT +\n<\/REVERSE>/);
    const cancelled = readable(renderKotTicket({ ...TICKET, kind: 'CANCELLED' }, 58));
    expect(cancelled).toMatch(/<REVERSE> +CANCELLED +\n<\/REVERSE>/);
    expect(cancelled).toContain('Do not cook');
  });

  it('[KDS-008] never prints a line wider than the paper', () => {
    const long: KotTicket = {
      ...TICKET,
      stationName: 'A station with a very long name that goes on and on',
      sentByName: 'Someone with a remarkably long display name indeed',
      lines: [
        {
          ...TICKET.lines[0]!,
          name: 'An item name that is far too long to fit on a single line of a small printer',
          instructions: 'x'.repeat(100),
        },
      ],
    };
    for (const width of [58, 80] as const) {
      const text = readable(renderKotTicket(long, width)).replace(/<[A-Z/]+>/g, '');
      for (const line of text.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(charactersPerLine(width));
      }
    }
  });

  it('[ONB-004] renders a test page with a ruler across the full width', () => {
    const text = readable(
      renderTestPage({
        restaurantName: 'Spice Route',
        printerName: 'Kitchen printer',
        paperWidthMm: 58,
        at: new Date('2026-09-26T07:35:00Z'),
        timeZone: 'Asia/Kolkata',
      }),
    );
    expect(text).toContain('TEST PAGE');
    expect(text).toContain('Printer: Kitchen printer');
    expect(text).toContain('Paper: 58 mm, 32 characters');
    expect(text).toContain('12345678901234567890123456789012\n');
  });

  it('[TBL-005] renders a note that is not a ticket, e.g. a table move', () => {
    const text = readable(
      renderNotice(
        {
          title: 'MOVED',
          lines: ['From T1 to T3', 'Orders 4, 5'],
          stationName: 'Kitchen',
          createdAt: new Date('2026-09-26T07:35:00Z'),
          timeZone: 'Asia/Kolkata',
        },
        58,
      ),
    );
    expect(text).toContain('<DOUBLE><BOLD>MOVED\n');
    expect(text).toContain('<TALL><BOLD>From T1 to T3\nOrders 4, 5\n');
    expect(text).toContain('26-09-2026 13:05');
    expect(text).not.toContain('KOT');
  });
});

describe('[BILL-016] the cash drawer kick', () => {
  it('pulses drawer pin 2 and prints nothing', () => {
    expect([...renderDrawerKick()]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
});
