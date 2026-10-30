import { DomainError } from './errors.js';
import {
  applyRate,
  assertBasisPoints,
  assertPaise,
  BASIS_POINTS_PER_WHOLE,
  DEFAULT_ROUNDING,
  divideRounded,
  type BasisPoints,
  type Paise,
  type RoundingMode,
} from './money.js';
import { type Actor, actorGrant } from './permissions.js';

/** An item-level or bill-level discount: a percentage or a flat amount (BILL-005). */
export type DiscountValue =
  | { readonly kind: 'PERCENT'; readonly rateBp: BasisPoints }
  | { readonly kind: 'FLAT'; readonly amount: Paise };

/** Discount in paise for a base amount. Never more than the base. */
export function discountAmount(
  base: Paise,
  discount: DiscountValue,
  rounding: RoundingMode = DEFAULT_ROUNDING,
): Paise {
  assertPaise(base, 'discount base');
  if (discount.kind === 'PERCENT') {
    assertBasisPoints(discount.rateBp, 'discount rate', BASIS_POINTS_PER_WHOLE);
    return applyRate(base, discount.rateBp, rounding);
  }
  assertPaise(discount.amount, 'discount amount');
  if (discount.amount > base) {
    throw new DomainError(
      'DISCOUNT_EXCEEDS_AMOUNT',
      'A flat discount cannot exceed the amount it applies to',
      {
        base,
        discount: discount.amount,
      },
    );
  }
  return discount.amount;
}

/**
 * The discount expressed as a percentage of its base, rounded UP so a flat discount can
 * never slip under a role's percentage limit through rounding.
 */
export function effectiveDiscountRateBp(base: Paise, discount: DiscountValue): BasisPoints {
  if (discount.kind === 'PERCENT') return discount.rateBp;
  if (base === 0) return discount.amount === 0 ? 0 : BASIS_POINTS_PER_WHOLE;
  return divideRounded(discountAmount(base, discount) * BASIS_POINTS_PER_WHOLE, base, 'UP');
}

/** BILL-005 ⚙ default: up to 10 % without a manager's PIN, for those limited to it. */
export const DEFAULT_DISCOUNT_LIMIT_BP: BasisPoints = 1000;

export type DiscountDecision = 'ALLOWED' | 'REQUIRES_MANAGER_OVERRIDE' | 'DENIED';

/**
 * Applies the discount rules from §4.2 and BILL-005 to a person and their custom role (AUTH-012):
 * - Owner and Manager, and anyone allowed discounts above the limit, may give any discount,
 *   including complimentary items.
 * - Anyone allowed discounts within the limit (a custom role) may discount up to `limitBp`; above
 *   it, or complimentary, needs a manager PIN.
 * - Everyone else (waiters, kitchen) cannot discount.
 */
export function decideDiscount(
  actor: Actor,
  requestedRateBp: BasisPoints,
  limitBp: BasisPoints = DEFAULT_DISCOUNT_LIMIT_BP,
): DiscountDecision {
  assertBasisPoints(requestedRateBp, 'requested discount', BASIS_POINTS_PER_WHOLE);
  if (actorGrant(actor, 'DISCOUNT_ABOVE_LIMIT') === 'ALLOW') return 'ALLOWED';
  if (actorGrant(actor, 'DISCOUNT_WITHIN_LIMIT') !== 'ALLOW') return 'DENIED';
  const complimentary = requestedRateBp >= BASIS_POINTS_PER_WHOLE;
  return !complimentary && requestedRateBp <= limitBp ? 'ALLOWED' : 'REQUIRES_MANAGER_OVERRIDE';
}
