import {
  type ImportChannel,
  type ImportFoodType,
  importSheetRows,
  MENU_IMPORT_COLUMNS,
  MENU_IMPORT_SHEETS,
  type MenuImportSheet,
  type MenuImportSheets,
  parseFoodType,
} from './menu-import.js';
import { type Paise, parseRupees } from './money.js';
import { rupeesText } from './menu-review.js';

/**
 * The menu file (ONB-005, ONB-007): a .zip with the menu template filled in (`menu.xlsx`), the
 * dishes' photos in `photos/` named by short code or dish name, and a README. These are its rules
 * that need no files: the names a file uses for tax groups and kitchen stations and their mapping
 * to the restaurant's own, the dishes it lists (for the review before anything is added), and the
 * sheets of a menu that exists, for the export. Tax rates are never in the file, only tax group
 * names; prices are rupee text in the sheet, read back to paise exactly.
 */

export const MENU_FILE_WORKBOOK = 'menu.xlsx';
export const MENU_FILE_README = 'README.txt';
export const MENU_FILE_PHOTOS = 'photos';

const fold = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** Names as the file spells them, first spelling kept, in the order they first appear. */
function distinct(values: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = fold(value);
    if (key !== '' && !seen.has(key)) seen.set(key, value.trim());
  }
  return [...seen.values()];
}

/** The tax group and kitchen station names the file's dishes use. */
export function menuFileNames(sheets: MenuImportSheets): {
  readonly taxGroups: readonly string[];
  readonly stations: readonly string[];
} {
  const rows = importSheetRows(sheets, 'Items');
  return {
    taxGroups: distinct(rows.map((row) => row.get('Tax group'))),
    stations: distinct(rows.map((row) => row.get('Station'))),
  };
}

/** What a file's name stands for on this PC: the file's name (any case) to the PC's name. */
export interface MenuFileNameMapping {
  readonly taxGroups: ReadonlyMap<string, string>;
  readonly stations: ReadonlyMap<string, string>;
}

/**
 * The sheets with the Items sheet's tax group and station names replaced by the restaurant's own,
 * so the import resolves them as usual. Names without a mapping are left as they are (the check
 * then says no tax group or station has that name).
 */
export function renameMenuFileNames(
  sheets: MenuImportSheets,
  mapping: MenuFileNameMapping,
): MenuImportSheets {
  const items = sheets.Items;
  if (items === undefined) return sheets;
  const lookup = (map: ReadonlyMap<string, string>) =>
    new Map([...map].map(([from, to]) => [fold(from), to]));
  const taxGroups = lookup(mapping.taxGroups);
  const stations = lookup(mapping.stations);
  const [header = [], ...body] = items;
  const headerKey = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');
  const at = (name: string) => header.findIndex((cell) => headerKey(cell) === headerKey(name));
  const taxColumn = at('Tax group');
  const stationColumn = at('Station');
  const renamed = body.map((cells) =>
    cells.map((cell, index) => {
      const map = index === taxColumn ? taxGroups : index === stationColumn ? stations : undefined;
      return map?.get(fold(cell)) ?? cell;
    }),
  );
  return { ...sheets, Items: [header, ...renamed] };
}

/** A dish as the file lists it, for the review: what can be read, even with mistakes elsewhere. */
export interface MenuFileDish {
  /** The Items sheet's row. */
  readonly row: number;
  readonly name: string;
  readonly shortCode: string | null;
  readonly category: string;
  readonly subCategory: string | null;
  readonly foodType: ImportFoodType | null;
  /** Null when the cell is blank or not an amount. */
  readonly price: Paise | null;
  readonly sizes: readonly { readonly name: string; readonly price: Paise | null }[];
  readonly addOnGroups: readonly string[];
  readonly combo: boolean;
}

const priceOf = (text: string): Paise | null => {
  if (text === '') return null;
  try {
    return parseRupees(text);
  } catch {
    return null;
  }
};

const listOf = (text: string, separator: string | RegExp) =>
  text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== '');

/** Every dish the Items sheet names, with its sizes from the Variants sheet. */
export function menuFileDishes(sheets: MenuImportSheets): MenuFileDish[] {
  const sizes = new Map<string, { name: string; price: Paise | null }[]>();
  for (const row of importSheetRows(sheets, 'Variants')) {
    const key = fold(row.get('Item'));
    if (key === '' || row.get('Variant') === '') continue;
    sizes.set(key, [
      ...(sizes.get(key) ?? []),
      { name: row.get('Variant'), price: priceOf(row.get('Price')) },
    ]);
  }
  const combos = new Set(importSheetRows(sheets, 'Combos').map((row) => fold(row.get('Combo'))));
  return importSheetRows(sheets, 'Items')
    .filter((row) => row.get('Item') !== '')
    .map((row) => {
      const name = row.get('Item');
      return {
        row: row.row,
        name,
        shortCode: row.get('Short code') === '' ? null : row.get('Short code'),
        category: row.get('Category'),
        subCategory: row.get('Sub-category') === '' ? null : row.get('Sub-category'),
        foodType: parseFoodType(row.get('Food type')),
        price: priceOf(row.get('Price')),
        sizes: sizes.get(fold(name)) ?? [],
        addOnGroups: listOf(row.get('Modifier groups'), ','),
        combo: combos.has(fold(name)),
      };
    });
}

// ---------------------------------------------------------------- export

/** A menu as the restaurant has it (active entries only), with names for its references. */
export interface MenuFileSource {
  readonly categories: readonly {
    readonly id: string;
    readonly name: string;
    readonly parentId: string | null;
    readonly displayOrder: number;
  }[];
  readonly modifierGroups: readonly {
    readonly id: string;
    readonly name: string;
    readonly minSelections: number;
    readonly maxSelections: number;
    readonly options: readonly { readonly name: string; readonly priceDelta: Paise }[];
  }[];
  readonly items: readonly {
    readonly id: string;
    readonly categoryId: string;
    readonly name: string;
    readonly shortCode: string | null;
    readonly description: string | null;
    readonly basePrice: Paise;
    readonly taxGroupName: string;
    readonly foodType: ImportFoodType;
    readonly spiceLevel: number;
    readonly tags: readonly string[];
    readonly stationName: string;
    readonly prepTimeMinutes: number | null;
    readonly timeWindow: { readonly start: string; readonly end: string } | null;
    readonly displayOrder: number;
    readonly channels: readonly ImportChannel[];
    readonly variants: readonly {
      readonly name: string;
      readonly price: Paise;
      readonly externalId: string | null;
    }[];
    readonly modifierGroupIds: readonly string[];
    readonly synonyms: readonly string[];
    readonly repeatable: boolean;
    readonly externalId: string | null;
  }[];
  readonly combos: readonly {
    readonly itemId: string;
    readonly components: readonly {
      readonly kind: 'FIXED' | 'CHOICE';
      readonly itemId: string | null;
      readonly label: string | null;
      readonly itemIds: readonly string[];
      readonly quantity: number;
    }[];
    readonly activeFrom: string | null;
    readonly activeUntil: string | null;
    readonly timeWindow: { readonly start: string; readonly end: string } | null;
  }[];
}

const FOOD_TYPE_TEXT: Readonly<Record<ImportFoodType, string>> = {
  VEG: 'Veg',
  NON_VEG: 'Non-veg',
  EGG: 'Egg',
};

const CHANNEL_TEXT: Readonly<Record<ImportChannel, string>> = {
  POS: 'POS',
  WAITER_APP: 'Waiter app',
  TABLE_TABLET: 'Tablet',
  QR: 'QR',
};

/** The header and the notes row of a sheet, as in the empty template. */
export function menuTemplateHeader(sheet: MenuImportSheet): string[][] {
  const columns = MENU_IMPORT_COLUMNS[sheet];
  return [
    columns.map((column) => column.name),
    columns.map((column) => `${column.required ? 'Required' : 'Optional'}: ${column.hint}`),
  ];
}

/**
 * The menu as the template's sheets, header and notes rows included, ready to load into another
 * restaurant. Loading it into a restaurant without these dishes gives the same menu.
 */
export function menuFileSheets(menu: MenuFileSource): Record<MenuImportSheet, string[][]> {
  const rows = menuFileRows(menu);
  return Object.fromEntries(
    MENU_IMPORT_SHEETS.map((sheet) => [sheet, [...menuTemplateHeader(sheet), ...rows[sheet]]]),
  ) as Record<MenuImportSheet, string[][]>;
}

/**
 * The menu's rows under each sheet's header: categories and dishes in their display order, each
 * dish's sizes, every add-on group, and the combos.
 */
export function menuFileRows(menu: MenuFileSource): Record<MenuImportSheet, string[][]> {
  const categories = new Map(menu.categories.map((category) => [category.id, category]));
  const groups = new Map(menu.modifierGroups.map((group) => [group.id, group]));
  const items = new Map(menu.items.map((item) => [item.id, item]));
  /** A category's place: its parent's order first, then its own. */
  const placeOf = (categoryId: string): [number, number, string] => {
    const category = categories.get(categoryId);
    if (category === undefined) return [Number.MAX_SAFE_INTEGER, 0, ''];
    const parent = category.parentId === null ? undefined : categories.get(category.parentId);
    return parent === undefined
      ? [category.displayOrder, -1, category.name]
      : [parent.displayOrder, category.displayOrder, category.name];
  };
  const ordered = [...menu.items]
    .filter((item) => categories.has(item.categoryId))
    .sort((a, b) => {
      const [aTop, aSub, aName] = placeOf(a.categoryId);
      const [bTop, bSub, bName] = placeOf(b.categoryId);
      return (
        aTop - bTop ||
        aSub - bSub ||
        aName.localeCompare(bName) ||
        a.displayOrder - b.displayOrder ||
        a.name.localeCompare(b.name)
      );
    });

  const row = (sheet: MenuImportSheet, cells: Readonly<Record<string, string>>) =>
    MENU_IMPORT_COLUMNS[sheet].map((column) => cells[column.name] ?? '');

  const itemRows = ordered.map((item) => {
    const category = categories.get(item.categoryId);
    const parent =
      category?.parentId === null || category === undefined
        ? undefined
        : categories.get(category.parentId);
    const allChannels = Object.keys(CHANNEL_TEXT).every((channel) =>
      item.channels.includes(channel as ImportChannel),
    );
    return row('Items', {
      Category: parent?.name ?? category?.name ?? '',
      'Sub-category': parent === undefined ? '' : (category?.name ?? ''),
      Item: item.name,
      'Short code': item.shortCode ?? '',
      Description: item.description ?? '',
      Price: rupeesText(item.basePrice),
      'Tax group': item.taxGroupName,
      'Food type': FOOD_TYPE_TEXT[item.foodType],
      'Spice level': String(item.spiceLevel),
      Tags: item.tags.join(', '),
      Station: item.stationName,
      'Prep minutes': item.prepTimeMinutes === null ? '' : String(item.prepTimeMinutes),
      Channels: allChannels ? '' : item.channels.map((channel) => CHANNEL_TEXT[channel]).join(', '),
      Synonyms: item.synonyms.join(', '),
      'Modifier groups': item.modifierGroupIds
        .map((id) => groups.get(id)?.name)
        .filter((name): name is string => name !== undefined)
        .join(', '),
      Repeatable: item.repeatable ? 'Yes' : '',
      'External ID': item.externalId ?? '',
      'Served from': item.timeWindow?.start ?? '',
      'Served until': item.timeWindow?.end ?? '',
    });
  });

  const variantRows = ordered.flatMap((item) =>
    item.variants.map((variant) =>
      row('Variants', {
        Item: item.name,
        Variant: variant.name,
        Price: rupeesText(variant.price),
        'External ID': variant.externalId ?? '',
      }),
    ),
  );

  // Every active group, used or not, so the restaurant that loads the file has the same ones.
  const modifierRows = menu.modifierGroups.flatMap((group) =>
    group.options.map((option, index) =>
      row('Modifiers', {
        Group: group.name,
        Min: index === 0 ? String(group.minSelections) : '',
        Max: index === 0 ? String(group.maxSelections) : '',
        Option: option.name,
        'Price change': option.priceDelta === 0 ? '' : rupeesText(option.priceDelta),
      }),
    ),
  );

  const nameOf = (id: string | null) => (id === null ? '' : (items.get(id)?.name ?? ''));
  const comboRows = ordered.flatMap((item) => {
    const combo = menu.combos.find((entry) => entry.itemId === item.id);
    if (combo === undefined) return [];
    return combo.components.map((component, index) =>
      row('Combos', {
        Combo: item.name,
        Part: component.kind === 'FIXED' ? 'Item' : 'Choice',
        Items:
          component.kind === 'FIXED'
            ? nameOf(component.itemId)
            : component.itemIds.map(nameOf).join(' | '),
        Label: component.label ?? '',
        Quantity: String(component.quantity),
        'Active from': index === 0 ? (combo.activeFrom ?? '') : '',
        'Active until': index === 0 ? (combo.activeUntil ?? '') : '',
        'Starts at': index === 0 ? (combo.timeWindow?.start ?? '') : '',
        'Ends at': index === 0 ? (combo.timeWindow?.end ?? '') : '',
      }),
    );
  });

  return { Items: itemRows, Variants: variantRows, Modifiers: modifierRows, Combos: comboRows };
}

/**
 * A photo's file name in the menu file: the dish's short code, or its name, made safe for every
 * file system, and different from the names already used.
 */
export function menuFilePhotoName(
  dish: { readonly name: string; readonly shortCode: string | null },
  extension: string,
  taken: Set<string>,
): string {
  const base =
    (dish.shortCode ?? dish.name)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 _-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'dish';
  let name = `${base}.${extension}`;
  for (let copy = 2; taken.has(name.toLowerCase()); copy += 1) {
    name = `${base} ${String(copy)}.${extension}`;
  }
  taken.add(name.toLowerCase());
  return name;
}
