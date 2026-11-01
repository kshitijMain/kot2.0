import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ApiError, type LoginResponse, ROUTES, type RouteDefinition } from '@rp/contracts';
import {
  type FuzzPath,
  type Mutation,
  mutationsOf,
  sampleOf,
  UNKNOWN_ID,
} from '@rp/contracts/testing';
import { ONBOARDING_STEPS } from '@rp/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  addDevice,
  addStaff,
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
} from '../helpers/auth-kit.js';
import { seatAndOrder, serveTable, setUpSmallRestaurant } from '../helpers/small-restaurant.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * QA audit, category A: every endpoint of the route registry is called with hostile input, as
 * the Owner on the PC (the widest rights) or as a device the endpoint serves. Each answer must be
 * a clean 4xx `ApiError` (or a success, where the contract accepts the value): never a 500, a
 * stack trace, a hang, or a refusal that still wrote orders, bills or payments. Generated from
 * the registry, so a new endpoint is fuzzed as soon as it is registered.
 *
 * Bodies and queries come from `@rp/contracts/testing`: a plausible sample, then for each field
 * the field missing, wrong types, empty and huge strings, control characters, scripts, negative,
 * decimal and out-of-range numbers, odd dates, ten thousand array elements and unknown fields.
 * Variations the contract accepts are all sent (they reach the services and the database); of
 * those it refuses, a spread of eight per endpoint is sent to check the refusal itself.
 */

type Route = RouteDefinition;
const ROUTE_LIST: readonly Route[] = ROUTES;
const key = (route: Route) => `${route.method} ${route.path}`;

/** Bodies the generator cannot make valid on its own (patterns and rules across fields). */
const SAMPLES: Readonly<Record<string, unknown>> = {
  'POST /api/v1/backups/restore': {
    location: 'DATA_DRIVE',
    fileName: 'rp-backup-20261027T010000Z-manual.rpbk',
    reason: 'QA',
  },
  'POST /api/v1/devices/pair': {
    code: 'ABCD-EFGH',
    algorithm: 'Ed25519',
    publicKey: 'QA',
    proof: 'QA',
    appVersion: '1.0.0',
  },
  'PUT /api/v1/restaurant/profile': {
    displayName: 'QA Dhaba',
    contact: { phone: '9876543210', email: 'qa@example.com' },
    businessHours: [{ day: 'MON', start: '11:00', end: '23:00' }],
    accentColor: '#B4232A',
    businessDayCutoff: '04:00',
    reason: 'QA',
  },
  'PUT /api/v1/restaurant/legal': {
    legalName: 'QA Foods',
    address: { line1: 'MG Road', city: 'Mumbai', pincode: '400001' },
    stateCode: '27',
    gstin: '27AAPFU0939F1ZV',
    fssaiNumber: '12345678901234',
    reason: 'QA',
  },
  'POST /api/v1/licence/reactivate': { code: 'ABCD-EFGH-JKMN-PQRS' },
  'POST /api/v1/diner-contacts/erase': { phone: '9876543210', reason: 'QA' },
  'POST /api/v1/recommendation-rules': {
    when: { kind: 'ITEM', itemId: '$item' },
    suggest: { kind: 'ITEM', itemId: '$item2' },
    priority: 1,
    channels: ['POS'],
    timeWindow: { start: '11:00', end: '15:00' },
    label: 'QA',
    active: true,
  },
  'PUT /api/v1/recommendation-rules/:ruleId': {
    when: { kind: 'ITEM', itemId: '$item' },
    suggest: { kind: 'ITEM', itemId: '$item2' },
    priority: 1,
    channels: ['POS'],
    timeWindow: { start: '11:00', end: '15:00' },
    label: 'QA',
    active: true,
  },
  'POST /api/v1/printers': {
    name: 'QA printer',
    connection: 'NETWORK',
    host: '127.0.0.1',
    port: 9,
    paperWidthMm: 80,
  },
  'PUT /api/v1/printers/:id': {
    name: 'QA printer',
    connection: 'NETWORK',
    host: '127.0.0.1',
    port: 9,
    paperWidthMm: 80,
  },
  'POST /api/v1/bills': { tableSessionId: '$session' },
  'POST /api/v1/bills/:id/discounts': { kind: 'PERCENT', rateBp: 500, reason: 'QA' },
  'POST /api/v1/shifts/:id/close': { countedCash: 1000 },
};

/**
 * Endpoints that end the caller's session or change the whole PC: called last, in this order,
 * so the rest of the sweep runs with the Owner signed in on an open business day.
 */
const LAST = [
  'POST /api/v1/auth/pin-login',
  'POST /api/v1/auth/override',
  'POST /api/v1/day-end',
  'POST /api/v1/archives',
  'POST /api/v1/backups/restore',
  'POST /api/v1/system/data-deletion',
  'POST /api/v1/system/update/approve',
  'POST /api/v1/auth/logout',
];

/** A fresh idempotency key for every request, so retries never just replay a stored answer. */
const FRESH = '$fresh';

const REFUSED_PER_ROUTE = 8;
const PARAM_VALUES: readonly (readonly [string, string])[] = [
  ['unknown id', UNKNOWN_ID],
  ['not an id', 'not-an-id'],
  ['quote', "1' OR '1'='1"],
  ['3,000 characters', 'x'.repeat(3_000)],
  ['encoded NUL', '%00'],
  ['encoded traversal', '..%2F..%2Fetc%2Fpasswd'],
  ['Hindi', encodeURIComponent('पनीर')],
];

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let owner: LoginResponse;
const devices: Record<string, string> = {};
/** Real values for path parameters and id fields, by name. */
const pool: Record<string, string> = {};
const problems: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  const manager = await signIn(app, kit, 'MANAGER');
  const waiter = await signIn(app, kit, 'WAITER');
  const cashier = await signIn(app, kit, 'BILLER');
  const restaurant = await setUpSmallRestaurant(app, kit, manager);
  const open = await seatAndOrder(app, kit, waiter, restaurant.tables.T1!, [
    [restaurant.items.Dal, 2],
    [restaurant.items.Naan, 4],
  ]);
  const invoice = await serveTable(app, kit, { waiter, cashier }, restaurant.tables.T2!, [
    [restaurant.items.Lassi, 1],
  ]);
  devices.POS = kit.deviceId;
  devices.KDS = await addDevice(app, kit, 'KDS');
  devices.WAITER_PHONE = await addDevice(app, kit, 'WAITER_PHONE');
  devices.MANAGER_BROWSER = await addDevice(app, kit, 'MANAGER_BROWSER');
  devices.TABLE_TABLET = await addDevice(app, kit, 'TABLE_TABLET', {
    tableId: restaurant.tables.T4!,
  });
  const spareDevice = await addDevice(app, kit, 'WAITER_PHONE');
  const spareStaff = await addStaff(app, kit, 'WAITER', '7531');
  const base = { restaurantId: kit.restaurantId };
  const customRole = await prisma.role.create({
    data: { ...base, key: 'QA_ROLE', name: 'QA role', baseRole: 'WAITER' },
  });
  const item = await prisma.item.findUniqueOrThrow({ where: { id: restaurant.items.Dal } });
  const kot = await prisma.kot.findFirstOrThrow({ where: { orderId: open.orderId } });
  const orderItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: open.orderId } });
  const bill = await prisma.bill.findFirstOrThrow({ where: base });
  const series = await prisma.invoiceSeries.findFirstOrThrow({ where: base });
  const section = await prisma.section.findFirstOrThrow({ where: { ...base, name: 'Hall' } });
  Object.assign(pool, {
    orderId: open.orderId,
    sessionId: open.sessionId,
    tableSessionId: open.sessionId,
    kotId: kot.id,
    orderItemId: orderItem.id,
    invoiceId: invoice.id,
    billId: bill.id,
    staffId: spareStaff,
    roleId: customRole.id,
    deviceId: spareDevice,
    taxGroupId: item.taxGroupId,
    seriesId: series.id,
    sectionId: section.id,
    tableId: restaurant.tables.T3!,
    itemId: restaurant.items.Dal,
    menuItemId: restaurant.items.Dal,
    categoryId: item.categoryId,
    stationId: item.stationId,
    step: ONBOARDING_STEPS[0],
    key: 'devices.lowBatteryAlertPercent',
    width: '320',
    businessDate: new Date().toISOString().slice(0, 10),
    token: 'a'.repeat(43),
    $item: restaurant.items.Dal,
    $item2: restaurant.items.Naan,
    $session: open.sessionId,
  });
  owner = await signIn(app, kit, 'OWNER');
}, 120_000);

afterAll(async () => {
  await app.close();
  await database.drop();
});

/** The real record a generic `:id` stands for, from the path before it. */
const ID_BY_SEGMENT: Readonly<Record<string, string>> = {
  categories: 'categoryId',
  items: 'itemId',
  stations: 'stationId',
  kots: 'kotId',
  bills: 'billId',
  invoices: 'invoiceId',
};

function paramValue(route: Route, name: string): string {
  if (name === 'id') {
    const segment = /\/([a-z-]+)\/:id\b/.exec(route.path)?.[1] ?? '';
    const poolKey = ID_BY_SEGMENT[segment];
    return poolKey === undefined ? UNKNOWN_ID : (pool[poolKey] ?? UNKNOWN_ID);
  }
  return pool[name] ?? UNKNOWN_ID;
}

const paramNames = (route: Route) =>
  [...route.path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]!);

function pathWith(route: Route, override?: { name: string; value: string }): string {
  return route.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, name: string) =>
    override?.name === name ? override.value : encodeURIComponent(paramValue(route, name)),
  );
}

/** Real ids for id fields in bodies and queries, by the field's name. */
function valueFor(path: FuzzPath, schema: { format?: string }): unknown {
  const field = path.at(-1) ?? '';
  if (field === 'idempotencyKey' || field === 'clientLineId') return FRESH;
  if (schema.format !== 'uuid') return undefined;
  return pool[field];
}

/** Replaces the `$name` placeholders of hand-written samples and gives each request fresh keys. */
function materialise(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value).replace(/"\$([a-zA-Z0-9]+)"/g, (_whole, name: string) =>
    name === 'fresh' ? JSON.stringify(randomUUID()) : JSON.stringify(pool[`$${name}`] ?? name),
  );
  return JSON.parse(json) as unknown;
}

function callerHeaders(route: Route): Record<string, string> {
  if (route.capability === 'PUBLIC') return authHeaders(devices.POS!);
  if (route.capability === 'DEVICE') {
    const allowed = route.devices ?? [];
    const type = allowed.includes('POS') ? 'POS' : (allowed[0] ?? 'POS');
    return authHeaders(devices[type]!);
  }
  return authHeaders(devices.POS!, owner.accessToken);
}

/** Rows whose count must not change when a request is refused (no partial writes). */
async function writeCounts(): Promise<string> {
  const where = { restaurantId: kit.restaurantId };
  const counts = await Promise.all([
    prisma.order.count({ where }),
    prisma.orderItem.count({ where }),
    prisma.kot.count({ where }),
    prisma.bill.count({ where }),
    prisma.invoice.count({ where }),
    prisma.payment.count({ where }),
    prisma.tableSession.count({ where }),
    prisma.discount.count({ where }),
    prisma.cashMovement.count({ where }),
  ]);
  return counts.join(',');
}

/** Signs of internals in an error body: stack frames, source paths, library and engine names. */
const LEAK =
  /\n\s+at |node_modules|PrismaClient|prisma\.|invalid input syntax|\.ts:\d+|TypeError|ReferenceError/i;

interface Attempt {
  readonly route: Route;
  readonly label: string;
  readonly path: string;
  readonly query?: unknown;
  readonly body?: unknown;
  /** Whether the contract accepts this input (then a success is fine). */
  readonly contractAccepts: boolean;
}

async function send(attempt: Attempt): Promise<void> {
  const { route } = attempt;
  const agent = request(httpServer(app));
  const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  let pending = agent[method](attempt.path).set(callerHeaders(route)).timeout(15_000);
  if (attempt.query !== undefined) pending = pending.query(materialise(attempt.query) as object);
  const before = await writeCounts();
  let response: request.Response;
  try {
    response =
      attempt.body === undefined
        ? await pending
        : await pending.send(materialise(attempt.body) as object);
  } catch (error) {
    problems.push(`${key(route)} [${attempt.label}]: no answer (${String(error).slice(0, 80)})`);
    return;
  }
  const where = `${key(route)} [${attempt.label}]`;
  const parsed = ApiError.safeParse(response.body);
  const code = parsed.success ? parsed.data.code : '(no ApiError)';
  if (response.status >= 500 && !(response.status === 503 && code !== 'INTERNAL_ERROR')) {
    problems.push(`${where}: ${String(response.status)} ${code}`);
    return;
  }
  if (response.status >= 400 && !parsed.success) {
    problems.push(`${where}: ${String(response.status)} without an ApiError body`);
  }
  if (response.status >= 400 && LEAK.test(JSON.stringify(response.body ?? ''))) {
    problems.push(
      `${where}: the error leaks internals: ${JSON.stringify(response.body).slice(0, 120)}`,
    );
  }
  if (!attempt.contractAccepts && response.status < 400) {
    problems.push(`${where}: ${String(response.status)} for input its contract refuses`);
  }
  if (response.status >= 400 && (await writeCounts()) !== before) {
    problems.push(`${where}: refused with ${String(response.status)} ${code} but wrote records`);
  }
  if (
    response.status === 401 &&
    route.capability !== 'PUBLIC' &&
    route.capability !== 'DEVICE' &&
    !LAST.includes(key(route))
  ) {
    // The Owner's session ended (a fuzzed call signed them out): sign in again and go on.
    owner = await signIn(app, kit, 'OWNER');
  }
}

/** Hostile variations of a body or query schema, with whether the contract accepts each. */
function variations(
  schema: NonNullable<Route['request']>['body'],
  sample: unknown,
): { accepted: Mutation[]; refused: Mutation[] } {
  const accepted: Mutation[] = [];
  const refused: Mutation[] = [];
  if (schema === undefined) return { accepted, refused };
  for (const mutation of mutationsOf(sample)) {
    (schema.safeParse(materialise(mutation.value)).success ? accepted : refused).push(mutation);
  }
  const step = Math.max(1, Math.ceil(refused.length / REFUSED_PER_ROUTE));
  return { accepted, refused: refused.filter((_, index) => index % step === 0) };
}

function attemptsFor(route: Route): Attempt[] {
  const attempts: Attempt[] = [];
  const path = pathWith(route);
  const body = route.request?.body;
  const query = route.request?.query;
  const bodySample =
    body === undefined ? undefined : (SAMPLES[key(route)] ?? sampleOf(body, { valueFor }));
  const querySample = query === undefined ? undefined : sampleOf(query, { valueFor });
  attempts.push({
    route,
    label: 'sample',
    path,
    query: querySample,
    body: bodySample,
    contractAccepts: true,
  });
  for (const name of paramNames(route)) {
    for (const [label, value] of PARAM_VALUES) {
      attempts.push({
        route,
        label: `:${name} = ${label}`,
        path: pathWith(route, { name, value }),
        query: querySample,
        body: bodySample,
        contractAccepts: true,
      });
    }
  }
  if (body !== undefined) {
    const { accepted, refused } = variations(body, bodySample);
    for (const mutation of [...accepted, ...refused]) {
      attempts.push({
        route,
        label: `body ${mutation.label}`,
        path,
        query: querySample,
        body: mutation.value,
        contractAccepts: accepted.includes(mutation),
      });
    }
  }
  if (query !== undefined) {
    const { accepted, refused } = variations(query, querySample);
    for (const mutation of [...accepted, ...refused]) {
      attempts.push({
        route,
        label: `query ${mutation.label}`,
        path,
        query: mutation.value,
        body: bodySample,
        // A query string has no types: null, [] and {} arrive as nothing, which may be valid. Only
        // a clean answer is required.
        contractAccepts: true,
      });
    }
  }
  return attempts;
}

/** Bodies that are not JSON, sent raw: malformed, wrong content type. */
async function sendRaw(route: Route, label: string, type: string, raw: string): Promise<void> {
  const method = route.method.toLowerCase() as 'post' | 'put' | 'patch';
  const response = await request(httpServer(app))
    [method](pathWith(route))
    .set(callerHeaders(route))
    .set('content-type', type)
    .timeout(15_000)
    .send(raw);
  const parsed = ApiError.safeParse(response.body);
  if (response.status >= 500 || (response.status >= 400 && !parsed.success)) {
    problems.push(
      `${key(route)} [${label}]: ${String(response.status)} ${parsed.success ? parsed.data.code : '(no ApiError)'}`,
    );
  }
}

describe('[SEC-004] [NFR-A03] hostile input on every endpoint gets a clean answer (QA category A)', () => {
  it('never answers 500, leaks internals, hangs, or writes when it refuses', async () => {
    const ordered = [
      ...ROUTE_LIST.filter((route) => !LAST.includes(key(route))),
      ...LAST.map((name) => ROUTE_LIST.find((route) => key(route) === name)).filter(
        (route): route is Route => route !== undefined,
      ),
    ];
    expect(ordered.length).toBe(ROUTE_LIST.length);
    let calls = 0;
    for (const route of ordered) {
      for (const attempt of attemptsFor(route)) {
        await send(attempt);
        calls += 1;
      }
      if (route.request?.body !== undefined) {
        await sendRaw(route, 'malformed JSON', 'application/json', '{"lines": [1, 2,');
        await sendRaw(route, 'text body', 'text/plain', 'hello');
        await sendRaw(route, 'form body', 'application/x-www-form-urlencoded', 'a=1&a=2&b[c]=3');
        calls += 3;
      }
    }
    expect(calls).toBeGreaterThan(2_000);
    expect(problems).toEqual([]);
  }, 1_800_000);
});
