import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  ApiError,
  type LoginResponse,
  MenuDraftResponse,
  type MenuFileChoices,
  MenuFileImportResult,
  MenuFileReview,
  MenuImportReport,
  MenuSnapshot,
} from '@rp/contracts';
import { MENU_IMPORT_COLUMNS } from '@rp/domain';
import readXlsxFile from 'read-excel-file/node';
import sharp from 'sharp';
import request from 'supertest';
import writeXlsxFile from 'write-excel-file/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storedZip, unpackZip } from '../../src/menu/import/zip-limits.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * The menu file (ONB-005, ONB-007): download it empty, load a filled one (a zip with menu.xlsx and
 * photos, or a plain .xlsx), review and map names, add it to the draft, publish; export the menu as
 * the same file and load it into a fresh restaurant. All on the PC, without the internet.
 */

interface Restaurant {
  database: TestDatabase;
  app: INestApplication;
  prisma: PrismaService;
  kit: AuthKit;
  manager: LoginResponse;
  waiter: LoginResponse;
  ids: Record<string, string>;
}

async function restaurant(stations: readonly string[]): Promise<Restaurant> {
  const database = await createTestDatabase();
  const app = await createTestApp({
    databaseUrl: database.url,
    config: { dataDir: join(mkdtempSync(join(tmpdir(), 'rp-menu-files-')), '.data') },
  });
  const prisma = app.get(PrismaService);
  const kit = await createAuthKit(app);
  const base = { restaurantId: kit.restaurantId };
  const ids: Record<string, string> = {};
  for (const name of stations) {
    ids[name] = (await prisma.station.create({ data: { ...base, name } })).id;
  }
  ids['GST 5 %'] = (await prisma.taxGroup.create({ data: { ...base, name: 'GST 5 %' } })).id;
  return {
    database,
    app,
    prisma,
    kit,
    manager: await signIn(app, kit, 'MANAGER'),
    waiter: await signIn(app, kit, 'WAITER'),
    ids,
  };
}

let first: Restaurant;
let fresh: Restaurant;

beforeAll(async () => {
  first = await restaurant(['Tandoor', 'Kitchen']);
  fresh = await restaurant(['Tandoor', 'Main kitchen']);
});

afterAll(async () => {
  for (const place of [first, fresh]) {
    await place.app.close();
    await place.database.drop();
  }
});

const as = (place: Restaurant, login = place.manager) =>
  authHeaders(place.kit.deviceId, login.accessToken);
const server = (place: Restaurant) => request(httpServer(place.app));
const codeOf = (response: request.Response) => ApiError.parse(response.body).code;

const header = (sheet: keyof typeof MENU_IMPORT_COLUMNS) =>
  MENU_IMPORT_COLUMNS[sheet].map((column) => column.name);
const rowOf = (sheet: keyof typeof MENU_IMPORT_COLUMNS, cells: Record<string, string>) =>
  header(sheet).map((name) => cells[name] ?? '');

async function workbook(): Promise<Buffer> {
  const dish = (cells: Record<string, string>) =>
    rowOf('Items', { 'Tax group': 'gst 5 %', 'Food type': 'Veg', ...cells });
  const sheets = {
    Items: [
      header('Items'),
      dish({
        Category: 'Starters',
        Item: 'Paneer Tikka',
        'Short code': 'PT01',
        Price: '280',
        Station: 'Grill',
      }),
      dish({
        Category: 'Mains',
        Item: 'Dal Makhani',
        'Short code': 'DM08',
        Station: 'kitchen',
        'Modifier groups': 'Roti type',
        'Served from': '11:00',
        'Served until': '23:00',
      }),
      dish({
        Category: 'Breads',
        Item: 'Butter Naan',
        'Short code': 'BN21',
        Price: '60',
        Station: 'Kitchen',
      }),
      dish({
        Category: 'Mains',
        Item: 'Veg Thali',
        'Short code': 'VT40',
        Price: '349',
        Station: 'Kitchen',
      }),
    ],
    Variants: [
      header('Variants'),
      rowOf('Variants', { Item: 'Dal Makhani', Variant: 'Half', Price: '160' }),
      rowOf('Variants', { Item: 'Dal Makhani', Variant: 'Full', Price: '280.50' }),
    ],
    Modifiers: [
      header('Modifiers'),
      rowOf('Modifiers', { Group: 'Roti type', Min: '1', Max: '1', Option: 'Plain' }),
      rowOf('Modifiers', { Group: 'Roti type', Option: 'Butter', 'Price change': '10' }),
    ],
    Combos: [
      header('Combos'),
      rowOf('Combos', { Combo: 'Veg Thali', Part: 'Item', Items: 'Dal Makhani' }),
      rowOf('Combos', {
        Combo: 'Veg Thali',
        Part: 'Choice',
        Items: 'Butter Naan | Paneer Tikka',
        Label: 'Any one',
      }),
    ],
  };
  return writeXlsxFile(Object.entries(sheets).map(([sheet, data]) => ({ sheet, data }))).toBuffer();
}

const photo = (format: 'jpeg' | 'png', colour: string) =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: colour } })
    [format]()
    .toBuffer();

/** As people zip a folder: everything inside it, with what a Mac adds on its own. */
async function filledFile(): Promise<Buffer> {
  return storedZip(
    new Map([
      ['Swaad menu/', Buffer.alloc(0)],
      ['Swaad menu/menu.xlsx', await workbook()],
      ['Swaad menu/README.txt', Buffer.from('How to fill it in')],
      ['Swaad menu/photos/', Buffer.alloc(0)],
      ['Swaad menu/photos/PT01.jpg', await photo('jpeg', '#c86428')],
      ['Swaad menu/photos/dal makhani.png', await photo('png', '#7a4a1e')],
      ['Swaad menu/photos/Chef special.jpg', await photo('jpeg', '#336699')],
      ['__MACOSX/Swaad menu/photos/._PT01.jpg', Buffer.from('mac metadata')],
    ]),
  );
}

const upload = (place: Restaurant, content: Buffer, login = place.manager) =>
  server(place)
    .post('/api/v1/menu/files')
    .set(as(place, login))
    .set('content-type', 'application/zip')
    .send(content);

async function unzip(content: Buffer): Promise<Map<string, Buffer>> {
  const unpacked = await unpackZip(
    content,
    { maxEntries: 100, maxEntryBytes: 50 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 },
    () => true,
  );
  if (!unpacked.ok) throw new Error(unpacked.reason);
  return new Map(unpacked.files);
}

const download = async (place: Restaurant, path: string) => {
  const response = await server(place)
    .get(path)
    .set(as(place))
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        done(null, Buffer.concat(chunks));
      });
    });
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('application/zip');
  return response.body as Buffer;
};

describe('[ONB-005] [ONB-007] the empty menu file', () => {
  it('holds the empty template, an empty photos folder and a README', async () => {
    const files = await unzip(await download(first, '/api/v1/menu/files/empty'));
    expect([...files.keys()].sort()).toEqual(['README.txt', 'menu.xlsx', 'photos/']);
    const sheets = await readXlsxFile(files.get('menu.xlsx') ?? Buffer.alloc(0));
    expect(sheets.map((sheet) => sheet.sheet)).toEqual([
      'Items',
      'Variants',
      'Modifiers',
      'Combos',
    ]);
    expect(sheets[0]?.data[0]).toEqual(header('Items'));
    expect(files.get('README.txt')?.toString('utf8')).toContain('photos folder');
  });
});

describe('[ONB-005] [ONB-007] [MENU-008] loading a menu file', () => {
  let review: MenuFileReview;
  let choices: MenuFileChoices;

  it('reviews every dish and photo, suggests this PC’s names, and saves nothing', async () => {
    const response = await upload(first, await filledFile());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    review = MenuFileReview.parse(response.body);
    expect(review.kind).toBe('ZIP');
    expect(review.names).toEqual({
      taxGroups: [{ name: 'gst 5 %', suggestedId: first.ids['GST 5 %'] }],
      stations: [
        { name: 'Grill', suggestedId: null },
        { name: 'kitchen', suggestedId: first.ids.Kitchen },
      ],
    });
    expect(review.dishes.map((dish) => dish.name)).toEqual([
      'Paneer Tikka',
      'Dal Makhani',
      'Butter Naan',
      'Veg Thali',
    ]);
    expect(review.dishes[1]).toMatchObject({
      price: null,
      sizes: [
        { name: 'Half', price: 16_000 },
        { name: 'Full', price: 28_050 },
      ],
      addOnGroups: ['Roti type'],
    });
    expect(review.dishes[3]?.combo).toBe(true);
    // The Mac's own files are skipped; each photo has a thumbnail and its match.
    expect(review.photos.map(({ file, dish, by }) => ({ file, dish, by }))).toEqual([
      { file: 'photos/PT01.jpg', dish: 'Paneer Tikka', by: 'CODE' },
      { file: 'photos/dal makhani.png', dish: 'Dal Makhani', by: 'NAME' },
      { file: 'photos/Chef special.jpg', dish: null, by: null },
    ]);
    for (const entry of review.photos) expect(entry.thumbnailBase64.length).toBeGreaterThan(100);
    // "Grill" is not a station here yet: the check says so.
    expect(review.report.ok).toBe(false);
    expect(review.report.issues).toEqual([
      {
        sheet: 'Items',
        row: 2,
        column: 'Station',
        message: 'No kitchen station is called "Grill"',
      },
    ]);
    expect(await first.prisma.item.count({ where: { restaurantId: first.kit.restaurantId } })).toBe(
      0,
    );
  });

  it('checks again with the names mapped to this PC’s', async () => {
    choices = {
      taxGroups: [{ name: 'gst 5 %', id: first.ids['GST 5 %'] ?? '' }],
      stations: [
        { name: 'Grill', id: first.ids.Tandoor ?? '' },
        { name: 'kitchen', id: first.ids.Kitchen ?? '' },
      ],
      photos: [
        { file: 'photos/PT01.jpg', dish: 'Paneer Tikka' },
        { file: 'photos/dal makhani.png', dish: 'Dal Makhani' },
        { file: 'photos/Chef special.jpg', dish: null },
      ],
    };
    const response = await server(first)
      .post(`/api/v1/menu/files/${review.id}/check`)
      .set(as(first))
      .send(choices);
    expect(response.status).toBe(200);
    expect(MenuImportReport.parse(response.body)).toMatchObject({
      ok: true,
      committed: false,
      summary: { categories: 3, modifierGroups: 1, items: 4, variants: 2, combos: 1 },
    });
  });

  it('adds the dishes and their photos to the draft; the devices get them only on Publish', async () => {
    const response = await server(first)
      .post(`/api/v1/menu/files/${review.id}/import`)
      .set(as(first))
      .send(choices);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(MenuFileImportResult.parse(response.body)).toMatchObject({
      report: { ok: true, committed: true, menuVersion: null },
      photos: 2,
    });
    const draft = MenuDraftResponse.parse(
      (await server(first).get('/api/v1/menu/draft').set(as(first))).body,
    );
    const dish = (name: string) => draft.items.find((item) => item.name === name);
    expect(dish('Paneer Tikka')).toMatchObject({ stationId: first.ids.Tandoor, basePrice: 28_000 });
    expect(dish('Paneer Tikka')?.photoId).not.toBeNull();
    expect(dish('Dal Makhani')?.photoId).not.toBeNull();
    expect(dish('Butter Naan')?.photoId).toBeNull();
    expect(dish('Dal Makhani')?.timeWindow).toEqual({ start: '11:00', end: '23:00' });

    expect((await server(first).get('/api/v1/menu').set(as(first))).status).toBe(404);
    expect((await server(first).post('/api/v1/menu/publish').set(as(first))).status).toBe(200);
    const menu = MenuSnapshot.parse((await server(first).get('/api/v1/menu').set(as(first))).body);
    expect(menu.items.find((item) => item.name === 'Paneer Tikka')?.photoId).not.toBeNull();

    const audit = await first.prisma.auditLog.findFirstOrThrow({
      where: { restaurantId: first.kit.restaurantId, action: 'MENU_IMPORTED' },
    });
    expect(audit.after).toMatchObject({ format: 'MENU_FILE', file: 'ZIP', photos: '2', items: 4 });
    // The loaded file is gone once imported.
    const again = await server(first)
      .post(`/api/v1/menu/files/${review.id}/check`)
      .set(as(first))
      .send(choices);
    expect(again.status).toBe(404);
    expect(codeOf(again)).toBe('MENU_FILE_NOT_FOUND');
  });

  it('takes a plain menu.xlsx for a menu without photos', async () => {
    const response = await server(fresh)
      .post('/api/v1/menu/files')
      .set(as(fresh))
      .set('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(await workbook());
    expect(response.status).toBe(201);
    const review = MenuFileReview.parse(response.body);
    expect(review).toMatchObject({ kind: 'XLSX', photos: [] });
    expect(review.dishes).toHaveLength(4);
  });
});

describe('[SEC-004] [ONB-005] what a menu file may not hold', () => {
  const refusal = async (files: Map<string, Buffer>) => {
    const response = await upload(first, storedZip(files));
    expect(response.status).toBe(422);
    expect(codeOf(response)).toBe('MENU_FILE_REFUSED');
    return ApiError.parse(response.body).message;
  };

  it('refuses a path that points outside the archive', async () => {
    const message = await refusal(
      new Map([
        ['menu.xlsx', await workbook()],
        ['../outside.jpg', await photo('jpeg', '#000000')],
      ]),
    );
    expect(message).toContain('points outside');
  });

  it('refuses files that are neither the sheet, the README nor a photo', async () => {
    const message = await refusal(
      new Map([
        ['menu.xlsx', await workbook()],
        ['notes.docx', Buffer.from('notes')],
      ]),
    );
    expect(message).toContain('notes.docx');
  });

  it('refuses a "photo" that is not an image', async () => {
    const message = await refusal(
      new Map([
        ['menu.xlsx', await workbook()],
        ['photos/PT01.jpg', Buffer.from('#!/bin/sh\necho not a photo')],
      ]),
    );
    expect(message).toMatch(/^photos\/PT01\.jpg: /);
  });

  it('refuses a file without the sheet, and one that is not a zip', async () => {
    expect(await refusal(new Map([['photos/PT01.jpg', await photo('jpeg', '#000000')]]))).toContain(
      'no menu.xlsx',
    );
    const response = await upload(first, Buffer.from('just text'));
    expect(response.status).toBe(422);
    expect(ApiError.parse(response.body).message).toContain('not a menu file');
  });

  it('[AUTH-010] is for people who manage the menu only', async () => {
    expect((await upload(first, await filledFile(), first.waiter)).status).toBe(403);
    const empty = await server(first).get('/api/v1/menu/files/empty').set(as(first, first.waiter));
    expect(empty.status).toBe(403);
    const exported = await server(first)
      .get('/api/v1/menu/files/export')
      .set(as(first, first.waiter));
    expect(exported.status).toBe(403);
  });
});

describe('[ONB-005] [ONB-007] exporting the menu as a menu file', () => {
  it('loads into a fresh restaurant as the same menu, photos included', async () => {
    const exported = await download(first, '/api/v1/menu/files/export');
    const files = await unzip(exported);
    expect([...files.keys()].filter((name) => name.startsWith('photos/')).sort()).toEqual([
      'photos/',
      'photos/DM08.webp',
      'photos/PT01.webp',
    ]);

    const loaded = await upload(fresh, exported);
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(201);
    const review = MenuFileReview.parse(loaded.body);
    expect(review.names.stations).toEqual([
      { name: 'Tandoor', suggestedId: fresh.ids.Tandoor },
      { name: 'Kitchen', suggestedId: null },
    ]);
    const imported = await server(fresh)
      .post(`/api/v1/menu/files/${review.id}/import`)
      .set(as(fresh))
      .send({
        taxGroups: [{ name: 'GST 5 %', id: fresh.ids['GST 5 %'] }],
        stations: [
          { name: 'Tandoor', id: fresh.ids.Tandoor },
          { name: 'Kitchen', id: fresh.ids['Main kitchen'] },
        ],
        photos: review.photos.map((entry) => ({ file: entry.file, dish: entry.dish })),
      });
    expect(MenuFileImportResult.parse(imported.body)).toMatchObject({
      report: { committed: true },
      photos: 2,
    });

    const menuOf = async (place: Restaurant) => {
      const draft = MenuDraftResponse.parse(
        (await server(place).get('/api/v1/menu/draft').set(as(place))).body,
      );
      const stationName = new Map(
        Object.entries(place.ids).map(([name, id]) => [
          id,
          name === 'Main kitchen' ? 'Kitchen' : name,
        ]),
      );
      const names = new Map([
        ...draft.items.map((item) => [item.id, item.name] as const),
        ...draft.modifierGroups.map((group) => [group.id, group.name] as const),
        ...draft.categories.map((category) => [category.id, category.name] as const),
      ]);
      return {
        categories: draft.categories.map((category) => category.name).sort(),
        groups: draft.modifierGroups.map((group) => ({
          name: group.name,
          min: group.minSelections,
          max: group.maxSelections,
          options: group.options.map((option) => [option.name, option.priceDelta]),
        })),
        items: draft.items
          .map((item) => ({
            name: item.name,
            category: names.get(item.categoryId),
            shortCode: item.shortCode,
            basePrice: item.basePrice,
            station: stationName.get(item.stationId),
            timeWindow: item.timeWindow,
            channels: item.channels,
            variants: item.variants.map((variant) => [variant.name, variant.price]),
            groups: item.modifierGroupIds.map((id) => names.get(id)),
            photo: item.photoId !== null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        combos: draft.combos.map((combo) => ({
          item: names.get(combo.itemId),
          components: combo.components.map((component) => ({
            kind: component.kind,
            item: component.itemId === null ? null : names.get(component.itemId),
            choices: component.itemIds.map((id) => names.get(id)),
            label: component.label,
            quantity: component.quantity,
          })),
        })),
      };
    };
    expect(await menuOf(fresh)).toEqual(await menuOf(first));
  });
});
