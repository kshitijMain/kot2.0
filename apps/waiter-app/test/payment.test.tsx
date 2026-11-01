import { login } from '@rp/mobile-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { mayTakePayment } from '../src/PaymentSheet';
import { Restaurant, signedInApp } from './restaurant';

const BILL = '0199a0e0-0000-7000-8000-00000000f001';
const INVOICE = '0199a0e0-0000-7000-8000-00000000f002';

/** A table with its bill printed, and a server that knows its invoice (P9-16). */
function printedTable(role: 'MANAGER' | 'WAITER') {
  const restaurant = new Restaurant();
  const table = restaurant.table('T2');
  table.state = 'BILL_PRINTED';
  const due = (paid: number) => ({
    invoiceId: INVOICE,
    invoiceNumber: 'INV/26-27/000042',
    status: paid >= 64_000 ? 'SETTLED' : 'ISSUED',
    grandTotal: 64_000,
    paid,
    remaining: 64_000 - paid,
    payments: [],
    tableClosed: paid >= 64_000,
  });
  const server = restaurant
    .server()
    .on('POST', '/api/v1/auth/pin-login', () => ({ status: 200, body: login(role) }))
    .on('GET', '/api/v1/auth/session', () => {
      const { session, staff } = login(role);
      return { status: 200, body: { session, staff } };
    })
    .on('POST', '/api/v1/bills', () => ({
      status: 200,
      body: {
        id: BILL,
        status: 'INVOICED',
        tableSessionId: table.session?.id ?? null,
        orderId: null,
        tableLabel: 'T2',
        priceMode: 'TAX_EXCLUSIVE',
        lines: [],
        discounts: [],
        serviceCharge: { enabled: false, removed: false, rateBp: 0, amount: 0 },
        subtotal: 60_952,
        discountTotal: 0,
        taxableValueTotal: 60_952,
        taxLines: [],
        taxTotal: 3_048,
        roundOff: 0,
        grandTotal: 64_000,
        customer: { name: null, phone: null, phoneConsent: false, gstin: null },
        invoiceIds: [INVOICE],
        editingInvoiceId: null,
        amountInWords: false,
      },
    }))
    .on('GET', `/api/v1/invoices/${INVOICE}/payments`, () => ({ status: 200, body: due(0) }))
    .on('POST', `/api/v1/invoices/${INVOICE}/payments`, () => ({
      status: 200,
      body: due(64_000),
    }));
  return { restaurant, server };
}

describe('[BILL-008] a manager takes payment at the table on the phone (P9-16)', () => {
  it('settles the printed bill by UPI, the amount filled in', async () => {
    const { restaurant, server } = printedTable('MANAGER');
    await signedInApp(restaurant, server);
    await fireEvent.press(await screen.findByRole('button', { name: /^T2, Bill printed/ }));
    await fireEvent.press(await screen.findByTestId('take-payment'));
    // The total and what is still to pay.
    expect(await screen.findAllByText('₹640.00')).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('record-payment'));
    expect(await screen.findByText('Invoice INV/26-27/000042 is paid')).toBeOnTheScreen();
    await waitFor(() => {
      expect(server.callsTo('POST', `/api/v1/invoices/${INVOICE}/payments`)[0]?.body).toMatchObject(
        {
          payments: [{ mode: 'UPI', amount: 64_000, tendered: null, reference: null }],
        },
      );
    });
  });

  it('is never offered to a waiter, who asks the managers for the bill instead', async () => {
    const { restaurant, server } = printedTable('WAITER');
    await signedInApp(restaurant, server);
    await fireEvent.press(await screen.findByRole('button', { name: /^T2, Bill printed/ }));
    expect(await screen.findByRole('header', { name: 'Table T2' })).toBeOnTheScreen();
    expect(screen.queryByTestId('take-payment')).toBeNull();
    expect(mayTakePayment({ role: 'WAITER' })).toBe(false);
    expect(mayTakePayment({ role: 'MANAGER' })).toBe(true);
    expect(mayTakePayment({ role: 'OWNER' })).toBe(true);
  });
});
