import type { INestApplication } from '@nestjs/common';
import { ApiError, type LoginResponse } from '@rp/contracts';
import { OWNER_ONLY_CAPABILITIES } from '@rp/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
  TEST_PINS,
} from '../helpers/auth-kit.js';
import { MatrixProbeController } from '../helpers/auth-probe.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

let database: TestDatabase;
let app: INestApplication;
let kit: AuthKit;
let owner: LoginResponse;
let manager: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url, controllers: [MatrixProbeController] });
  kit = await createAuthKit(app);
  owner = await signIn(app, kit, 'OWNER');
  manager = await signIn(app, kit, 'MANAGER');
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const server = () => request(httpServer(app));
const as = (session: LoginResponse) => authHeaders(kit.deviceId, session.accessToken);
const codeOf = (response: request.Response) => ApiError.parse(response.body).code;

/**
 * The Owner signs in with their PIN like everyone else and acts with that session alone: there is
 * no Owner password, authenticator or step-up any more (ADR-0024, overriding AUTH-006).
 */
describe('[AUTH-001] [AUTH-012] the Owner by PIN only (ADR-0024)', () => {
  it('does every Owner-only action with the PIN session alone; a manager is refused', async () => {
    for (const capability of OWNER_ONLY_CAPABILITIES) {
      const byOwner = await server().post(`/api/v1/probe-matrix/${capability}`).set(as(owner));
      expect(byOwner.status, capability).toBe(200);
      const byManager = await server().post(`/api/v1/probe-matrix/${capability}`).set(as(manager));
      expect([byManager.status, codeOf(byManager)], capability).toEqual([403, 'FORBIDDEN']);
    }
  });

  it('has no password, authenticator or step-up endpoints any more', async () => {
    for (const [method, path] of [
      ['post', '/api/v1/auth/owner-login'],
      ['post', '/api/v1/auth/step-up'],
      ['post', '/api/v1/auth/owner/totp/enroll'],
      ['post', '/api/v1/auth/owner/totp/confirm'],
      ['get', '/api/v1/auth/owner/security'],
      ['post', '/api/v1/auth/owner/password'],
    ] as const) {
      const response = await server()[method](path).set(as(owner)).send({});
      expect(response.status, path).toBe(404);
    }
  });

  it('says nothing about a second factor when the Owner signs in', async () => {
    const response = await server()
      .post('/api/v1/auth/pin-login')
      .set(authHeaders(kit.deviceId))
      .send({ staffId: kit.staff.OWNER, pin: TEST_PINS.OWNER });
    expect(response.status).toBe(200);
    expect((response.body as LoginResponse).staff.role).toBe('OWNER');
    expect(Object.keys(response.body as object).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'refreshToken',
      'session',
      'staff',
    ]);
  });
});
