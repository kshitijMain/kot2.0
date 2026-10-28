import { describe, expect, it } from 'vitest';
import { type HealthDish, menuChanges, menuHealth, usualTaxGroupId } from '../src/index.js';

const dish = (over: Partial<HealthDish> & { id: string; name: string }): HealthDish => ({
  categoryId: 'starters',
  basePrice: 28_000,
  sizes: [],
  taxGroupId: 'gst5',
  stationId: 'tandoor',
  photoId: 'photo',
  archived: false,
  ...over,
});

const category = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  parentId,
  archived: false,
});

const input = (dishes: HealthDish[], categories = [category('starters', 'Starters')]) => ({
  dishes,
  categories,
  taxGroupIds: new Set(['gst5', 'gst18']),
  stationIds: new Set(['tandoor', 'main']),
});

describe('[MENU-002] [ONB-004] the menu’s health before publishing', () => {
  it('is publishable when every dish has a price, a station and a tax group', () => {
    const health = menuHealth(input([dish({ id: 'a', name: 'Paneer Tikka' })]));
    expect(health).toEqual({ blocking: [], warnings: [], publishable: true });
  });

  it('blocks on a missing price, station or tax group, and names the dish', () => {
    const health = menuHealth(
      input([
        dish({ id: 'a', name: 'Free Water', basePrice: 0 }),
        dish({
          id: 'b',
          name: 'Dal',
          sizes: [
            { name: 'Half', price: 16_000 },
            { name: 'Full', price: 0 },
          ],
        }),
        dish({ id: 'c', name: 'Naan', stationId: 'archived-station' }),
        dish({ id: 'd', name: 'Lassi', taxGroupId: null }),
      ]),
    );
    expect(health.publishable).toBe(false);
    expect(health.blocking.map((problem) => [problem.kind, problem.name])).toEqual([
      ['NO_PRICE', 'Free Water'],
      ['NO_PRICE', 'Dal'],
      ['NO_STATION', 'Naan'],
      ['NO_TAX_GROUP', 'Lassi'],
    ]);
  });

  it('only warns about missing photos, empty categories and repeated names', () => {
    const health = menuHealth(
      input(
        [
          dish({ id: 'a', name: 'Butter Naan', photoId: null }),
          dish({ id: 'b', name: 'butter  naan' }),
          // An archived dish is off the menu: neither a problem nor a reason a category is full.
          dish({ id: 'c', name: 'Old soup', basePrice: 0, archived: true, categoryId: 'soups' }),
        ],
        [
          category('starters', 'Starters'),
          category('soups', 'Soups'),
          category('mains', 'Mains'),
          category('curries', 'Curries', 'mains'),
        ],
      ),
    );
    expect(health.publishable).toBe(true);
    expect(health.warnings.map((problem) => [problem.kind, problem.name, problem.dishIds])).toEqual(
      [
        ['NO_PHOTO', 'Butter Naan', ['a']],
        ['SAME_NAME', 'Butter Naan', ['a', 'b']],
        ['EMPTY_CATEGORY', 'Soups', []],
        ['EMPTY_CATEGORY', 'Mains', []],
        ['EMPTY_CATEGORY', 'Curries', []],
      ],
    );
  });

  it('counts a category with dishes in its sub-category as not empty', () => {
    const health = menuHealth(
      input(
        [dish({ id: 'a', name: 'Kadai Paneer', categoryId: 'curries' })],
        [category('mains', 'Mains'), category('curries', 'Curries', 'mains')],
      ),
    );
    expect(health.warnings).toEqual([]);
  });

  it('starts a new dish on the tax group most dishes use', () => {
    const dishes = [
      { taxGroupId: 'gst5', archived: false },
      { taxGroupId: 'gst18', archived: false },
      { taxGroupId: 'gst18', archived: false },
      { taxGroupId: 'gst5', archived: true },
    ];
    expect(usualTaxGroupId(dishes, ['gst5', 'gst18'])).toBe('gst18');
    expect(usualTaxGroupId([], ['gst5', 'gst18'])).toBe('gst5');
    expect(usualTaxGroupId([], [])).toBeNull();
  });
});

describe('[MENU-013] what publishing changes', () => {
  const live = (
    id: string,
    name: string,
    extra: Partial<Parameters<typeof menuChanges>[1][number]> = {},
  ) => ({
    id,
    name,
    basePrice: 28_000,
    sizes: [],
    photoId: null,
    ...extra,
  });

  it('lists everything as added before the first publication', () => {
    const changes = menuChanges(null, [live('a', 'Paneer Tikka'), live('b', 'Dal')]);
    expect(changes).toMatchObject({ added: ['Paneer Tikka', 'Dal'], removed: [], none: false });
  });

  it('finds dishes added, taken off, renamed, re-priced and with new photos', () => {
    const changes = menuChanges(
      [
        live('a', 'Paneer Tikka'),
        live('b', 'Dal Makhni', {
          sizes: [
            { name: 'Half', price: 16_000 },
            { name: 'Full', price: 26_000 },
          ],
        }),
        live('c', 'Old Soup'),
        live('d', 'Lassi'),
      ],
      [
        live('a', 'Paneer Tikka', { basePrice: 30_000 }),
        live('b', 'Dal Makhani', {
          sizes: [
            { name: 'Half', price: 16_000 },
            { name: 'Full', price: 28_000 },
          ],
        }),
        live('d', 'Lassi', { photoId: 'new-photo' }),
        live('e', 'Kulfi'),
      ],
    );
    expect(changes.added).toEqual(['Kulfi']);
    expect(changes.removed).toEqual(['Old Soup']);
    expect(changes.renamed).toEqual([{ from: 'Dal Makhni', to: 'Dal Makhani' }]);
    expect(changes.prices.map((change) => [change.name, change.before, change.after])).toEqual([
      ['Paneer Tikka', [{ size: '', price: 28_000 }], [{ size: '', price: 30_000 }]],
      [
        'Dal Makhani',
        [
          { size: 'Half', price: 16_000 },
          { size: 'Full', price: 26_000 },
        ],
        [
          { size: 'Half', price: 16_000 },
          { size: 'Full', price: 28_000 },
        ],
      ],
    ]);
    expect(changes.photos).toEqual(['Lassi']);
    expect(changes.none).toBe(false);
  });

  it('says when nothing the devices show would change', () => {
    expect(menuChanges([live('a', 'Dal')], [live('a', 'Dal')]).none).toBe(true);
  });
});
