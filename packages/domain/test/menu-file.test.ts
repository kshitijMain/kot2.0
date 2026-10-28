import { describe, expect, it } from 'vitest';
import {
  MENU_IMPORT_COLUMNS,
  type MenuFileSource,
  menuFileDishes,
  menuFileNames,
  menuFilePhotoName,
  menuFileSheets,
  type MenuImportSheets,
  planMenuImport,
  renameMenuFileNames,
} from '../src/index.js';

const ITEMS_HEADER = MENU_IMPORT_COLUMNS.Items.map((column) => column.name);
const item = (cells: Partial<Record<string, string>>) =>
  ITEMS_HEADER.map((name) => cells[name] ?? '');
const VARIANTS_HEADER = MENU_IMPORT_COLUMNS.Variants.map((column) => column.name);

const SHEETS: MenuImportSheets = {
  Items: [
    ITEMS_HEADER,
    item({
      Category: 'Starters',
      Item: 'Paneer Tikka',
      'Short code': 'PT01',
      Price: '280',
      'Tax group': 'GST 5%',
      'Food type': 'Veg',
      Station: 'Tandoor',
      'Modifier groups': 'Dip, Spice',
    }),
    item({
      Category: 'Main Course',
      'Sub-category': 'Veg',
      Item: 'Dal Makhani',
      'Tax group': 'gst 5%',
      'Food type': 'Veg',
      Station: 'Kitchen',
    }),
    item({
      Category: 'Main Course',
      Item: 'Veg Thali',
      Price: 'abc',
      'Tax group': 'GST 18%',
      'Food type': 'Vegan',
      Station: 'Kitchen',
    }),
  ],
  Variants: [
    VARIANTS_HEADER,
    ['Dal Makhani', 'Half', '160', ''],
    ['Dal Makhani', 'Full', '280.50', ''],
  ],
  Combos: [
    MENU_IMPORT_COLUMNS.Combos.map((column) => column.name),
    ['Veg Thali', 'Item', 'Dal Makhani'],
  ],
};

describe('[ONB-005] the menu file', () => {
  it('lists the tax group and station names the dishes use, each once', () => {
    expect(menuFileNames(SHEETS)).toEqual({
      taxGroups: ['GST 5%', 'GST 18%'],
      stations: ['Tandoor', 'Kitchen'],
    });
  });

  it('renames tax groups and stations to the ones set up on this PC, in any case', () => {
    const renamed = renameMenuFileNames(SHEETS, {
      taxGroups: new Map([['gst 5%', 'GST 5 %']]),
      stations: new Map([['KITCHEN', 'Main kitchen']]),
    });
    expect(menuFileNames(renamed)).toEqual({
      taxGroups: ['GST 5 %', 'GST 18%'],
      stations: ['Tandoor', 'Main kitchen'],
    });
    // Nothing else changes.
    expect(renamed.Variants).toBe(SHEETS.Variants);
    expect(renamed.Items?.[1]?.[ITEMS_HEADER.indexOf('Item')]).toBe('Paneer Tikka');
  });

  it('[MENU-003] lists every dish for the review, with sizes in paise, even with mistakes elsewhere', () => {
    expect(menuFileDishes(SHEETS)).toEqual([
      {
        row: 2,
        name: 'Paneer Tikka',
        shortCode: 'PT01',
        category: 'Starters',
        subCategory: null,
        foodType: 'VEG',
        price: 28_000,
        sizes: [],
        addOnGroups: ['Dip', 'Spice'],
        combo: false,
      },
      {
        row: 3,
        name: 'Dal Makhani',
        shortCode: null,
        category: 'Main Course',
        subCategory: 'Veg',
        foodType: 'VEG',
        price: null,
        sizes: [
          { name: 'Half', price: 16_000 },
          { name: 'Full', price: 28_050 },
        ],
        addOnGroups: [],
        combo: false,
      },
      {
        row: 4,
        name: 'Veg Thali',
        shortCode: null,
        category: 'Main Course',
        subCategory: null,
        foodType: null,
        price: null,
        sizes: [],
        addOnGroups: [],
        combo: true,
      },
    ]);
  });

  it('names photos by short code, else by dish name, safely and without clashes', () => {
    const taken = new Set<string>();
    expect(menuFilePhotoName({ name: 'Paneer Tikka', shortCode: 'PT01' }, 'webp', taken)).toBe(
      'PT01.webp',
    );
    expect(
      menuFilePhotoName({ name: 'Crème brûlée / large', shortCode: null }, 'webp', taken),
    ).toBe('Creme brulee large.webp');
    expect(menuFilePhotoName({ name: 'pt01', shortCode: null }, 'webp', taken)).toBe('pt01 2.webp');
  });
});

const SOURCE: MenuFileSource = {
  categories: [
    { id: 'c-main', name: 'Main Course', parentId: null, displayOrder: 2 },
    { id: 'c-start', name: 'Starters', parentId: null, displayOrder: 1 },
    { id: 'c-veg', name: 'Veg', parentId: 'c-main', displayOrder: 1 },
  ],
  modifierGroups: [
    {
      id: 'g-roti',
      name: 'Roti type',
      minSelections: 1,
      maxSelections: 1,
      options: [
        { name: 'Plain', priceDelta: 0 },
        { name: 'Butter', priceDelta: 1_000 },
      ],
    },
    {
      id: 'g-unused',
      name: 'Extras',
      minSelections: 0,
      maxSelections: 2,
      options: [{ name: 'Onion', priceDelta: -500 }],
    },
  ],
  items: [
    {
      id: 'i-dal',
      categoryId: 'c-veg',
      name: 'Dal Makhani',
      shortCode: 'DM08',
      description: 'Slow-cooked black lentils.',
      basePrice: 28_050,
      taxGroupName: 'GST 5 %',
      foodType: 'VEG',
      spiceLevel: 1,
      tags: ['Bestseller', 'Jain'],
      stationName: 'Kitchen',
      prepTimeMinutes: 20,
      timeWindow: { start: '11:00', end: '23:30' },
      displayOrder: 1,
      channels: ['POS', 'WAITER_APP'],
      variants: [
        { name: 'Half', price: 16_000, externalId: null },
        { name: 'Full', price: 28_050, externalId: 'ZOM-1' },
      ],
      modifierGroupIds: ['g-roti'],
      synonyms: ['dal', 'kali dal'],
      repeatable: true,
      externalId: 'EXT-9',
    },
    {
      id: 'i-tikka',
      categoryId: 'c-start',
      name: 'Paneer Tikka',
      shortCode: null,
      description: null,
      basePrice: 28_000,
      taxGroupName: 'GST 5 %',
      foodType: 'VEG',
      spiceLevel: 0,
      tags: [],
      stationName: 'Tandoor',
      prepTimeMinutes: null,
      timeWindow: null,
      displayOrder: 1,
      channels: ['POS', 'WAITER_APP', 'TABLE_TABLET', 'QR'],
      variants: [],
      modifierGroupIds: [],
      synonyms: [],
      repeatable: false,
      externalId: null,
    },
    {
      id: 'i-thali',
      categoryId: 'c-veg',
      name: 'Veg Thali',
      shortCode: 'VT40',
      description: null,
      basePrice: 34_900,
      taxGroupName: 'GST 5 %',
      foodType: 'VEG',
      spiceLevel: 0,
      tags: [],
      stationName: 'Kitchen',
      prepTimeMinutes: null,
      timeWindow: null,
      displayOrder: 2,
      channels: ['POS', 'WAITER_APP', 'TABLE_TABLET', 'QR'],
      variants: [],
      modifierGroupIds: [],
      synonyms: [],
      repeatable: false,
      externalId: null,
    },
  ],
  combos: [
    {
      itemId: 'i-thali',
      components: [
        { kind: 'FIXED', itemId: 'i-dal', label: null, itemIds: [], quantity: 1 },
        {
          kind: 'CHOICE',
          itemId: null,
          label: 'Any starter',
          itemIds: ['i-tikka', 'i-dal'],
          quantity: 2,
        },
      ],
      activeFrom: '2026-11-01',
      activeUntil: null,
      timeWindow: { start: '12:00', end: '15:00' },
    },
  ],
};

describe('[ONB-005] exporting the menu as a menu file', () => {
  it('writes every sheet with the template header and notes row, dishes in menu order', () => {
    const sheets = menuFileSheets(SOURCE);
    expect(sheets.Items[0]).toEqual(ITEMS_HEADER);
    expect(sheets.Items[1]?.[0]).toMatch(/^Required/);
    const names = sheets.Items.slice(2).map((row) => row[ITEMS_HEADER.indexOf('Item')]);
    expect(names).toEqual(['Paneer Tikka', 'Dal Makhani', 'Veg Thali']);
    const dal = sheets.Items[3] ?? [];
    const cell = (name: string) => dal[ITEMS_HEADER.indexOf(name)];
    expect(cell('Category')).toBe('Main Course');
    expect(cell('Sub-category')).toBe('Veg');
    expect(cell('Price')).toBe('280.50');
    expect(cell('Channels')).toBe('POS, Waiter app');
    expect(cell('Served from')).toBe('11:00');
  });

  it('[MENU-003] [MENU-004] [MENU-005] [MENU-007] loads back into an empty restaurant as the same menu', () => {
    const result = planMenuImport(menuFileSheets(SOURCE), {
      taxGroups: [{ id: 'tax-5', name: 'GST 5 %' }],
      stations: [
        { id: 'st-kitchen', name: 'Kitchen' },
        { id: 'st-tandoor', name: 'Tandoor' },
      ],
      categories: [],
      modifierGroups: [],
      items: [],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const { plan } = result;
    expect(plan.categories.map((category) => category.name)).toEqual([
      'Starters',
      'Main Course',
      'Veg',
    ]);
    expect(plan.modifierGroups).toEqual([
      expect.objectContaining({
        name: 'Roti type',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { name: 'Plain', priceDelta: 0 },
          { name: 'Butter', priceDelta: 1_000 },
        ],
      }),
      expect.objectContaining({ name: 'Extras', options: [{ name: 'Onion', priceDelta: -500 }] }),
    ]);
    const dal = plan.items.find((entry) => entry.name === 'Dal Makhani');
    expect(dal).toMatchObject({
      shortCode: 'DM08',
      description: 'Slow-cooked black lentils.',
      basePrice: 28_050,
      taxGroupId: 'tax-5',
      foodType: 'VEG',
      spiceLevel: 1,
      tags: ['Bestseller', 'Jain'],
      stationId: 'st-kitchen',
      prepTimeMinutes: 20,
      timeWindow: { start: '11:00', end: '23:30' },
      channels: ['POS', 'WAITER_APP'],
      variants: [
        { name: 'Half', price: 16_000, externalId: null },
        { name: 'Full', price: 28_050, externalId: 'ZOM-1' },
      ],
      modifierGroups: [{ newKey: 'group:roti type' }],
      synonyms: ['dal', 'kali dal'],
      repeatable: true,
      externalId: 'EXT-9',
    });
    expect(plan.items.find((entry) => entry.name === 'Paneer Tikka')).toMatchObject({
      timeWindow: null,
      channels: ['POS', 'WAITER_APP', 'TABLE_TABLET', 'QR'],
      stationId: 'st-tandoor',
    });
    expect(plan.combos).toEqual([
      {
        itemKey: 'item:veg thali',
        components: [
          { kind: 'FIXED', item: { newKey: 'item:dal makhani' }, quantity: 1 },
          {
            kind: 'CHOICE',
            label: 'Any starter',
            items: [{ newKey: 'item:paneer tikka' }, { newKey: 'item:dal makhani' }],
            quantity: 2,
          },
        ],
        activeFrom: '2026-11-01',
        activeUntil: null,
        timeWindow: { start: '12:00', end: '15:00' },
      },
    ]);
  });
});

describe('[MENU-007] serving hours in the template', () => {
  const plan = (from: string, until: string) =>
    planMenuImport(
      {
        Items: [
          ITEMS_HEADER,
          item({
            Category: 'Breakfast',
            Item: 'Poha',
            Price: '60',
            'Tax group': 'GST 5 %',
            'Food type': 'Veg',
            Station: 'Kitchen',
            'Served from': from,
            'Served until': until,
          }),
        ],
      },
      {
        taxGroups: [{ id: 'tax-5', name: 'GST 5 %' }],
        stations: [{ id: 'st-kitchen', name: 'Kitchen' }],
        categories: [],
        modifierGroups: [],
        items: [],
      },
    );

  it('reads the daily hours a dish is served', () => {
    const result = plan('7:00', '11:00');
    expect(result.ok && result.plan.items[0]?.timeWindow).toEqual({ start: '07:00', end: '11:00' });
  });

  it('asks for both times, valid ones, that differ', () => {
    const messages = (from: string, until: string) => {
      const result = plan(from, until);
      return result.ok
        ? []
        : result.issues.map((issue) => `${issue.column ?? ''}: ${issue.message}`);
    };
    expect(messages('07:00', '')).toEqual(['Served until: Give both times or neither']);
    expect(messages('25:00', '11:00')).toEqual(['Served from: A time, HH:MM']);
    expect(messages('07:00', '07:00')).toEqual([
      'Served until: The hours must start and end at different times',
    ]);
  });
});
