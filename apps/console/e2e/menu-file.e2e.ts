import { readFile } from 'node:fs/promises';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { MENU_IMPORT_COLUMNS, type MenuImportSheet } from '@rp/domain';
import { createTranslator } from '@rp/i18n';
import { buildMenuWorkbook } from '../../server/src/menu/import/menu-template.js';
import { storedZip, unpackZip } from '../../server/src/menu/import/zip-limits.js';
import { type RunningServer, startServer } from './server.js';

const t = createTranslator();

/**
 * The menu file end to end (ONB-005, ONB-007, MENU-008): a manager downloads the empty file, fills
 * it with dishes, Half and Full sizes, an add-on group, a combo and photos, loads it, maps a
 * station, adds it as a draft and publishes; the POS shows the dishes with their photos. The menu
 * is then exported and loaded into a restaurant without a menu, which ends up with the same menu.
 * No internet, Control Plane or licence takes part.
 */

/** A row of a sheet, by column name, in the template's column order. */
const row = (sheet: MenuImportSheet, cells: Record<string, string>) =>
  MENU_IMPORT_COLUMNS[sheet].map((column) => cells[column.name] ?? '');

const dish = (cells: Record<string, string>) =>
  row('Items', { 'Tax group': 'GST 5 %', 'Food type': 'Veg', ...cells });

const ROWS: Partial<Record<MenuImportSheet, string[][]>> = {
  Items: [
    dish({
      Category: 'Main Course',
      Item: 'Kadhai Mushroom',
      'Short code': 'KM01',
      Station: 'Kitchen',
      'Modifier groups': 'Gravy choice',
    }),
    dish({
      Category: 'Main Course',
      Item: 'Malai Kofta',
      'Short code': 'MK02',
      Price: '240',
      Station: 'Kitchen',
    }),
    dish({
      Category: 'Starters',
      Item: 'Tandoori Gobi',
      'Short code': 'TG03',
      Price: '200',
      Station: 'Tandoor',
    }),
    dish({
      Category: 'Combos',
      Item: 'Mushroom Meal',
      'Short code': 'MM04',
      Price: '320',
      Station: 'Kitchen',
    }),
  ],
  Variants: [
    row('Variants', { Item: 'Kadhai Mushroom', Variant: 'Half', Price: '150' }),
    row('Variants', { Item: 'Kadhai Mushroom', Variant: 'Full', Price: '260' }),
  ],
  Modifiers: [
    row('Modifiers', { Group: 'Gravy choice', Min: '1', Max: '1', Option: 'Dry' }),
    row('Modifiers', { Group: 'Gravy choice', Option: 'With gravy', 'Price change': '20' }),
  ],
  Combos: [
    row('Combos', { Combo: 'Mushroom Meal', Part: 'Item', Items: 'Kadhai Mushroom' }),
    row('Combos', {
      Combo: 'Mushroom Meal',
      Part: 'Choice',
      Items: 'Butter Naan | Garlic Naan',
      Label: 'Any bread',
    }),
  ],
};

async function unzip(content: Buffer): Promise<Map<string, Buffer>> {
  const limits = { maxEntries: 500, maxEntryBytes: 50_000_000, maxTotalBytes: 200_000_000 };
  const unpacked = await unpackZip(content, limits, () => true);
  if (!unpacked.ok) throw new Error(`Not a zip: ${unpacked.reason}`);
  return new Map(unpacked.files);
}

/** A photo as a phone would give it: a JPEG, drawn in the browser. */
async function photo(page: Page, colour: string): Promise<Buffer> {
  const dataUrl = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas');
    context.fillStyle = fill;
    context.fillRect(0, 0, 800, 600);
    return canvas.toDataURL('image/jpeg', 0.8);
  }, colour);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** Pairs a new browser with a restaurant's PC and signs the manager in. */
async function managerOn(browser: Browser, server: RunningServer): Promise<Page> {
  const bootstrap = await fetch(`${server.url}/api/v1/devices/pairing-codes/bootstrap`, {
    method: 'POST',
  });
  expect(bootstrap.status).toBe(201);
  const { code } = (await bootstrap.json()) as { code: string };
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(server.url);
  await page.getByLabel(t('pairing.codeLabel')).fill(code);
  await page.getByRole('button', { name: t('pairing.submit') }).click();
  await signIn(page, 'Vikram (Manager)', '2222');
  return page;
}

async function signIn(page: Page, name: string, pin: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) }).click();
  await page.keyboard.type(pin);
  await expect(page.getByRole('button', { name: t('login.signOut') })).toBeVisible();
}

async function download(page: Page, button: string): Promise<Buffer> {
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await (await started).path();
  return readFile(file);
}

/** Loads a menu file and waits for the review. */
async function load(page: Page, name: string, content: Buffer): Promise<void> {
  await page.goto(`${new URL(page.url()).origin}/manage/menu/import`);
  await page
    .getByLabel(t('menuFile.load'))
    .setInputFiles({ name, mimeType: 'application/zip', buffer: content });
  await expect(page.getByText(t('menuFile.loaded', { file: name }))).toBeVisible({
    timeout: 60_000,
  });
}

async function addAndPublish(page: Page): Promise<void> {
  await page.getByRole('button', { name: t('menuFile.confirm') }).click();
  await expect(page.getByText(/to the draft\. Check the menu, then publish it\./)).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: t('menuFile.reviewMenu') }).click();
  await page.getByRole('button', { name: t('menuEditor.publish') }).click();
  const publishing = page.getByRole('dialog', { name: t('menuEditor.publishing.title') });
  await publishing.getByRole('button', { name: t('menuEditor.publishing.confirm') }).click();
  await publishing.getByRole('button', { name: t('menuEditor.publishing.close') }).click();
}

/** Every dish in the menu editor: name, short code, category and price, and whether it has a photo. */
async function menuOf(page: Page): Promise<string[]> {
  await page.goto(`${new URL(page.url()).origin}/manage/menu`);
  const rows = page.locator('.menu-row');
  await expect(rows.first()).toBeVisible();
  const dishes = await rows.evaluateAll((elements) =>
    elements.map((element) => {
      const name = element.querySelector('.staff-row__name')?.textContent ?? '';
      const line = element.querySelector('.staff-row__role')?.textContent ?? '';
      const photo = element.querySelector('.menu-row__photo img') === null ? 'no photo' : 'photo';
      return `${name} | ${line} | ${photo}`;
    }),
  );
  return dishes.sort();
}

test('[ONB-005] [ONB-007] [MENU-008] the menu file: fill, load, publish, export, load elsewhere', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const env = process.env;
  if (
    env.RP_E2E_MENU_DATABASE_URL === undefined ||
    env.RP_E2E_MENU_FRESH_DATABASE_URL === undefined
  ) {
    throw new Error('Run through Playwright');
  }
  // One server at a time: each runs the pager broker on its port.
  const first = await startServer(undefined, {
    databaseUrl: env.RP_E2E_MENU_DATABASE_URL,
    ...(env.RP_E2E_MENU_DATA_DIR !== undefined && { dataDir: env.RP_E2E_MENU_DATA_DIR }),
  });
  let exported: Buffer;
  let menu: string[];
  try {
    const page = await managerOn(browser, first);

    // 1. The empty file: the template, a photos folder and the README.
    await page.goto(`${first.url}/manage/menu`);
    await page.getByRole('button', { name: t('menuEditor.fromExcel') }).click();
    const empty = await unzip(await download(page, t('menuFile.download')));
    expect([...empty.keys()].sort()).toEqual(['README.txt', 'menu.xlsx', 'photos/']);

    // 2. Filled in: four dishes, Half and Full, an add-on group, a combo and three photos.
    const filled = storedZip(
      new Map([
        ['Swaad menu/README.txt', empty.get('README.txt') ?? Buffer.alloc(0)],
        ['Swaad menu/menu.xlsx', await buildMenuWorkbook(ROWS)],
        ['Swaad menu/photos/', Buffer.alloc(0)],
        ['Swaad menu/photos/KM01.jpg', await photo(page, '#8a5a2b')],
        ['Swaad menu/photos/Malai Kofta.jpg', await photo(page, '#d9a441')],
        ['Swaad menu/photos/MM04.jpg', await photo(page, '#6b8e23')],
      ]),
    );

    // 3. Loaded and reviewed: "Tandoor" is not a station here; the manager maps it to the Kitchen.
    await load(page, 'swaad-menu.zip', filled);
    await expect(page.getByRole('alert')).toContainText('No kitchen station is called "Tandoor"');
    await expect(
      page.getByRole('heading', { name: t('menuFile.photos', { matched: 3, count: 3 }) }),
    ).toBeVisible();
    await page
      .getByLabel(t('menuFile.station', { name: 'Tandoor' }))
      .selectOption({ label: 'Kitchen' });
    await expect(
      page.getByText(/^Ready to add: 4 dishes, 2 sizes, 1 add-on group and 1 combo\./),
    ).toBeVisible();
    await addAndPublish(page);

    // 4. The POS shows the new dishes with their photos.
    await page.getByRole('button', { name: t('login.signOut') }).click();
    await signIn(page, 'Neha (Manager)', '3333');
    await page.getByRole('button', { name: t('pos.takeaway') }).click();
    await page.getByLabel(t('pos.menu.search')).fill('Kadhai Mushroom');
    const card = page.getByRole('button', { name: /^Kadhai Mushroom, / });
    await expect(card).toBeVisible();
    const image = card.locator('img');
    await expect(image).toHaveAttribute('src', /\/api\/v1\/photos\/[0-9a-f-]+\/160$/);
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await page.getByLabel(t('pos.menu.search')).fill('Tandoori Gobi');
    await expect(
      page.getByRole('button', { name: /^Tandoori Gobi, / }).locator('.rp-dish-photo__plate'),
    ).toBeVisible();

    // 5. Exported: the whole menu with its photos, named by short code.
    await page.getByRole('button', { name: t('login.signOut') }).click();
    await signIn(page, 'Vikram (Manager)', '2222');
    await page.goto(`${first.url}/manage/menu`);
    exported = await download(page, t('menuFile.export'));
    const files = await unzip(exported);
    expect(
      [...files.keys()].filter((name) => name.startsWith('photos/') && name !== 'photos/').sort(),
    ).toEqual(['photos/KM01.webp', 'photos/MK02.webp', 'photos/MM04.webp']);

    menu = await menuOf(page);
  } finally {
    await first.stop();
  }

  // 6. Loaded into a restaurant without a menu, whose kitchen station is "Main kitchen".
  const fresh = await startServer(undefined, {
    databaseUrl: env.RP_E2E_MENU_FRESH_DATABASE_URL,
    ...(env.RP_E2E_MENU_FRESH_DATA_DIR !== undefined && {
      dataDir: env.RP_E2E_MENU_FRESH_DATA_DIR,
    }),
  });
  try {
    const other = await managerOn(browser, fresh);
    await load(other, 'menu-export.zip', exported);
    await other
      .getByLabel(t('menuFile.station', { name: 'Kitchen' }))
      .selectOption({ label: 'Main kitchen' });
    await expect(other.getByText(/^Ready to add: /)).toBeVisible();
    await addAndPublish(other);

    // The same menu: every dish, its category, price and photo.
    expect(await menuOf(other)).toEqual(menu);
  } finally {
    await fresh.stop();
  }
});
