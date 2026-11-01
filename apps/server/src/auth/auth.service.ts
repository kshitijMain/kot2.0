import { Injectable } from '@nestjs/common';
import type {
  LoginResponse,
  OverrideRequest,
  OverrideResponse,
  PinLoginRequest,
  StaffTilesResponse,
} from '@rp/contracts';
import {
  actorGrant,
  canApproveOverride,
  type Capability,
  type CountedFailure,
  countFailure,
  decideStaffChange,
  isLockedAt,
  type LockoutPolicy,
  maySignInOn,
  OVERRIDE_RECORD_TYPES,
  type Role,
} from '@rp/domain';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService, type TransactionClient } from '../database/prisma.service.js';
import type { AppError } from '../errors/app-error.js';
import type { CredentialKind } from '../generated/prisma/enums.js';
import { staffErrors } from '../staff/staff-errors.js';
import { authErrors } from './auth-errors.js';
import { type AuthSettings, AuthSettingsService } from './auth-settings.js';
import { CredentialHasher } from './credential-hasher.js';
import type { AuthenticatedDevice } from './device.js';
import type { ConsumedOverride, Principal } from './principal.js';
import { RateLimiter } from './rate-limiter.js';
import { roleCapabilities, SessionService, type SessionStaff } from './session.service.js';
import { SignInLockouts } from './sign-in-lockouts.js';
import { randomToken, sha256Hex } from './tokens.js';

interface CredentialRow {
  readonly id: string;
  readonly secretHash: string;
  readonly failedAttempts: number;
  readonly failureWindowStartedAt: Date | null;
  readonly lockedUntil: Date | null;
}

type Outcome<T> = { readonly ok: T } | { readonly error: AppError };

/**
 * Sign-in and the actions around it (AUTH-001 to AUTH-005, AUTH-011, AUTH-013). The Owner signs
 * in with a PIN like everyone else (ADR-0024). Failed attempts,
 * lockouts, sign-ins and overrides are audited in the same transaction as the state they change;
 * failures are committed before the error is returned, so they always count. A wrong secret counts
 * against the person and against the device it was typed on, so guesses spread over many people
 * still stop (PC-S5); on a table tablet only against the tablet, so a diner cannot lock the
 * managers out (MOBILE-D1). Every lockout alerts the managers and the Owner.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: CredentialHasher,
    private readonly sessions: SessionService,
    private readonly settings: AuthSettingsService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly lockouts: SignInLockouts,
  ) {}

  /**
   * Login tiles: active staff of this device's restaurant who have a PIN and may sign in on this
   * kind of device (AUTH-001; a waiter phone lists waiters only).
   */
  async staffTiles(device: AuthenticatedDevice): Promise<StaffTilesResponse> {
    const staff = await this.prisma.staff.findMany({
      where: {
        restaurantId: device.restaurantId,
        active: true,
        archivedAt: null,
        credentials: { some: { kind: 'PIN' } },
      },
      include: { role: true },
      orderBy: { displayName: 'asc' },
    });
    return {
      staff: staff
        .filter((person) => maySignInOn(device.type, person.role.baseRole))
        .map((person) => ({
          staffId: person.id,
          displayName: person.displayName,
          role: person.role.baseRole,
          photoId: person.photoId,
        })),
    };
  }

  async pinLogin(device: AuthenticatedDevice, request: PinLoginRequest): Promise<LoginResponse> {
    const settings = await this.settings.get(device.restaurantId);
    this.throttle(`login:${device.deviceId}`, settings);
    const now = new Date();

    const outcome = await this.prisma.transaction(
      async (
        tx,
      ): Promise<
        Outcome<{ staff: SessionStaff; session: Awaited<ReturnType<SessionService['create']>> }>
      > => {
        const base = { tx, device, staffId: request.staffId, method: 'PIN' as const };
        const blocked = await this.deviceBlocked(base, now);
        if (blocked !== undefined) return { error: blocked };
        const staff = await this.activeStaff(tx, device.restaurantId, request.staffId);
        const credential = staff === null ? null : await this.lockedCredential(tx, staff.id, 'PIN');
        if (staff === null || credential === null) {
          await this.hasher.verifyNothing(request.pin);
          return { error: await this.failure(base, 'Unknown staff member or no PIN set') };
        }
        if (this.isLocked(credential, now)) {
          return { error: await this.lockedFailure(base, credential.lockedUntil ?? now) };
        }
        if (!(await this.hasher.verify(credential.secretHash, request.pin))) {
          return { error: await this.wrongSecret(base, credential, settings, now, 'Wrong PIN') };
        }
        if (staff.role === 'KITCHEN' && !settings.kitchenIndividualLogins) {
          return { error: authErrors.kitchenStationMode() };
        }
        // The tiles leave them out; the server decides (AUTH-010).
        if (!maySignInOn(device.type, staff.role)) {
          return { error: authErrors.notOnThisDevice() };
        }
        await this.clearFailures(tx, credential.id);
        const session = await this.sessions.create(tx, {
          staffId: staff.id,
          device,
          settings,
          now,
        });
        await this.audit.record(tx, {
          action: 'LOGIN',
          entityType: 'session',
          entityId: session.session.id,
          actorId: staff.id,
          deviceId: device.deviceId,
          restaurantId: device.restaurantId,
          after: { method: 'PIN', role: staff.role },
        });
        return { ok: { staff, session } };
      },
    );
    if ('error' in outcome) throw outcome.error;
    return this.sessions.issue({
      ...outcome.ok.session,
      staff: outcome.ok.staff,
      device,
      settings,
      now,
    });
  }

  async logout(principal: Principal): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await this.sessions.revoke(principal.sessionId, 'LOGOUT', tx);
      // Signing out on a waiter phone also stops it alerting the person (P2-06a).
      await tx.device.updateMany({
        where: { id: principal.deviceId, type: 'WAITER_PHONE', staffId: principal.staffId },
        data: { staffId: null },
      });
      await this.audit.record(tx, {
        action: 'LOGOUT',
        entityType: 'session',
        entityId: principal.sessionId,
        actorId: principal.staffId,
        deviceId: principal.deviceId,
        restaurantId: principal.restaurantId,
      });
    });
  }

  /** A manager lifts a lockout before it expires (AUTH-003). */
  async unlock(principal: Principal, staffId: string): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const staff = await tx.staff.findFirst({
        where: { id: staffId, restaurantId: principal.restaurantId },
        select: { id: true, active: true, role: { select: { baseRole: true } } },
      });
      if (staff === null) throw authErrors.forbidden();
      // A manager opens their own and their team's logins; the Owner's and other managers' locks
      // only the Owner opens (P4-02a).
      const decision = decideStaffChange(
        { staffId: principal.staffId, role: principal.role },
        { staffId: staff.id, role: staff.role.baseRole, active: staff.active },
        { kind: 'UNLOCK' },
      );
      if (!decision.allowed) throw staffErrors.refused(decision.reason);
      const before = await tx.credential.findMany({
        where: { staffId },
        select: { kind: true, lockedUntil: true, failedAttempts: true },
      });
      await tx.credential.updateMany({
        where: { staffId },
        data: { failedAttempts: 0, failureWindowStartedAt: null, lockedUntil: null },
      });
      await this.lockouts.unlocked(tx, {
        kind: 'PERSON',
        restaurantId: principal.restaurantId,
        staffId,
      });
      await this.audit.record(tx, {
        action: 'STAFF_UNLOCKED',
        entityType: 'staff',
        entityId: staffId,
        actorId: principal.staffId,
        deviceId: principal.deviceId,
        restaurantId: principal.restaurantId,
        before: before.map((credential) => ({
          kind: credential.kind,
          lockedUntil: credential.lockedUntil,
          failedAttempts: credential.failedAttempts,
        })),
      });
    });
  }

  /**
   * A manager approves one action of the signed-in requester on this device with their PIN
   * (AUTH-011). Returns a single-use, short-lived token for that capability (and entity).
   */
  async grantOverride(
    principal: Principal,
    device: AuthenticatedDevice,
    request: OverrideRequest,
  ): Promise<OverrideResponse> {
    const grant = actorGrant(
      { role: principal.role, extraCapabilities: principal.capabilities },
      request.capability,
    );
    if (grant === 'DENY') throw authErrors.forbidden();
    if (grant !== 'OVERRIDE') throw authErrors.overrideNotNeeded();
    // The approval names the record it is for, and works on no other (PC-T2).
    const recordType = OVERRIDE_RECORD_TYPES[request.capability];
    if (
      recordType !== undefined &&
      (request.entityType !== recordType || request.entityId === undefined)
    ) {
      throw authErrors.overrideRecordRequired(recordType);
    }
    const settings = await this.settings.get(principal.restaurantId);
    this.throttle(`override:${device.deviceId}`, settings);
    const now = new Date();

    const outcome = await this.prisma.transaction(async (tx): Promise<Outcome<GrantedOverride>> => {
      const base = {
        tx,
        device,
        staffId: request.approverStaffId,
        method: 'OVERRIDE' as const,
        requesterId: principal.staffId,
        capability: request.capability,
      };
      const blocked = await this.deviceBlocked(base, now);
      if (blocked !== undefined) return { error: blocked };
      const approver = await this.activeStaff(tx, principal.restaurantId, request.approverStaffId);
      if (
        approver === null ||
        !canApproveOverride(approver.role) ||
        approver.id === principal.staffId
      ) {
        await this.hasher.verifyNothing(request.pin);
        await this.failure(base, 'Approver is not an active manager or owner');
        return { error: authErrors.approverNotAllowed() };
      }
      const credential = await this.lockedCredential(tx, approver.id, 'PIN');
      if (credential === null) {
        await this.hasher.verifyNothing(request.pin);
        return { error: await this.failure(base, 'Approver has no PIN') };
      }
      if (this.isLocked(credential, now)) {
        return { error: await this.lockedFailure(base, credential.lockedUntil ?? now) };
      }
      if (!(await this.hasher.verify(credential.secretHash, request.pin))) {
        return {
          error: await this.wrongSecret(base, credential, settings, now, 'Wrong approver PIN'),
        };
      }
      await this.clearFailures(tx, credential.id);
      const token = randomToken();
      const expiresAt = new Date(now.getTime() + settings.overrideSeconds * 1000);
      const created = await tx.overrideGrant.create({
        data: {
          restaurantId: principal.restaurantId,
          deviceId: device.deviceId,
          requesterId: principal.staffId,
          requesterSessionId: principal.sessionId,
          approverId: approver.id,
          capability: request.capability,
          entityType: request.entityType ?? null,
          entityId: request.entityId ?? null,
          tokenHash: sha256Hex(token),
          expiresAt,
        },
      });
      await this.audit.record(tx, {
        action: 'OVERRIDE_GRANTED',
        entityType: request.entityType ?? 'override_grant',
        entityId: request.entityId ?? created.id,
        actorId: principal.staffId,
        approverId: approver.id,
        deviceId: device.deviceId,
        restaurantId: principal.restaurantId,
        after: { capability: request.capability, grantId: created.id, expiresAt },
      });
      return { ok: { token, expiresAt, approver } };
    });
    if ('error' in outcome) throw outcome.error;
    const { token, expiresAt, approver } = outcome.ok;
    return {
      overrideToken: token,
      expiresAt: expiresAt.toISOString(),
      approver: { id: approver.id, displayName: approver.displayName, role: approver.role },
    };
  }

  /**
   * A manager lets staff out of a table tablet's kiosk mode with their PIN (TAB-001). Nobody is
   * signed in on a tablet, so the manager is chosen from the tiles; the attempt is throttled per
   * tablet, a wrong PIN counts against the tablet (MOBILE-S3), and the exit is audited.
   */
  async kioskExit(
    device: AuthenticatedDevice,
    staffId: string,
    pin: string,
  ): Promise<{ readonly approver: SessionStaff; readonly exitedAt: Date }> {
    const exitedAt = new Date();
    const approver = await this.pinOnDevice(
      device,
      staffId,
      pin,
      'KIOSK',
      (staff) => canApproveOverride(staff.role),
      async (tx, staff) => {
        await this.audit.record(tx, {
          action: 'TABLET_KIOSK_EXITED',
          entityType: 'device',
          entityId: device.deviceId,
          actorId: staff.id,
          deviceId: device.deviceId,
          restaurantId: device.restaurantId,
          after: { tableId: device.tableId },
        });
      },
    );
    return { approver, exitedAt };
  }

  /**
   * "Approve at table" (ORD-004): the waiter enters their PIN on the tablet. Anyone whose role may
   * approve diners' orders qualifies (waiters for their own tables, which the caller checks); the
   * PIN counts like a sign-in. Returns the person and whether they are limited to their own tables.
   */
  async tableApprover(
    device: AuthenticatedDevice,
    staffId: string,
    pin: string,
  ): Promise<{ readonly staff: SessionStaff; readonly ownOnly: boolean }> {
    const grantOf = (staff: SessionStaff & { readonly role: Role }) =>
      actorGrant(
        { role: staff.role, extraCapabilities: staff.capabilities },
        'ORDER_APPROVE_CUSTOMER',
      );
    let ownOnly = false;
    const staff = await this.pinOnDevice(
      device,
      staffId,
      pin,
      'TABLE_APPROVAL',
      (candidate) => {
        const grant = grantOf(candidate);
        ownOnly = grant === 'OWN';
        return grant === 'ALLOW' || grant === 'OWN';
      },
      () => Promise.resolve(),
    );
    return { staff, ownOnly };
  }

  /**
   * A PIN entered on a device nobody is signed in on (a table tablet): throttled per device, the
   * person must be active and `eligible`, and a wrong PIN counts against the tablet, which stops
   * taking PINs for a while at its limit (MOBILE-S3, MOBILE-D1). `onSuccess` runs in the same
   * transaction (its audit entry).
   */
  private async pinOnDevice(
    device: AuthenticatedDevice,
    staffId: string,
    pin: string,
    method: 'KIOSK' | 'TABLE_APPROVAL',
    eligible: (staff: SessionStaff & { readonly role: Role }) => boolean,
    onSuccess: (tx: TransactionClient, staff: SessionStaff) => Promise<void>,
  ): Promise<SessionStaff> {
    const settings = await this.settings.get(device.restaurantId);
    this.throttle(`${method.toLowerCase()}:${device.deviceId}`, settings);
    const now = new Date();
    const outcome = await this.prisma.transaction(async (tx): Promise<Outcome<SessionStaff>> => {
      const base = { tx, device, staffId, method };
      const blocked = await this.deviceBlocked(base, now);
      if (blocked !== undefined) return { error: blocked };
      const staff = await this.activeStaff(tx, device.restaurantId, staffId);
      if (staff === null || !eligible(staff)) {
        await this.hasher.verifyNothing(pin);
        await this.failure(base, 'Not allowed to do this');
        return { error: authErrors.approverNotAllowed() };
      }
      const credential = await this.lockedCredential(tx, staff.id, 'PIN');
      if (credential === null) {
        await this.hasher.verifyNothing(pin);
        return { error: await this.failure(base, 'No PIN') };
      }
      if (this.isLocked(credential, now)) {
        return { error: await this.lockedFailure(base, credential.lockedUntil ?? now) };
      }
      if (!(await this.hasher.verify(credential.secretHash, pin))) {
        return { error: await this.wrongSecret(base, credential, settings, now, 'Wrong PIN') };
      }
      await this.clearFailures(tx, credential.id);
      await onSuccess(tx, staff);
      return { ok: staff };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.ok;
  }

  /**
   * Uses up an override token for `capability`, if it was issued to this person's session on this
   * device, is unused and has not expired. Single use: a second request with it is refused. An
   * approval for an action about a record (`OVERRIDE_RECORD_TYPES`) is used only on the record it
   * names: on another it is refused and stays unused (PC-T2).
   */
  async consumeOverride(
    principal: Principal,
    capability: Capability,
    token: string,
    record?: { readonly entityType: string; readonly entityId: string },
  ): Promise<ConsumedOverride | null> {
    const recordType = OVERRIDE_RECORD_TYPES[capability];
    if (recordType !== undefined && record?.entityType !== recordType) return null;
    const now = new Date();
    const tokenHash = sha256Hex(token);
    const used = await this.prisma.overrideGrant.updateMany({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
        capability,
        requesterSessionId: principal.sessionId,
        deviceId: principal.deviceId,
        ...(recordType !== undefined &&
          record !== undefined && { entityType: record.entityType, entityId: record.entityId }),
      },
      data: { usedAt: now },
    });
    if (used.count !== 1) return null;
    const grant = await this.prisma.overrideGrant.findUniqueOrThrow({ where: { tokenHash } });
    return { approverId: grant.approverId, entityType: grant.entityType, entityId: grant.entityId };
  }

  private throttle(key: string, settings: AuthSettings): void {
    if (!this.limiter.attempt(key, settings.attemptsPerMinutePerDevice, 60_000)) {
      throw authErrors.rateLimited();
    }
  }

  private async activeStaff(
    tx: TransactionClient,
    restaurantId: string,
    staffId: string,
  ): Promise<(SessionStaff & { readonly role: Role }) | null> {
    const staff = await tx.staff.findFirst({
      where: { id: staffId, restaurantId, active: true, archivedAt: null },
      include: { role: true },
    });
    return staff === null
      ? null
      : {
          id: staff.id,
          displayName: staff.displayName,
          role: staff.role.baseRole,
          capabilities: roleCapabilities(staff.role),
        };
  }

  /** Reads a credential with a row lock, so concurrent attempts count one after another. */
  private async lockedCredential(
    tx: TransactionClient,
    staffId: string,
    kind: CredentialKind,
  ): Promise<CredentialRow | null> {
    await tx.$queryRaw`SELECT 1 AS locked FROM credentials
      WHERE staff_id = ${staffId}::uuid AND kind = ${kind}::"CredentialKind" FOR UPDATE`;
    return tx.credential.findUnique({ where: { staffId_kind: { staffId, kind } } });
  }

  private isLocked(credential: CredentialRow, now: Date): boolean {
    return credential.lockedUntil !== null && credential.lockedUntil > now;
  }

  private async clearFailures(tx: TransactionClient, credentialId: string): Promise<void> {
    await tx.credential.update({
      where: { id: credentialId },
      data: { failedAttempts: 0, failureWindowStartedAt: null, lockedUntil: null },
    });
  }

  /**
   * The device takes no PINs for now (PC-S5): the attempt is refused before anything
   * is checked, and audited.
   */
  private async deviceBlocked(context: FailureContext, now: Date): Promise<AppError | undefined> {
    const row = await context.tx.device.findUnique({
      where: { id: context.device.deviceId },
      select: { pinsLockedUntil: true },
    });
    const until = row?.pinsLockedUntil ?? null;
    if (until === null || !isLockedAt(until, now)) return undefined;
    await this.failure(context, 'This device takes no PINs for now');
    return authErrors.deviceLocked(until);
  }

  /**
   * Counts a wrong PIN (AUTH-003): against the person, locking their login at the
   * limit, and against the device it was typed on, which stops taking any at its own limit
   * (PC-S5). On a table tablet only against the tablet (MOBILE-D1). Each lock is audited and
   * alerts the managers and the Owner.
   */
  private async wrongSecret(
    context: FailureContext,
    credential: CredentialRow,
    settings: AuthSettings,
    now: Date,
    reason: string,
  ): Promise<AppError> {
    const { tx, device } = context;
    const window = {
      windowMinutes: settings.lockoutWindowMinutes,
      lockMinutes: settings.lockoutMinutes,
    };
    const tablet = device.type === 'TABLE_TABLET';
    let person: CountedFailure | undefined;
    if (!tablet) {
      person = countFailure(
        { failures: credential.failedAttempts, windowStartedAt: credential.failureWindowStartedAt },
        now,
        { ...window, maxFailures: settings.lockoutMaxFailures },
      );
      await tx.credential.update({
        where: { id: credential.id },
        data: {
          failedAttempts: person.failures,
          failureWindowStartedAt: person.windowStartedAt,
          ...(person.lockedUntil !== null && { lockedUntil: person.lockedUntil }),
        },
      });
    }
    const deviceMax = tablet
      ? settings.tabletLockoutMaxFailures
      : settings.deviceLockoutMaxFailures;
    const onDevice = await this.countDeviceFailure(
      context,
      { ...window, maxFailures: deviceMax },
      now,
    );
    const personLock = person?.lockedUntil ?? null;
    await this.failure(context, reason, {
      ...(person !== undefined && {
        failures: personLock === null ? person.failures : settings.lockoutMaxFailures,
      }),
      deviceFailures: onDevice.lockedUntil === null ? onDevice.failures : deviceMax,
    });
    if (personLock !== null) {
      await this.audit.record(tx, {
        action: 'LOGIN_LOCKED',
        entityType: 'staff',
        entityId: context.staffId,
        deviceId: device.deviceId,
        restaurantId: device.restaurantId,
        after: { lockedUntil: personLock, method: context.method },
        reason: `${String(settings.lockoutMaxFailures)} failed attempts within ${String(settings.lockoutWindowMinutes)} minutes`,
      });
      const staff = await tx.staff.findUniqueOrThrow({
        where: { id: context.staffId },
        select: { displayName: true },
      });
      await this.lockouts.locked(tx, {
        kind: 'PERSON',
        restaurantId: device.restaurantId,
        staffId: context.staffId,
        staffName: staff.displayName,
        deviceId: device.deviceId,
        deviceName: onDevice.name,
        method: context.method,
        lockedUntil: personLock,
      });
    }
    if (onDevice.lockedUntil !== null) {
      await this.audit.record(tx, {
        action: 'DEVICE_PINS_LOCKED',
        entityType: 'device',
        entityId: device.deviceId,
        deviceId: device.deviceId,
        restaurantId: device.restaurantId,
        after: { pinsLockedUntil: onDevice.lockedUntil, method: context.method },
        reason: `${String(deviceMax)} wrong PINs on this device within ${String(settings.lockoutWindowMinutes)} minutes`,
      });
      await this.lockouts.locked(tx, {
        kind: 'DEVICE',
        restaurantId: device.restaurantId,
        deviceId: device.deviceId,
        deviceName: onDevice.name,
        lockedUntil: onDevice.lockedUntil,
      });
    }
    if (personLock !== null) return authErrors.locked(personLock);
    if (onDevice.lockedUntil !== null) return authErrors.deviceLocked(onDevice.lockedUntil);
    if (person === undefined || onDevice.left < person.left) {
      return authErrors.invalidCredentials(onDevice.left, true);
    }
    return authErrors.invalidCredentials(person.left);
  }

  /** One more wrong secret typed on the device, counted under a row lock (PC-S5). */
  private async countDeviceFailure(
    context: FailureContext,
    policy: LockoutPolicy,
    now: Date,
  ): Promise<CountedFailure & { readonly name: string }> {
    const { tx, device } = context;
    await tx.$queryRaw`SELECT 1 AS locked FROM devices WHERE id = ${device.deviceId}::uuid FOR UPDATE`;
    const row = await tx.device.findUniqueOrThrow({
      where: { id: device.deviceId },
      select: { name: true, pinFailures: true, pinFailureWindowStartedAt: true },
    });
    const counted = countFailure(
      { failures: row.pinFailures, windowStartedAt: row.pinFailureWindowStartedAt },
      now,
      policy,
    );
    await tx.device.update({
      where: { id: device.deviceId },
      data: {
        pinFailures: counted.failures,
        pinFailureWindowStartedAt: counted.windowStartedAt,
        ...(counted.lockedUntil !== null && { pinsLockedUntil: counted.lockedUntil }),
      },
    });
    return { ...counted, name: row.name };
  }

  private async lockedFailure(context: FailureContext, lockedUntil: Date): Promise<AppError> {
    await this.failure(context, 'Login is locked');
    return authErrors.locked(lockedUntil);
  }

  /** Audits a failed attempt (AUTH-013) and returns the generic credential error. */
  private async failure(
    context: FailureContext,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<AppError> {
    const override = context.method === 'OVERRIDE';
    await this.audit.record(context.tx, {
      action: override
        ? 'OVERRIDE_DENIED'
        : context.method === 'KIOSK'
          ? 'TABLET_KIOSK_EXIT_DENIED'
          : context.method === 'TABLE_APPROVAL'
            ? 'TABLE_APPROVAL_DENIED'
            : 'LOGIN_FAILED',
      entityType: 'staff',
      entityId: context.staffId,
      actorId: override ? (context.requesterId ?? null) : null,
      approverId: null,
      deviceId: context.device.deviceId,
      restaurantId: context.device.restaurantId,
      after: {
        method: context.method,
        ...(override && { capability: context.capability }),
        ...extra,
      },
      reason,
    });
    return authErrors.invalidCredentials();
  }
}

interface GrantedOverride {
  readonly token: string;
  readonly expiresAt: Date;
  readonly approver: SessionStaff;
}

interface FailureContext {
  readonly tx: TransactionClient;
  readonly device: AuthenticatedDevice;
  /** The person whose credential was tried (the approver, for overrides). */
  readonly staffId: string;
  readonly method: 'PIN' | 'OVERRIDE' | 'KIOSK' | 'TABLE_APPROVAL';
  readonly requesterId?: string;
  readonly capability?: string;
}
