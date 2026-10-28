import { describe, expect, it } from 'vitest';
import type { KotTicket } from '../../src/printing/escpos.js';
import { renderKotTicket, toPrintable, wrap } from '../../src/printing/escpos.js';

/**
 * QA audit, category A: text from staff, diners and the menu never controls the printer. A dish
 * name or note holding printer commands (open the cash drawer, cut the paper, reset) is printed as
 * text, and odd scripts never break the slip.
 */

const ESC = '\u001b';
const GS = '\u001d';
const OPEN_DRAWER = `${ESC}p\u0000\u0019ú`;
const CUT = `${GS}V\u0000`;
const RESET = `${ESC}@`;

const ticket = (name: string, instructions: string | null, label = 'T4'): KotTicket => ({
  kind: 'NEW',
  kotNumber: 17,
  orderNumber: 42,
  stationName: 'Kitchen',
  destination: { type: 'TABLE', label },
  waiterName: 'Ravi Kumar',
  source: 'WAITER_APP',
  createdAt: new Date('2026-09-26T07:35:00Z'),
  timeZone: 'Asia/Kolkata',
  reprint: false,
  lines: [
    {
      quantity: 2,
      name,
      variantName: null,
      modifiers: [{ name: `Extra${CUT}`, quantity: 1 }],
      instructions,
      comboName: null,
    },
  ],
});

/** How often a byte sequence occurs in rendered output. */
function count(bytes: Uint8Array, sequence: string): number {
  const text = Buffer.from(bytes).toString('latin1');
  return text.split(sequence).length - 1;
}

describe('[SEC-004] [KDS-010] printer commands hidden in text (QA category A)', () => {
  it('prints them as text: the slip has exactly the commands of a plain one', () => {
    const plain = renderKotTicket(ticket('Paneer Tikka', 'Less spicy'), 80);
    const hostile = renderKotTicket(
      ticket(
        `Paneer${OPEN_DRAWER}Tikka${RESET}`,
        `Less spicy${CUT}${ESC}E\u0001`,
        `T4${GS}!\u0011`,
      ),
      80,
    );
    for (const command of [ESC, GS, '\u0000']) {
      expect(count(hostile, command)).toBe(count(plain, command));
    }
    expect(count(hostile, `${ESC}p`)).toBe(0);
  });

  it('never lets a control character through', () => {
    for (let code = 0; code < 0x20; code += 1) {
      expect(toPrintable(`a${String.fromCharCode(code)}b`)).toMatch(/^a[ ?]b$/);
    }
    expect(toPrintable('a\u007fb\u0085c d')).toBe('a?b?c?d');
  });

  it('keeps long words, Hindi, emoji and right-to-left text within the paper width', () => {
    for (const text of [
      'x'.repeat(500),
      'पनीर बटर मसाला आधा प्लेट बिना प्याज़',
      '🍛🔥'.repeat(40),
      'שלום ‮txt.exe',
    ]) {
      for (const line of wrap(text, 32)) {
        expect(line.length).toBeLessThanOrEqual(32);
        expect(line).toMatch(/^[\x20-\x7e]*$/);
      }
    }
  });

  it('prints a phone keyboard’s quotes and dashes as plain ones, not as "?" (QA-019)', () => {
    expect(toPrintable('Don’t add ‘onion’ – “no garlic”… thanks sir — ok')).toBe(
      "Don't add 'onion' - \"no garlic\"... thanks sir - ok",
    );
  });
});
