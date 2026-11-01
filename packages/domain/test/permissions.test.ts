import { describe, expect, it } from 'vitest';
import {
  actorGrant,
  CAPABILITIES,
  canApproveOverride,
  checkCustomRole,
  CUSTOM_ROLE_BASES,
  CUSTOM_ROLE_GRANTABLE,
  DEFAULT_PERMISSION_MATRIX,
  evaluatePermission,
  extraCapabilitiesOf,
  grantFor,
  OVERRIDE_RECORD_TYPES,
  OWNER_ONLY_CAPABILITIES,
  type PermissionMatrix,
  ROLES,
  maySignInOn,
} from '../src/index.js';

describe('[AUTH-010] role permission matrix (BRD §4.2)', () => {
  it('defines a grant for every capability and role', () => {
    expect(Object.keys(DEFAULT_PERMISSION_MATRIX).sort()).toEqual([...CAPABILITIES].sort());
    for (const capability of CAPABILITIES) {
      for (const role of ROLES) {
        expect(['ALLOW', 'OWN', 'OVERRIDE', 'DENY']).toContain(grantFor(role, capability));
      }
    }
  });

  it('matches key rows of the BRD table', () => {
    expect(grantFor('WAITER', 'ORDER_APPROVE_CUSTOMER')).toBe('ALLOW');
    expect(grantFor('KITCHEN', 'ORDER_CREATE')).toBe('DENY');
    expect(grantFor('WAITER', 'ITEM_VOID_AFTER_PREP')).toBe('OVERRIDE');
    expect(grantFor('KITCHEN', 'ITEM_MARK_PREPARING_READY')).toBe('ALLOW');
    expect(grantFor('KITCHEN', 'ITEM_MARK_PICKED_UP')).toBe('ALLOW');
    expect(grantFor('KITCHEN', 'ITEM_MARK_SERVED')).toBe('DENY');
    expect(grantFor('KITCHEN', 'STOCK_MANAGE')).toBe('ALLOW');
    expect(grantFor('WAITER', 'BILL_REQUEST')).toBe('ALLOW');
    expect(grantFor('WAITER', 'BILL_PRINT_AND_PAYMENT')).toBe('DENY');
    expect(grantFor('MANAGER', 'TAX_AND_INVOICE_SETTINGS')).toBe('DENY');
    expect(grantFor('OWNER', 'DATA_ADMIN')).toBe('ALLOW');
    expect(grantFor('MANAGER', 'DATA_ADMIN')).toBe('DENY');
    expect(grantFor('MANAGER', 'LICENSE_VIEW')).toBe('ALLOW');
    expect(grantFor('MANAGER', 'LICENSE_MANAGE')).toBe('DENY');
  });

  it('[AUTH-010] lets any waiter work any table: no grant is limited to own tables (ADR-0023)', () => {
    for (const capability of [
      'ORDER_CREATE',
      'ORDER_APPROVE_CUSTOMER',
      'ITEM_CANCEL_BEFORE_PREP',
      'TABLE_MOVE_MERGE',
      'BILL_REQUEST',
    ] as const) {
      expect(grantFor('WAITER', capability)).toBe('ALLOW');
    }
    for (const capability of CAPABILITIES) {
      for (const role of ROLES) expect(grantFor(role, capability)).not.toBe('OWN');
    }
    // A void after cooking started still needs a manager's PIN.
    expect(grantFor('WAITER', 'ITEM_VOID_AFTER_PREP')).toBe('OVERRIDE');
  });

  it('[AUTH-010] has no cashier: managers and the Owner bill, take payments and run shifts (ADR-0023)', () => {
    expect(ROLES).toEqual(['OWNER', 'MANAGER', 'WAITER', 'KITCHEN']);
    for (const capability of [
      'BILL_PRINT_AND_PAYMENT',
      'CASH_MOVEMENT_AND_SHIFT_CLOSE',
      'DISCOUNT_WITHIN_LIMIT',
      'BILL_REPRINT',
      'INVOICE_VOID',
      'REPORTS_VIEW_EXPORT',
    ] as const) {
      expect(grantFor('MANAGER', capability)).toBe('ALLOW');
      expect(grantFor('OWNER', capability)).toBe('ALLOW');
      expect(Object.keys(DEFAULT_PERMISSION_MATRIX[capability]).sort()).toEqual([...ROLES].sort());
    }
  });

  it('[AUTH-012] marks the Owner-only capabilities, granted to the Owner alone', () => {
    expect(OWNER_ONLY_CAPABILITIES.has('DATA_ADMIN')).toBe(true);
    expect(OWNER_ONLY_CAPABILITIES.has('MENU_MANAGE')).toBe(false);
    for (const capability of OWNER_ONLY_CAPABILITIES) {
      expect(grantFor('OWNER', capability)).toBe('ALLOW');
      expect(grantFor('MANAGER', capability)).toBe('DENY');
    }
  });
});

describe('[AUTH-011] permission evaluation', () => {
  it('allows, denies and scopes to own tables', () => {
    expect(evaluatePermission('MANAGER', 'MENU_MANAGE')).toEqual({
      allowed: true,
      viaOverride: false,
    });
    expect(evaluatePermission('WAITER', 'MENU_MANAGE')).toEqual({
      allowed: false,
      reason: 'DENIED',
    });
    // OWN still works for a matrix that uses it, though the default one no longer does.
    const ownTables: PermissionMatrix = {
      ...DEFAULT_PERMISSION_MATRIX,
      ORDER_APPROVE_CUSTOMER: {
        ...DEFAULT_PERMISSION_MATRIX.ORDER_APPROVE_CUSTOMER,
        WAITER: 'OWN',
      },
    };
    expect(evaluatePermission('WAITER', 'ORDER_APPROVE_CUSTOMER', {}, ownTables)).toEqual({
      allowed: false,
      reason: 'NOT_OWN',
    });
    expect(
      evaluatePermission('WAITER', 'ORDER_APPROVE_CUSTOMER', { isOwn: true }, ownTables),
    ).toEqual({ allowed: true, viaOverride: false });
  });

  it('requires a manager or owner PIN for override actions', () => {
    expect(evaluatePermission('WAITER', 'ITEM_VOID_AFTER_PREP')).toEqual({
      allowed: false,
      reason: 'NEEDS_OVERRIDE',
    });
    expect(
      evaluatePermission('WAITER', 'ITEM_VOID_AFTER_PREP', { overrideApproverRole: 'WAITER' }),
    ).toEqual({
      allowed: false,
      reason: 'NEEDS_OVERRIDE',
    });
    expect(
      evaluatePermission('WAITER', 'ITEM_VOID_AFTER_PREP', { overrideApproverRole: 'MANAGER' }),
    ).toEqual({
      allowed: true,
      viaOverride: true,
    });
    expect(canApproveOverride('OWNER')).toBe(true);
    expect(canApproveOverride('WAITER')).toBe(false);
  });

  it('[PC-T2] names the kind of record every approvable action is about', () => {
    const approvable = CAPABILITIES.filter((capability) =>
      ROLES.some((role) => grantFor(role, capability) === 'OVERRIDE'),
    );
    // With no cashier (ADR-0023) only a waiter's void needs a PIN by role; a discount above the
    // limit still does for a custom role allowed discounts within it (BILL-005).
    expect(Object.keys(OVERRIDE_RECORD_TYPES)).toEqual(expect.arrayContaining(approvable));
    expect(approvable).toEqual(['ITEM_VOID_AFTER_PREP']);
    expect(OVERRIDE_RECORD_TYPES.DISCOUNT_ABOVE_LIMIT).toBe('bill');
    expect(OVERRIDE_RECORD_TYPES.ITEM_VOID_AFTER_PREP).toBe('order_item');
    expect(OVERRIDE_RECORD_TYPES.INVOICE_VOID).toBe('invoice');
  });
});

describe('[AUTH-012] custom roles', () => {
  it('may add what a manager does, never managing staff or the Owner-only actions', () => {
    expect(CUSTOM_ROLE_GRANTABLE).toContain('REPORTS_VIEW_EXPORT');
    expect(CUSTOM_ROLE_GRANTABLE).toContain('DISCOUNT_ABOVE_LIMIT');
    expect(CUSTOM_ROLE_GRANTABLE).toContain('MENU_MANAGE');
    for (const never of [
      'STAFF_MANAGE',
      'TAX_AND_INVOICE_SETTINGS',
      'DATA_ADMIN',
      'LICENSE_MANAGE',
    ]) {
      expect(CUSTOM_ROLE_GRANTABLE).not.toContain(never);
    }
  });

  it('adds grants on top of the base role, and nothing else', () => {
    const captain = {
      role: 'WAITER' as const,
      extraCapabilities: ['REPORTS_VIEW_EXPORT' as const, 'DISCOUNT_WITHIN_LIMIT' as const],
    };
    expect(actorGrant(captain, 'REPORTS_VIEW_EXPORT')).toBe('ALLOW');
    expect(actorGrant(captain, 'DISCOUNT_WITHIN_LIMIT')).toBe('ALLOW');
    expect(actorGrant(captain, 'BILL_PRINT_AND_PAYMENT')).toBe('DENY');
    // [BILL-005] More than the limit with a manager's PIN, as the cashier had it (ADR-0023).
    expect(actorGrant(captain, 'DISCOUNT_ABOVE_LIMIT')).toBe('OVERRIDE');
    expect(actorGrant({ role: 'WAITER' }, 'DISCOUNT_ABOVE_LIMIT')).toBe('DENY');
    expect(actorGrant({ role: 'WAITER' }, 'REPORTS_VIEW_EXPORT')).toBe('DENY');
    // A stored capability that may not be granted is ignored.
    expect(
      actorGrant({ role: 'WAITER', extraCapabilities: ['STAFF_MANAGE'] }, 'STAFF_MANAGE'),
    ).toBe('DENY');
    expect(
      evaluatePermission('WAITER', 'ITEM_VOID_AFTER_PREP', {
        extraCapabilities: ['ITEM_VOID_AFTER_PREP'],
      }),
    ).toEqual({ allowed: true, viaOverride: false });
    expect(evaluatePermission('WAITER', 'ITEM_VOID_AFTER_PREP')).toEqual({
      allowed: false,
      reason: 'NEEDS_OVERRIDE',
    });
  });

  it('keeps only what really adds to the base role', () => {
    expect(
      extraCapabilitiesOf('WAITER', [
        'REPORTS_VIEW_EXPORT',
        'ORDER_CREATE',
        'STAFF_MANAGE',
        'NOT_A_CAPABILITY',
        'REPORTS_VIEW_EXPORT',
        'ORDER_APPROVE_CUSTOMER',
        'DISCOUNT_WITHIN_LIMIT',
      ]),
      // A waiter approves diners' orders already (ADR-0023): nothing added there.
    ).toEqual(['DISCOUNT_WITHIN_LIMIT', 'REPORTS_VIEW_EXPORT']);
  });

  it('checks the name, base role and capabilities', () => {
    const draft = {
      name: 'Senior captain',
      baseRole: 'WAITER' as const,
      capabilities: ['DISCOUNT_WITHIN_LIMIT'],
    };
    expect(checkCustomRole(draft, ['Manager', 'Head chef'])).toEqual([]);
    expect(checkCustomRole({ ...draft, name: ' senior CAPTAIN ' }, ['Senior captain'])).toEqual([
      'NAME_TAKEN',
    ]);
    expect(checkCustomRole({ ...draft, name: ' ' }, [])).toEqual(['NAME_REQUIRED']);
    expect(checkCustomRole({ ...draft, baseRole: 'MANAGER' }, [])).toEqual(['BASE_ROLE_INVALID']);
    // There is no cashier role to build on any more (ADR-0023).
    expect(CUSTOM_ROLE_BASES).toEqual(['WAITER', 'KITCHEN']);
    expect(checkCustomRole({ ...draft, baseRole: 'CASHIER' as unknown as 'WAITER' }, [])).toEqual([
      'BASE_ROLE_INVALID',
    ]);
    expect(checkCustomRole({ ...draft, capabilities: ['DATA_ADMIN'] }, [])).toEqual([
      'CAPABILITY_NOT_GRANTABLE',
    ]);
    expect(checkCustomRole({ ...draft, capabilities: ['ORDER_CREATE'] }, [])).toEqual([
      'NOTHING_ADDED',
    ]);
  });
});

describe('[AUTH-001] [AUTH-010] who signs in on which device', () => {
  it('keeps a waiter phone for waiters (2026-10-25), and every other device for everyone', () => {
    expect(maySignInOn('WAITER_PHONE', 'WAITER')).toBe(true);
    for (const role of ['OWNER', 'MANAGER', 'KITCHEN'] as const) {
      expect(maySignInOn('WAITER_PHONE', role)).toBe(false);
      expect(maySignInOn('POS', role)).toBe(true);
    }
    expect(maySignInOn('MANAGER_BROWSER', 'MANAGER')).toBe(true);
  });
});
