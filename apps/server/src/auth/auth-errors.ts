import { AppError } from '../errors/app-error.js';

/**
 * Errors of authentication and authorisation, in plain language that says what to do next
 * (NFR-U04). Credential failures never say which part was wrong.
 */
export const authErrors = {
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'),
  tokenExpired: () =>
    new AppError(401, 'TOKEN_EXPIRED', 'Your sign-in needs renewing. The app will do this now.'),
  tokenInvalid: () => new AppError(401, 'TOKEN_INVALID', 'Please sign in again.'),
  sessionExpired: () =>
    new AppError(
      401,
      'SESSION_EXPIRED',
      'You were signed out after a period of inactivity. Sign in again.',
    ),
  sessionRevoked: () =>
    new AppError(401, 'SESSION_REVOKED', 'You have been signed out. Sign in again.'),
  deviceNotRecognised: () =>
    new AppError(
      401,
      'DEVICE_NOT_RECOGNISED',
      'This device is not paired with the restaurant. Ask a manager to pair it.',
    ),
  deviceMismatch: () =>
    new AppError(
      401,
      'DEVICE_MISMATCH',
      'This sign-in belongs to another device. Sign in again here.',
    ),
  /**
   * A wrong PIN or password; with the tries left before the login locks, or before this device
   * stops taking any (`device`), whichever comes first.
   */
  invalidCredentials: (attemptsRemaining?: number, device = false) =>
    new AppError(
      401,
      'INVALID_CREDENTIALS',
      attemptsRemaining === undefined
        ? 'Wrong PIN. Try again.'
        : `Wrong PIN. ${String(attemptsRemaining)} ${attemptsRemaining === 1 ? 'try' : 'tries'} left before ${device ? 'this device stops taking PINs for a while' : 'you are locked out'}.`,
      attemptsRemaining === undefined ? undefined : { attemptsRemaining },
    ),
  locked: (lockedUntil: Date) =>
    new AppError(
      423,
      'ACCOUNT_LOCKED',
      'Locked after too many wrong PINs. Wait, or ask a manager to unlock you.',
      { lockedUntil: lockedUntil.toISOString() },
    ),
  /** PC-S5: too many wrong PINs or passwords on this device, for anyone. */
  deviceLocked: (lockedUntil: Date) =>
    new AppError(
      423,
      'DEVICE_LOCKED',
      'This device takes no PINs for now: too many wrong ones were typed on it. Wait, or ask a manager to let it take PINs again on the Devices page.',
      { lockedUntil: lockedUntil.toISOString() },
    ),
  rateLimited: () =>
    new AppError(
      429,
      'RATE_LIMITED',
      'Too many attempts from this device. Wait a minute and try again.',
    ),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'You do not have permission to do this.'),
  deviceNotAllowed: () =>
    new AppError(403, 'DEVICE_NOT_ALLOWED', 'This kind of device cannot do this.'),
  ownerOnly: () => new AppError(403, 'OWNER_ONLY', 'Only the Owner can do this.'),
  overrideRequired: (capability: string) =>
    new AppError(
      403,
      'OVERRIDE_REQUIRED',
      'A manager must approve this. Ask a manager to enter their PIN.',
      { capability },
    ),
  overrideInvalid: () =>
    new AppError(
      403,
      'OVERRIDE_INVALID',
      'The manager approval has expired or was already used. Ask the manager to approve again.',
    ),
  overrideNotNeeded: () =>
    new AppError(
      409,
      'OVERRIDE_NOT_NEEDED',
      'You can do this yourself; no manager approval is needed.',
    ),
  /** PC-T2: an approval for this action names the record it is for. */
  overrideRecordRequired: (entityType: string) =>
    new AppError(
      422,
      'OVERRIDE_RECORD_REQUIRED',
      'Say which record the manager approves: an approval is for one record only.',
      { entityType },
    ),
  approverNotAllowed: () =>
    new AppError(403, 'APPROVER_NOT_ALLOWED', 'Only a manager or the Owner can approve this.'),
  notOnThisDevice: () =>
    new AppError(
      403,
      'ROLE_NOT_ON_DEVICE',
      'This phone is for waiters. Sign in on the POS or the manager dashboard instead.',
    ),
  kitchenStationMode: () =>
    new AppError(
      403,
      'KITCHEN_STATION_MODE',
      'Kitchen screens work in station mode, so kitchen staff do not sign in individually.',
    ),
};
