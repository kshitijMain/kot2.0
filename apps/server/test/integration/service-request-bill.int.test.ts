import type { INestApplication } from '@nestjs/common';
import { BillView, type LoginResponse, ServiceRequestView } from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  addDevice,
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
} from '../helpers/auth-kit.js';
import {
  seatAndOrder,
  setUpSmallRestaurant,
  type SmallRestaurant,
} from '../helpers/small-restaurant.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';
import { until } from '../helpers/wait.js';

/**
 * A diner's "Bill" request ends once the bill is printed (P9-23), as a waiter's does: it had stayed
 * open, and its alert on every manager's list, after the bill was out (found on the Mannat pilot).
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let waiter: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

describe('[BILL-015] [WTR-005] a diner asks for the bill', () => {
  it('is dealt with, alert and all, when the bill is printed', async () => {
    const tableId = restaurant.tables.T1 ?? '';
    const { sessionId } = await seatAndOrder(app, kit, waiter, tableId, [
      [restaurant.items.Dal, 1],
    ]);
    const tablet = await addDevice(app, kit, 'TABLE_TABLET', { tableId });
    const asked = await api(app)
      .post('/api/v1/devices/current/service-requests')
      .set(authHeaders(tablet))
      .send({ type: 'BILL' });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    const request = ServiceRequestView.parse(asked.body);
    const { alertId } = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(alertId).not.toBeNull();

    const as = authHeaders(kit.deviceId, manager.accessToken);
    const bill = BillView.parse(
      (await api(app).post('/api/v1/bills').set(as).send({ tableSessionId: sessionId })).body,
    );
    const printed = await api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as).send({});
    expect(printed.status, JSON.stringify(printed.body)).toBe(201);

    const done = await until(
      async () => {
        const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
        return row.state === 'RESOLVED' ? row : undefined;
      },
      5_000,
      'the bill request to be dealt with',
    );
    expect(done.closedAt).not.toBeNull();
    const alert = await prisma.alert.findUniqueOrThrow({ where: { id: alertId ?? '' } });
    expect(alert.status).toBe('CLEARED');
  });
});
