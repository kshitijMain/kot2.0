/**
 * What publishing the draft changes on the devices (MENU-013): dishes added, taken off, renamed,
 * with new prices, or with a new photo, against the version they have now. Prices are paise.
 */

export interface ChangeDish {
  readonly id: string;
  readonly name: string;
  readonly basePrice: number;
  readonly sizes: readonly { readonly name: string; readonly price: number }[];
  readonly photoId: string | null;
}

export interface PriceChange {
  readonly id: string;
  readonly name: string;
  /** "Full ₹380" style prices, before and after, as paise per size ('' for a dish without sizes). */
  readonly before: readonly { readonly size: string; readonly price: number }[];
  readonly after: readonly { readonly size: string; readonly price: number }[];
}

export interface MenuChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  readonly prices: readonly PriceChange[];
  /** Dishes whose photo was added, replaced or removed. */
  readonly photos: readonly string[];
  /** Nothing the devices show would change (other details may still differ). */
  readonly none: boolean;
}

const pricesOf = (dish: ChangeDish) =>
  dish.sizes.length === 0
    ? [{ size: '', price: dish.basePrice }]
    : dish.sizes.map((size) => ({ size: size.name, price: size.price }));

const samePrices = (a: ChangeDish, b: ChangeDish) =>
  JSON.stringify(pricesOf(a)) === JSON.stringify(pricesOf(b));

/**
 * The difference between the published menu (null before the first publication) and the draft's
 * active dishes, by dish id, each list in the draft's order.
 */
export function menuChanges(
  published: readonly ChangeDish[] | null,
  draft: readonly ChangeDish[],
): MenuChanges {
  const before = new Map((published ?? []).map((dish) => [dish.id, dish]));
  const now = new Set(draft.map((dish) => dish.id));
  const added: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const prices: PriceChange[] = [];
  const photos: string[] = [];
  for (const dish of draft) {
    const old = before.get(dish.id);
    if (old === undefined) {
      added.push(dish.name);
      continue;
    }
    if (old.name !== dish.name) renamed.push({ from: old.name, to: dish.name });
    if (!samePrices(old, dish)) {
      prices.push({ id: dish.id, name: dish.name, before: pricesOf(old), after: pricesOf(dish) });
    }
    if (old.photoId !== dish.photoId) photos.push(dish.name);
  }
  const removed = (published ?? []).filter((dish) => !now.has(dish.id)).map((dish) => dish.name);
  return {
    added,
    removed,
    renamed,
    prices,
    photos,
    none: added.length + removed.length + renamed.length + prices.length + photos.length === 0,
  };
}
