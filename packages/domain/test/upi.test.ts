import { describe, expect, it } from 'vitest';
import { upiAmount, upiPayLink } from '../src/upi.js';

const payment = {
  upiId: 'mannat@okhdfcbank',
  payeeName: 'Mannat',
  amountPaise: 61_200,
  note: 'Mannat bill INV/26-27/000007',
};

describe('[BILL-008] paying the printed bill by UPI (P9-03, ADR-0024)', () => {
  it('writes integer paise as rupees with two decimals, never through floating point', () => {
    expect(upiAmount(61_200)).toBe('612.00');
    expect(upiAmount(5)).toBe('0.05');
    expect(upiAmount(123_456_789)).toBe('1234567.89');
    expect(() => upiAmount(0)).toThrow(RangeError);
    expect(() => upiAmount(12.5)).toThrow(RangeError);
  });

  it('opens any UPI app with the payee, the amount in rupees, INR and the bill filled in', () => {
    const link = upiPayLink(payment);
    expect(link.startsWith('upi://pay?')).toBe(true);
    const params = new URL(link.replace('upi://pay', 'https://x.invalid/pay')).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      pa: 'mannat@okhdfcbank',
      pn: 'Mannat',
      am: '612.00',
      cu: 'INR',
      tn: 'Mannat bill INV/26-27/000007',
    });
    expect(link).not.toContain('+');
  });

  it('has each app’s own link for phones (iPhones) that do not open upi:// links', () => {
    expect(upiPayLink(payment, 'GPAY')).toMatch(/^gpay:\/\/upi\/pay\?pa=mannat%40okhdfcbank&/);
    expect(upiPayLink(payment, 'PHONEPE')).toMatch(/^phonepe:\/\/pay\?/);
    expect(upiPayLink(payment, 'PAYTM')).toMatch(/^paytmmp:\/\/pay\?/);
  });

  it('keeps notes and references to what UPI apps read, within their lengths', () => {
    const link = upiPayLink({
      ...payment,
      payeeName: 'Mannat & Sons <script>',
      note: 'x'.repeat(200),
      reference: 'INV/26-27/000007&am=1',
    });
    const params = new URL(link.replace('upi://pay', 'https://x.invalid/pay')).searchParams;
    expect(params.get('pn')).toBe('Mannat Sons script');
    expect(params.get('tn')).toHaveLength(80);
    expect(params.get('tr')).toBe('INV/26-27/000007am1');
    expect(params.getAll('am')).toEqual(['612.00']);
  });
});
