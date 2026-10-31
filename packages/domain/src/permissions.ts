/**
 * Role-based permissions from BRD §4.2. The server enforces these on every REST call,
 * socket event and MQTT topic (AUTH-010, SEC-003); clients use them only to decide what to show.
 * There is no cashier role (ADR-0023): managers and the Owner bill, take payments and run the cash
 * drawer from the POS.
 */

export const ROLES = ['OWNER', 'MANAGER', 'WAITER', 'KITCHEN'] as const;
export type Role = (typeof ROLES)[number];

/**
 * - ALLOW: the role may do this.
 * - OWN: only for the person's own tables / own shift.
 * - OVERRIDE: only with a manager's PIN on the same device; both people are audited (AUTH-011).
 * - DENY: never.
 */
export type Grant = 'ALLOW' | 'OWN' | 'OVERRIDE' | 'DENY';

export const CAPABILITIES = [
  'ORDER_CREATE', // Open table, take order, send KOT
  'ORDER_APPROVE_CUSTOMER', // Approve / reject tablet and QR orders
  'ITEM_CANCEL_BEFORE_PREP', // Cancel an item before preparation starts
  'ITEM_VOID_AFTER_PREP', // Void an item after preparation started
  'ITEM_MARK_PREPARING_READY',
  'ITEM_MARK_PICKED_UP',
  'ITEM_MARK_SERVED',
  'STOCK_MANAGE', // Toggle out of stock / set stock count (OI-11: kitchen allowed by default)
  'TABLE_MOVE_MERGE',
  'BILL_REQUEST',
  'BILL_PRINT_AND_PAYMENT',
  'DISCOUNT_WITHIN_LIMIT',
  'DISCOUNT_ABOVE_LIMIT', // Discount above the role limit, or a complimentary item
  'SERVICE_CHARGE_REMOVE',
  'BILL_REPRINT',
  'BILL_EDIT_AFTER_PRINT',
  'INVOICE_VOID',
  'CASH_MOVEMENT_AND_SHIFT_CLOSE',
  'DAY_END_CLOSE',
  'MENU_MANAGE',
  'STAFF_MANAGE',
  'DEVICE_PAIR',
  'OPERATIONS_CONFIGURE', // Notifications, recommendations, printers, stations
  'TAX_AND_INVOICE_SETTINGS',
  'REPORTS_VIEW_EXPORT',
  'AUDIT_VIEW',
  'DATA_ADMIN', // Backup restore, archive and purge, full data export
  'LICENSE_VIEW',
  'LICENSE_MANAGE',
  'UPDATE_INSTALL_NOW',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

type Row = Readonly<Record<Role, Grant>>;

function row(owner: Grant, manager: Grant, waiter: Grant, kitchen: Grant): Row {
  return { OWNER: owner, MANAGER: manager, WAITER: waiter, KITCHEN: kitchen };
}

const A = 'ALLOW';
const P = 'OVERRIDE';
const D = 'DENY';

/**
 * The default permission matrix, transcribed from BRD §4.2 without its cashier column, and with
 * any waiter allowed on any table where §4.2 said "own tables" (ADR-0023). OWN stays a grant a
 * matrix may use, but this one does not.
 */
export const DEFAULT_PERMISSION_MATRIX: Readonly<Record<Capability, Row>> = {
  ORDER_CREATE: row(A, A, A, D),
  ORDER_APPROVE_CUSTOMER: row(A, A, A, D),
  ITEM_CANCEL_BEFORE_PREP: row(A, A, A, D),
  ITEM_VOID_AFTER_PREP: row(A, A, P, D),
  ITEM_MARK_PREPARING_READY: row(A, A, D, A),
  ITEM_MARK_PICKED_UP: row(A, A, A, A),
  ITEM_MARK_SERVED: row(A, A, A, D),
  STOCK_MANAGE: row(A, A, D, A),
  TABLE_MOVE_MERGE: row(A, A, A, D),
  BILL_REQUEST: row(A, A, A, D),
  BILL_PRINT_AND_PAYMENT: row(A, A, D, D),
  DISCOUNT_WITHIN_LIMIT: row(A, A, D, D),
  DISCOUNT_ABOVE_LIMIT: row(A, A, D, D),
  SERVICE_CHARGE_REMOVE: row(A, A, D, D),
  BILL_REPRINT: row(A, A, D, D),
  BILL_EDIT_AFTER_PRINT: row(A, A, D, D),
  INVOICE_VOID: row(A, A, D, D),
  CASH_MOVEMENT_AND_SHIFT_CLOSE: row(A, A, D, D),
  DAY_END_CLOSE: row(A, A, D, D),
  MENU_MANAGE: row(A, A, D, D),
  STAFF_MANAGE: row(A, A, D, D),
  DEVICE_PAIR: row(A, A, D, D),
  OPERATIONS_CONFIGURE: row(A, A, D, D),
  TAX_AND_INVOICE_SETTINGS: row(A, D, D, D),
  REPORTS_VIEW_EXPORT: row(A, A, D, D),
  AUDIT_VIEW: row(A, A, D, D),
  DATA_ADMIN: row(A, D, D, D),
  LICENSE_VIEW: row(A, A, D, D),
  LICENSE_MANAGE: row(A, D, D, D),
  UPDATE_INSTALL_NOW: row(A, A, D, D),
};

/**
 * Capabilities that additionally need the Owner's password + TOTP second factor (AUTH-006).
 * "Creating or removing managers" is enforced inside STAFF_MANAGE by the server.
 */
export const OWNER_SECOND_FACTOR_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'DATA_ADMIN',
  'LICENSE_MANAGE',
  'TAX_AND_INVOICE_SETTINGS',
]);

/** Roles whose PIN can approve an OVERRIDE action (AUTH-011). */
export const OVERRIDE_APPROVER_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'MANAGER']);

/**
 * The kind of record each approvable action is about (AUTH-011, PC-T2): a manager's approval names
 * its record when it is given and is good for that record only, so approving a ₹200 void cannot
 * void a ₹2,000 dish. Every capability any role needs an approval for has one.
 */
export const OVERRIDE_RECORD_TYPES: Readonly<Partial<Record<Capability, string>>> = {
  ITEM_VOID_AFTER_PREP: 'order_item',
  DISCOUNT_ABOVE_LIMIT: 'bill',
  BILL_EDIT_AFTER_PRINT: 'invoice',
  INVOICE_VOID: 'invoice',
};

/**
 * Built-in roles a custom role can build on (AUTH-012). The Owner and managers already have every
 * grantable capability, so a custom role starts from a waiter or kitchen role.
 */
export const CUSTOM_ROLE_BASES = ['WAITER', 'KITCHEN'] as const;
export type CustomRoleBase = (typeof CUSTOM_ROLE_BASES)[number];

/**
 * Capabilities a custom role may add on top of its base role (AUTH-012): anything a manager may
 * do, except managing staff (whose rules follow the built-in roles) and the Owner-only actions.
 */
export const CUSTOM_ROLE_GRANTABLE: readonly Capability[] = CAPABILITIES.filter(
  (capability) =>
    DEFAULT_PERMISSION_MATRIX[capability].MANAGER === 'ALLOW' &&
    capability !== 'STAFF_MANAGE' &&
    !OWNER_SECOND_FACTOR_CAPABILITIES.has(capability),
);

const GRANTABLE = new Set<string>(CUSTOM_ROLE_GRANTABLE);

/** Someone acting: their built-in role and the extra capabilities of their custom role, if any. */
export interface Actor {
  readonly role: Role;
  readonly extraCapabilities?: readonly Capability[];
}

/**
 * The extra capabilities a custom role really adds to `baseRole`: known, grantable, not already
 * allowed by the base role, each once, in catalogue order. Anything else stored is ignored, so a
 * stored list can never grant more than the rules allow.
 */
export function extraCapabilitiesOf(baseRole: Role, stored: readonly string[]): Capability[] {
  const wanted = new Set(stored);
  return CUSTOM_ROLE_GRANTABLE.filter(
    (capability) => wanted.has(capability) && grantFor(baseRole, capability) !== 'ALLOW',
  );
}

/** The grant an actor has: ALLOW when their custom role adds the capability, else their role's. */
export function actorGrant(
  actor: Actor,
  capability: Capability,
  matrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX,
): Grant {
  if (GRANTABLE.has(capability) && actor.extraCapabilities?.includes(capability) === true) {
    return 'ALLOW';
  }
  const grant = grantFor(actor.role, capability, matrix);
  // BILL-005: whoever may discount within the limit gives more with a manager's PIN. With no
  // cashier (ADR-0023) that is a custom role allowed discounts within the limit.
  if (
    capability === 'DISCOUNT_ABOVE_LIMIT' &&
    grant === 'DENY' &&
    actorGrant(actor, 'DISCOUNT_WITHIN_LIMIT', matrix) === 'ALLOW'
  ) {
    return 'OVERRIDE';
  }
  return grant;
}

export interface CustomRoleDraft {
  readonly name: string;
  readonly baseRole: Role;
  readonly capabilities: readonly string[];
}

export type CustomRoleProblem =
  | 'NAME_REQUIRED'
  | 'NAME_TAKEN'
  | 'BASE_ROLE_INVALID'
  | 'CAPABILITY_NOT_GRANTABLE'
  | 'NOTHING_ADDED';

/**
 * Checks a custom role (AUTH-012): a name no other role uses, a waiter or kitchen base,
 * only grantable capabilities, and at least one the base role does not already have.
 */
export function checkCustomRole(
  draft: CustomRoleDraft,
  otherNames: readonly string[],
): CustomRoleProblem[] {
  const problems: CustomRoleProblem[] = [];
  const name = draft.name.trim().toLowerCase();
  if (name === '') problems.push('NAME_REQUIRED');
  else if (otherNames.some((other) => other.trim().toLowerCase() === name)) {
    problems.push('NAME_TAKEN');
  }
  if (!(CUSTOM_ROLE_BASES as readonly string[]).includes(draft.baseRole)) {
    problems.push('BASE_ROLE_INVALID');
    return problems;
  }
  if (draft.capabilities.some((capability) => !GRANTABLE.has(capability))) {
    problems.push('CAPABILITY_NOT_GRANTABLE');
  } else if (extraCapabilitiesOf(draft.baseRole, draft.capabilities).length === 0) {
    problems.push('NOTHING_ADDED');
  }
  return problems;
}

export interface PermissionContext {
  /** Capabilities the actor's custom role adds (AUTH-012). */
  readonly extraCapabilities?: readonly Capability[];
  /** True when the target table / shift belongs to the acting person. */
  readonly isOwn?: boolean;
  /** Role of the manager who entered their PIN for this action, if any. */
  readonly overrideApproverRole?: Role;
}

export type PermissionDecision =
  | { readonly allowed: true; readonly viaOverride: boolean }
  | { readonly allowed: false; readonly reason: 'DENIED' | 'NOT_OWN' | 'NEEDS_OVERRIDE' };

export type PermissionMatrix = Readonly<Record<Capability, Readonly<Record<Role, Grant>>>>;

export function grantFor(
  role: Role,
  capability: Capability,
  matrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX,
): Grant {
  return matrix[capability][role];
}

/**
 * Who may sign in on each kind of device; a device not listed takes every role. A waiter phone is
 * the waiters' (Business Owner, 2026-10-25) and, since the QR pilot, the managers' too, so a
 * manager's phone rings for each diner's order to accept or reject at the table (ADR-0024,
 * 2026-10-31). The Owner works at the POS and the dashboard; a manager's PIN for a void on a
 * waiter's phone is still an approval, not a sign-in (AUTH-011).
 */
export const SIGN_IN_ROLES: Readonly<Partial<Record<string, readonly Role[]>>> = {
  WAITER_PHONE: ['WAITER', 'MANAGER'],
};

/** Whether `role` may sign in on a device of `deviceType` (AUTH-001, AUTH-010). */
export function maySignInOn(deviceType: string, role: Role): boolean {
  const roles = SIGN_IN_ROLES[deviceType];
  return roles === undefined || roles.includes(role);
}

export function canApproveOverride(role: Role): boolean {
  return OVERRIDE_APPROVER_ROLES.has(role);
}

/** Decides whether `role` may perform `capability` in `context` (deny by default, SEC-003). */
export function evaluatePermission(
  role: Role,
  capability: Capability,
  context: PermissionContext = {},
  matrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX,
): PermissionDecision {
  const grant = actorGrant(
    {
      role,
      ...(context.extraCapabilities !== undefined && {
        extraCapabilities: context.extraCapabilities,
      }),
    },
    capability,
    matrix,
  );
  switch (grant) {
    case 'ALLOW':
      return { allowed: true, viaOverride: false };
    case 'OWN':
      return context.isOwn === true
        ? { allowed: true, viaOverride: false }
        : { allowed: false, reason: 'NOT_OWN' };
    case 'OVERRIDE':
      return context.overrideApproverRole !== undefined &&
        canApproveOverride(context.overrideApproverRole)
        ? { allowed: true, viaOverride: true }
        : { allowed: false, reason: 'NEEDS_OVERRIDE' };
    case 'DENY':
      return { allowed: false, reason: 'DENIED' };
  }
}
