import { CAPABILITIES } from '@rp/domain';
import { z } from 'zod';
import { Id, Role, Timestamp } from './common.js';

/** A capability from the BRD §4.2 matrix (`@rp/domain` permissions). */
export const Capability = z.enum(CAPABILITIES);

/**
 * Header carrying a single-use manager override token (AUTH-011) on the request that performs the
 * overridden action.
 */
export const OVERRIDE_TOKEN_HEADER = 'x-override-token';

/**
 * How many whole seconds ago the person last touched the app (AUTH-005, MOBILE-E3). An app sends
 * it on every call; the server counts the person active as of then, not as of the call, so reads
 * the app makes by itself do not keep an idle session alive. Without it a call counts as activity.
 */
export const IDLE_HEADER = 'x-rp-idle-seconds';

/** Numeric PIN, 4 digits by default, 6 when the owner requires it (AUTH-001). */
export const Pin = z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits');

/** A name/photo tile on the shared-device login screen (AUTH-001). No PIN hints. */
export const StaffTile = z.object({
  staffId: Id,
  displayName: z.string().min(1),
  role: Role,
  photoId: Id.nullable(),
});
export type StaffTile = z.infer<typeof StaffTile>;

export const StaffTilesResponse = z.object({ staff: z.array(StaffTile) });
export type StaffTilesResponse = z.infer<typeof StaffTilesResponse>;

export const PinLoginRequest = z.strictObject({ staffId: Id, pin: Pin });
export type PinLoginRequest = z.infer<typeof PinLoginRequest>;

export const RefreshRequest = z.strictObject({ refreshToken: z.string().min(20).max(200) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/**
 * Tokens for a signed-in person on this device (AUTH-005). The access token is short-lived and
 * sent as `Authorization: Bearer`; the refresh token is kept by the app and rotated on every use.
 */
export const LoginResponse = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: Timestamp,
  refreshToken: z.string().min(1),
  session: z.object({
    id: Id,
    /** Latest possible end of the session, whatever the activity. */
    expiresAt: Timestamp,
    /** The session ends after this many seconds without activity. */
    inactivityTimeoutSeconds: z.int().positive(),
  }),
  staff: z.object({
    id: Id,
    displayName: z.string(),
    role: Role,
    /** What the person's custom role adds to `role` (AUTH-012); screens use it to show more. */
    capabilities: z.array(Capability).optional(),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

/**
 * The signed-in person and their session on this device, without tokens. Apps check it after a
 * restart, and calling it counts as activity (AUTH-005).
 */
export const CurrentSessionResponse = LoginResponse.pick({
  session: true,
  staff: true,
});
export type CurrentSessionResponse = z.infer<typeof CurrentSessionResponse>;

/** A manager approves one action on the requester's device with their PIN (AUTH-011). */
export const OverrideRequest = z.strictObject({
  approverStaffId: Id,
  pin: Pin,
  capability: Capability,
  /** The record the action is about, when there is one (e.g. the order item to void). */
  entityType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/)
    .optional(),
  entityId: Id.optional(),
});
export type OverrideRequest = z.infer<typeof OverrideRequest>;

export const OverrideResponse = z.object({
  /** Send in the `x-override-token` header of the action; valid once, for a short time. */
  overrideToken: z.string().min(1),
  expiresAt: Timestamp,
  approver: z.object({ id: Id, displayName: z.string(), role: Role }),
});
export type OverrideResponse = z.infer<typeof OverrideResponse>;

export const UnlockStaffRequest = z.strictObject({ staffId: Id });
export type UnlockStaffRequest = z.infer<typeof UnlockStaffRequest>;
