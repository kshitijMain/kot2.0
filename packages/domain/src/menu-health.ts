/**
 * The menu's health before it is published (MENU-002, ONB-004 step 7): what would stop a dish
 * being ordered or billed, and what is merely worth a look. A dish without a price, a kitchen
 * station or a tax group blocks publishing; a dish without a photo, an empty category and two
 * dishes with the same name are warnings. Prices are paise (BRD §9.4).
 */

export interface HealthDish {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  /** Paise; with sizes, the sizes' own prices count. */
  readonly basePrice: number;
  readonly sizes: readonly { readonly name: string; readonly price: number }[];
  readonly taxGroupId: string | null;
  readonly stationId: string | null;
  readonly photoId: string | null;
  /** Archived dishes are off the menu and not checked. */
  readonly archived: boolean;
}

export interface HealthCategory {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly archived: boolean;
}

export interface HealthInput {
  readonly dishes: readonly HealthDish[];
  readonly categories: readonly HealthCategory[];
  /** Tax groups and stations a dish may point at: active ones only. */
  readonly taxGroupIds: ReadonlySet<string>;
  readonly stationIds: ReadonlySet<string>;
}

export type HealthProblemKind =
  'NO_PRICE' | 'NO_STATION' | 'NO_TAX_GROUP' | 'NO_PHOTO' | 'EMPTY_CATEGORY' | 'SAME_NAME';

/** Problems that stop the menu being published; the rest are warnings. */
export const BLOCKING_HEALTH_PROBLEMS: ReadonlySet<HealthProblemKind> = new Set([
  'NO_PRICE',
  'NO_STATION',
  'NO_TAX_GROUP',
]);

export interface HealthProblem {
  readonly kind: HealthProblemKind;
  /** The dishes it is about (one, or the dishes sharing a name). */
  readonly dishIds: readonly string[];
  /** The category it is about, for an empty category. */
  readonly categoryId: string | null;
  /** The dish's or the category's name, for the sentence that shows it. */
  readonly name: string;
}

export interface MenuHealth {
  readonly blocking: readonly HealthProblem[];
  readonly warnings: readonly HealthProblem[];
  /** Nothing blocks: the menu may be published (warnings or not). */
  readonly publishable: boolean;
}

const fold = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** The dishes and categories that would not be fine on the devices, in menu order. */
export function menuHealth(input: HealthInput): MenuHealth {
  const dishes = input.dishes.filter((dish) => !dish.archived);
  const problems: HealthProblem[] = [];
  const add = (kind: HealthProblemKind, dish: HealthDish) => {
    problems.push({ kind, dishIds: [dish.id], categoryId: null, name: dish.name });
  };
  for (const dish of dishes) {
    const priced =
      dish.sizes.length === 0 ? dish.basePrice > 0 : dish.sizes.every((size) => size.price > 0);
    if (!priced) add('NO_PRICE', dish);
    if (dish.stationId === null || !input.stationIds.has(dish.stationId)) add('NO_STATION', dish);
    if (dish.taxGroupId === null || !input.taxGroupIds.has(dish.taxGroupId)) {
      add('NO_TAX_GROUP', dish);
    }
    if (dish.photoId === null) add('NO_PHOTO', dish);
  }
  const byName = new Map<string, HealthDish[]>();
  for (const dish of dishes) {
    const key = fold(dish.name);
    byName.set(key, [...(byName.get(key) ?? []), dish]);
  }
  for (const same of byName.values()) {
    const [first] = same;
    if (same.length > 1 && first !== undefined) {
      problems.push({
        kind: 'SAME_NAME',
        dishIds: same.map((dish) => dish.id),
        categoryId: null,
        name: first.name,
      });
    }
  }
  const categories = input.categories.filter((category) => !category.archived);
  for (const category of categories) {
    const hasDish = dishes.some((dish) => dish.categoryId === category.id);
    const hasFullChild = categories.some(
      (child) =>
        child.parentId === category.id && dishes.some((dish) => dish.categoryId === child.id),
    );
    if (!hasDish && !hasFullChild) {
      problems.push({
        kind: 'EMPTY_CATEGORY',
        dishIds: [],
        categoryId: category.id,
        name: category.name,
      });
    }
  }
  const blocking = problems.filter((problem) => BLOCKING_HEALTH_PROBLEMS.has(problem.kind));
  const warnings = problems.filter((problem) => !BLOCKING_HEALTH_PROBLEMS.has(problem.kind));
  return { blocking, warnings, publishable: blocking.length === 0 };
}

/**
 * The tax group a new dish starts with, so the manager need not choose one: the group most dishes
 * use, or the only active group, or the first. Null when there is none (set taxes up first).
 */
export function usualTaxGroupId(
  dishes: readonly Pick<HealthDish, 'taxGroupId' | 'archived'>[],
  activeTaxGroupIds: readonly string[],
): string | null {
  const active = new Set(activeTaxGroupIds);
  const uses = new Map<string, number>();
  for (const dish of dishes) {
    if (dish.archived || dish.taxGroupId === null || !active.has(dish.taxGroupId)) continue;
    uses.set(dish.taxGroupId, (uses.get(dish.taxGroupId) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = 0;
  for (const id of activeTaxGroupIds) {
    const count = uses.get(id) ?? 0;
    if (count > most) {
      best = id;
      most = count;
    }
  }
  return best ?? activeTaxGroupIds[0] ?? null;
}
