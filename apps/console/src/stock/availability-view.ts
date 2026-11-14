import type { MenuItem, MenuSnapshot } from '@rp/contracts';
import { unavailableReason } from '@rp/ordering';

/** A dish on the Menu availability screen (ADR-0023). */
export interface AvailabilityRow {
  readonly item: MenuItem;
  readonly categoryName: string;
  /** Not switched off and not counted down to 0 (a combo follows its parts). */
  readonly inStock: boolean;
}

/** Which dishes to show by whether they can be ordered (ADR-0031). */
export const AVAILABILITY_FILTERS = ['ALL', 'AVAILABLE', 'OUT'] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];

/**
 * The dishes on the menu, by category and then as the menu orders them, that match the search
 * (name, short code or other names), the category and the status; archived ones are left out.
 */
export function availabilityRows(
  menu: MenuSnapshot,
  filter: {
    readonly search: string;
    readonly categoryId: string | null;
    readonly status: AvailabilityFilter;
  },
): AvailabilityRow[] {
  const categories = new Map(menu.categories.map((entry, index) => [entry.id, { entry, index }]));
  const words = filter.search.trim().toLowerCase();
  const matches = (item: MenuItem) =>
    words === '' ||
    [item.name, item.shortCode ?? '', ...item.synonyms].some((text) =>
      text.toLowerCase().includes(words),
    );
  return menu.items
    .filter((item) => !item.archived)
    .filter((item) => filter.categoryId === null || item.categoryId === filter.categoryId)
    .filter(matches)
    .sort(
      (a, b) =>
        (categories.get(a.categoryId)?.index ?? 0) - (categories.get(b.categoryId)?.index ?? 0) ||
        a.displayOrder - b.displayOrder ||
        a.name.localeCompare(b.name),
    )
    .map((item) => {
      const reason = unavailableReason(item, { menu });
      return {
        item,
        categoryName: categories.get(item.categoryId)?.entry.name ?? '',
        inStock: reason !== 'SOLD_OUT' && reason !== 'NOT_AVAILABLE',
      };
    })
    .filter((row) => filter.status === 'ALL' || (filter.status === 'AVAILABLE') === row.inStock);
}

/**
 * What switching a dish on asks the server for: available, and a count of 0 stops (it would
 * sell out again at once).
 */
export function backInStock(item: MenuItem): { available: true; stockCount: number | null } {
  return { available: true, stockCount: item.stockCount === 0 ? null : item.stockCount };
}
