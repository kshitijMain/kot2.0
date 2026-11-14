import type { INestApplication } from '@nestjs/common';
import { BillView, InvoicePreviewResponse, InvoiceView, type LoginResponse } from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvoicesService } from '../../src/billing/invoices.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { billTextLines } from '../../src/printing/escpos.js';
import { qrBillInvoiceOf } from '../../src/relay/table-bill.js';
import { SettingsService } from '../../src/settings/settings.service.js';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import {
  seatAndOrder,
  setUpSmallRestaurant,
  type SmallRestaurant,
} from '../helpers/small-restaurant.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * The bill's particulars and footer (ADR-0031, item F): every bill ends "Thank you for dining at
 * {restaurant}!" unless the Owner changes it, the place of supply prints as "27-Maharashtra" from
 * the restaurant's state, and the Owner chooses whether the phone and FSSAI number print. The
 * invoice settings page previews a bill from what is being typed, before anything is saved.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let owner: LoginResponse;
let manager: LoginResponse;
let waiter: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  owner = await signIn(app, kit, 'OWNER');
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
  await prisma.restaurant.update({
    where: { id: kit.restaurantId },
    data: {
      legalName: 'Auth Dhaba Foods LLP',
      stateCode: '27',
      gstin: '27AAPFU0939F1ZV',
      fssaiNumber: '11521999000123',
      phone: '+919876543210',
      address: { line1: '1 Demo Road', city: 'Pune', pincode: '411001' },
    },
  });
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const as = (who: LoginResponse) => authHeaders(kit.deviceId, who.accessToken);

async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { restaurantId_key: { restaurantId: kit.restaurantId, key } },
    create: { restaurantId: kit.restaurantId, key, value: value as never },
    update: { value: value as never },
  });
  app.get(SettingsService).invalidate();
}

async function printedBill(table: string): Promise<InvoiceView> {
  const { sessionId } = await seatAndOrder(app, kit, waiter, table, [[restaurant.items.Dal, 1]]);
  const bill = BillView.parse(
    (await api(app).post('/api/v1/bills').set(as(manager)).send({ tableSessionId: sessionId }))
      .body,
  );
  const issued = await api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(manager)).send({});
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  return InvoiceView.parse(issued.body);
}

describe('[BILL-002] the bill’s particulars and footer (ADR-0031)', () => {
  it('ends every bill with the thank-you line and prints the place of supply with its state', async () => {
    const invoice = await printedBill(restaurant.tables.T1 ?? '');
    expect(invoice.particulars.placeOfSupply).toBe('27-Maharashtra');
    expect(invoice.particulars.footerLines.at(-1)).toBe('Thank you for dining at Auth Dhaba!');
    const lines = billTextLines(invoice, 'Asia/Kolkata');
    expect(lines).toContain('Place of supply: 27-Maharashtra');
    expect(lines.at(-1)?.trim()).toBe('Thank you for dining at Auth Dhaba!');
    expect(lines.join('\n')).toContain('+919876543210');
    expect(lines.join('\n')).toContain('11521999000123');
    // The digital and QR bill carry it too.
    expect(qrBillInvoiceOf(invoice).footerLines.at(-1)).toBe('Thank you for dining at Auth Dhaba!');
  });

  it('prints an older invoice’s bare state code with its name too', async () => {
    const invoice = await printedBill(restaurant.tables.T2 ?? '');
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { particulars: { ...invoice.particulars, placeOfSupply: '27' } },
    });
    const again = await app.get(InvoicesService).view(kit.restaurantId, invoice.id);
    expect(billTextLines(again, 'Asia/Kolkata')).toContain('Place of supply: 27-Maharashtra');
  });

  it('leaves out what the Owner chose not to print', async () => {
    await setSetting('bills.thankYouLine', 'Come again soon, {restaurant}');
    await setSetting('bills.printPhone', false);
    await setSetting('bills.printFssai', false);
    const invoice = await printedBill(restaurant.tables.T3 ?? '');
    const text = billTextLines(invoice, 'Asia/Kolkata').join('\n');
    expect(text).toContain('Come again soon, Auth Dhaba');
    expect(text).not.toContain('+919876543210');
    expect(text).not.toContain('11521999000123');
    await setSetting('bills.thankYouLine', '');
    const plain = await printedBill(restaurant.tables.T4 ?? '');
    expect(plain.particulars.footerLines).toEqual([]);
  });

  it('previews a bill from the settings being typed, without saving them', async () => {
    const draft = {
      displayName: 'Parosaa',
      legalName: 'Parosaa Hospitality',
      address: { line1: '2 MG Road', city: 'Bengaluru', pincode: '560001' },
      phone: '+918000000000',
      stateCode: '29',
      gstin: '29AAGCB7383J1Z4',
      fssaiNumber: null,
      headerLines: ['Pure veg'],
      footerLines: ['Open 11 to 11'],
      thankYouLine: 'Thank you for dining at {restaurant}!',
      printPhone: true,
      printFssai: true,
      amountInWords: true,
      invoiceNumber: 'PRS/26-27/000001',
    };
    const preview = await api(app)
      .post('/api/v1/restaurant/invoice-preview')
      .set(as(manager))
      .send(draft);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const { lines } = InvoicePreviewResponse.parse(preview.body);
    const text = lines.join('\n');
    expect(text).toContain('Parosaa Hospitality');
    expect(text).toContain('GSTIN: 29AAGCB7383J1Z4');
    expect(text).toContain('Place of supply: 29-Karnataka');
    expect(text).toContain('Pure veg');
    expect(text).toContain('PRS/26-27/000001');
    expect(lines.at(-1)?.trim()).toBe('Thank you for dining at Parosaa!');
    // Nothing was saved.
    const row = await prisma.restaurant.findUniqueOrThrow({ where: { id: kit.restaurantId } });
    expect(row.legalName).toBe('Auth Dhaba Foods LLP');
    expect(
      (await api(app).post('/api/v1/restaurant/invoice-preview').set(as(waiter)).send(draft))
        .status,
    ).toBe(403);
    expect(owner.staff.role).toBe('OWNER');
  });
});
