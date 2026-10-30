import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PendingAuditService } from '../../src/audit/pending-audit.service.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { MIGRATIONS_DIR, migrate } from '../../src/installation/migrations.js';
import { testAdminUrl } from '../helpers/test-database.js';
import { createTestApp } from '../helpers/test-app.js';
import type { INestApplication } from '@nestjs/common';

/**
 * ADR-0023, Part 1: the migration that removes the cashier role, on a database that still has
 * cashiers. Cashiers become managers and sign in again, custom roles on the cashier move to the
 * waiter base, the built-in Cashier role is archived, settings that named the cashier follow, and
 * every change reaches the audit chain when the server starts.
 */

const MIGRATION = '20261030100000_no_cashier_role';

const admin = new URL(testAdminUrl());
const name = `nocashier_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const url = new URL(admin);
url.pathname = `/${name}`;
let folder = '';
let client: pg.Client;
let app: INestApplication | undefined;

const ids = {
  restaurant: randomUUID(),
  cashierRole: randomUUID(),
  waiterRole: randomUUID(),
  customCashier: randomUUID(),
  neha: randomUUID(),
  kiran: randomUUID(),
  ravi: randomUUID(),
  device: randomUUID(),
};

async function adminQuery(sql: string): Promise<void> {
  const connection = new pg.Client({ connectionString: admin.toString() });
  await connection.connect();
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
}

beforeAll(async () => {
  await adminQuery(`CREATE DATABASE "${name}"`);
  folder = mkdtempSync(join(tmpdir(), 'rp-migrations-'));
  for (const entry of readdirSync(MIGRATIONS_DIR)) {
    if (entry >= MIGRATION) continue;
    cpSync(join(MIGRATIONS_DIR, entry), join(folder, entry), { recursive: true });
  }
  await migrate({ url: url.toString(), directory: folder });
  client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  const { restaurant } = ids;
  await client.query(
    `INSERT INTO restaurants (id, display_name, updated_at) VALUES ($1, 'Old Dhaba', now())`,
    [restaurant],
  );
  await client.query(
    `INSERT INTO roles (id, restaurant_id, key, name, base_role, built_in, capabilities) VALUES
       ($1, $4, 'CASHIER', 'Cashier', 'CASHIER', true, '{}'),
       ($2, $4, 'WAITER', 'Waiter', 'WAITER', true, '{}'),
       ($3, $4, 'custom:1', 'Head cashier', 'CASHIER', false, '{MENU_MANAGE}')`,
    [ids.cashierRole, ids.waiterRole, ids.customCashier, restaurant],
  );
  await client.query(
    `INSERT INTO staff (id, restaurant_id, role_id, display_name) VALUES
       ($1, $4, $5, 'Neha'), ($2, $4, $6, 'Kiran'), ($3, $4, $7, 'Ravi')`,
    [ids.neha, ids.kiran, ids.ravi, restaurant, ids.cashierRole, ids.customCashier, ids.waiterRole],
  );
  await client.query(
    `INSERT INTO devices (id, restaurant_id, type, name) VALUES ($1, $2, 'POS', 'Counter')`,
    [ids.device, restaurant],
  );
  await client.query(
    `INSERT INTO sessions (id, restaurant_id, staff_id, device_id, token_hash, expires_at) VALUES
       ($1, $4, $5, $7, 'a', now() + interval '1 hour'),
       ($2, $4, $6, $7, 'b', now() + interval '1 hour'),
       ($3, $4, $8, $7, 'c', now() + interval '1 hour')`,
    [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      restaurant,
      ids.neha,
      ids.kiran,
      ids.device,
      ids.ravi,
    ],
  );
  await client.query(
    `INSERT INTO settings (id, restaurant_id, key, value) VALUES
       ($1, $3, 'billing.cashierDiscountLimitBp', '1500'),
       ($2, $3, 'notifications.rules',
        '{"BILL_REQUEST":{"recipients":["RESPONSIBLE_WAITER","CASHIER"]},"WATER_REQUEST":{"escalate":false},"PRINTER_OFFLINE":{"recipients":["CASHIER","MANAGERS_ON_DUTY"]}}')`,
    [randomUUID(), randomUUID(), restaurant],
  );
  // The migration itself, with every later one.
  await migrate({ url: url.toString() });
});

afterAll(async () => {
  await app?.close();
  await client.end();
  rmSync(folder, { recursive: true, force: true });
  await adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
});

describe('[AUTH-010] [AUD-001] removing the cashier role (ADR-0023)', () => {
  it('makes every cashier a manager and ends their sessions', async () => {
    const { rows } = await client.query<{ display_name: string; key: string; base_role: string }>(
      `SELECT s.display_name, r.key, r.base_role FROM staff s JOIN roles r ON r.id = s.role_id
       ORDER BY s.display_name`,
    );
    expect(rows).toEqual([
      { display_name: 'Kiran', key: 'custom:1', base_role: 'WAITER' },
      { display_name: 'Neha', key: 'MANAGER', base_role: 'MANAGER' },
      { display_name: 'Ravi', key: 'WAITER', base_role: 'WAITER' },
    ]);
    const sessions = await client.query<{ staff_id: string; revoke_reason: string | null }>(
      'SELECT staff_id, revoke_reason FROM sessions',
    );
    const reasons = new Map(sessions.rows.map((row) => [row.staff_id, row.revoke_reason]));
    expect(reasons.get(ids.neha)).toBe('ROLE_CHANGED');
    expect(reasons.get(ids.kiran)).toBe('ROLE_CHANGED');
    expect(reasons.get(ids.ravi)).toBeNull();
  });

  it('archives the built-in Cashier role and leaves no CASHIER in the role type', async () => {
    const cashier = await client.query<{ archived_at: Date | null }>(
      'SELECT archived_at FROM roles WHERE id = $1',
      [ids.cashierRole],
    );
    expect(cashier.rows[0]?.archived_at).not.toBeNull();
    const labels = await client.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'StaffRole' ORDER BY e.enumsortorder`,
    );
    expect(labels.rows.map((row) => row.enumlabel)).toEqual([
      'OWNER',
      'MANAGER',
      'WAITER',
      'KITCHEN',
    ]);
  });

  it('renames the discount limit and sends the cashier’s alerts to the managers on duty', async () => {
    const { rows } = await client.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM settings ORDER BY key',
    );
    expect(rows).toEqual([
      { key: 'billing.discountLimitBp', value: 1500 },
      {
        key: 'notifications.rules',
        value: {
          // The table's waiter is every waiter on duty since the next migration (Part 3).
          BILL_REQUEST: { recipients: ['ALL_WAITERS', 'MANAGERS_ON_DUTY'] },
          WATER_REQUEST: { escalate: false },
          PRINTER_OFFLINE: { recipients: ['MANAGERS_ON_DUTY'] },
        },
      },
    ]);
  });

  it('writes an audit entry for each change into the chain when the server starts', async () => {
    app = await createTestApp({ databaseUrl: url.toString() });
    const prisma = app.get(PrismaService);
    // The test app has started: its bootstrap wrote the queue already; running again adds nothing.
    expect(await app.get(PendingAuditService).recordPending()).toBe(0);
    const entries = await prisma.auditLog.findMany({
      where: { restaurantId: ids.restaurant },
      orderBy: { chainSeq: 'asc' },
    });
    expect(entries.map((entry) => [entry.action, entry.entityId])).toEqual(
      expect.arrayContaining([
        ['STAFF_UPDATED', ids.neha],
        ['ROLE_CHANGED', ids.customCashier],
        ['ROLE_ARCHIVED', ids.cashierRole],
      ]),
    );
    const neha = entries.find((entry) => entry.entityId === ids.neha);
    expect(neha).toMatchObject({
      actorId: null,
      before: { role: 'CASHIER' },
      after: { role: 'MANAGER' },
    });
    expect(await prisma.pendingAuditEntry.count({ where: { recordedAt: null } })).toBe(0);
    expect((await app.get(AuditService).verify()).valid).toBe(true);
  });
});
