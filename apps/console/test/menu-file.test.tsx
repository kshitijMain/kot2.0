import type { MenuFileReview } from '@rp/contracts';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';
import { GST5, KITCHEN, stations, TANDOOR, taxGroups } from './menu-fixture.js';

const PATH = '/manage/menu/import';
const FILE_ID = '0199a0e0-0000-7000-8000-000000009001';
const zip = (size?: number) => {
  const file = new File(['PK menu file'], 'swaad-menu.zip', { type: 'application/zip' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
};
const SUMMARY = { categories: 2, modifierGroups: 1, items: 3, variants: 2, combos: 1 };
const READY = { ok: true, committed: false, issues: [], summary: SUMMARY, menuVersion: null };

const REVIEW: MenuFileReview = {
  id: FILE_ID,
  kind: 'ZIP',
  names: {
    taxGroups: [{ name: 'GST 5 %', suggestedId: GST5 }],
    stations: [
      { name: 'Kitchen', suggestedId: KITCHEN },
      { name: 'Grill', suggestedId: null },
    ],
  },
  dishes: [
    {
      row: 2,
      name: 'Paneer Tikka',
      shortCode: 'PT01',
      category: 'Starters',
      subCategory: null,
      foodType: 'VEG',
      price: 28_000,
      sizes: [],
      addOnGroups: [],
      combo: false,
    },
    {
      row: 3,
      name: 'Dal Makhani',
      shortCode: 'DM08',
      category: 'Mains',
      subCategory: 'Veg',
      foodType: 'VEG',
      price: null,
      sizes: [
        { name: 'Half', price: 16_000 },
        { name: 'Full', price: 28_050 },
      ],
      addOnGroups: ['Roti type'],
      combo: false,
    },
    {
      row: 4,
      name: 'Veg Thali',
      shortCode: null,
      category: 'Mains',
      subCategory: null,
      foodType: 'VEG',
      price: 34_900,
      sizes: [],
      addOnGroups: [],
      combo: true,
    },
  ],
  photos: [
    { file: 'photos/PT01.jpg', dish: 'Paneer Tikka', by: 'CODE', thumbnailBase64: 'UklGRg==' },
    { file: 'photos/chef.jpg', dish: null, by: null, thumbnailBase64: 'UklGRg==' },
  ],
  report: {
    ok: false,
    committed: false,
    issues: [
      {
        sheet: 'Items',
        row: 2,
        column: 'Station',
        message: 'No kitchen station is called "Grill"',
      },
    ],
    summary: null,
    menuVersion: null,
  },
};

function fileServer() {
  return signsInAs(server(), 'MANAGER')
    .on('GET', '/api/v1/tax-groups', () => ({ status: 200, body: taxGroups() }))
    .on('GET', '/api/v1/stations', () => ({ status: 200, body: stations() }))
    .on('GET', '/api/v1/menu/files/empty', () => ({
      status: 200,
      body: 'PK empty',
      headers: { 'content-type': 'application/zip' },
    }))
    .on('POST', '/api/v1/menu/files', () => ({ status: 201, body: REVIEW }))
    .on('POST', `/api/v1/menu/files/${FILE_ID}/check`, () => ({ status: 200, body: READY }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[ONB-005] [ONB-007] the menu file', () => {
  it('downloads the empty menu file', async () => {
    const createObjectURL = vi.fn((_file: Blob) => 'blob:menu');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const fake = fileServer();
    const { user, container } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    expect(await screen.findByRole('heading', { name: t('menuFile.title') })).toBeVisible();
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: t('menuFile.download') }));
    await vi.waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });
    expect(fake.callsTo('GET', '/api/v1/menu/files/empty')).toHaveLength(1);
  });

  it('loads the file, maps the names, fixes a photo, and adds it as a draft', async () => {
    const fake = fileServer().on('POST', `/api/v1/menu/files/${FILE_ID}/import`, () => ({
      status: 200,
      body: { report: { ...READY, committed: true }, photos: 2 },
    }));
    const { user, container } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    await user.upload(await screen.findByLabelText(t('menuFile.load')), zip());

    // The file is sent as itself, with its type.
    const [upload] = fake.callsTo('POST', '/api/v1/menu/files');
    expect(upload?.headers['content-type']).toBe('application/zip');
    expect(await upload?.file?.text()).toBe('PK menu file');

    expect(await screen.findByText(t('menuFile.loaded', { file: 'swaad-menu.zip' }))).toBeVisible();
    // The check as loaded: "Grill" is not set up here; nothing can be added yet.
    expect(screen.getByRole('alert')).toHaveTextContent('No kitchen station is called "Grill"');
    const add = screen.getByRole('button', { name: t('menuFile.confirm') });
    expect(add).toBeDisabled();

    // Every dish, with its sizes in rupees.
    const dishes = within(screen.getByRole('table'));
    expect(dishes.getByText('Dal Makhani')).toBeVisible();
    expect(dishes.getByText('Half ₹160.00 · Full ₹280.50')).toBeVisible();
    expect(dishes.getByText('Mains › Veg')).toBeVisible();
    await expectNoAxeViolations(container);

    // The names: suggestions picked, "Grill" mapped by hand, which checks again.
    expect(screen.getByLabelText(t('menuFile.taxGroup', { name: 'GST 5 %' }))).toHaveValue(GST5);
    await user.selectOptions(
      screen.getByLabelText(t('menuFile.station', { name: 'Grill' })),
      TANDOOR,
    );
    expect(await screen.findByText(/Ready to add: 3 dishes/)).toBeVisible();
    const [check] = fake.callsTo('POST', `/api/v1/menu/files/${FILE_ID}/check`);
    expect(check?.body).toEqual({
      taxGroups: [{ name: 'GST 5 %', id: GST5 }],
      stations: [
        { name: 'Kitchen', id: KITCHEN },
        { name: 'Grill', id: TANDOOR },
      ],
      photos: [
        { file: 'photos/PT01.jpg', dish: 'Paneer Tikka' },
        { file: 'photos/chef.jpg', dish: null },
      ],
    });

    // The photos: matched by short code, and one given to a dish by hand.
    expect(screen.getByText(t('menuFile.byCode'))).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText(t('menuFile.photoFor', { file: 'photos/chef.jpg' })),
      'Veg Thali',
    );
    expect(
      await screen.findByRole('heading', { name: t('menuFile.photos', { matched: 2, count: 2 }) }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: t('menuFile.confirm') }));
    expect(await screen.findByText(t('menuFile.added', { items: 3, photos: 2 }))).toBeVisible();
    const [imported] = fake.callsTo('POST', `/api/v1/menu/files/${FILE_ID}/import`);
    expect(imported?.body).toMatchObject({
      photos: [
        { file: 'photos/PT01.jpg', dish: 'Paneer Tikka' },
        { file: 'photos/chef.jpg', dish: 'Veg Thali' },
      ],
    });
    await user.click(screen.getByRole('button', { name: t('menuFile.reviewMenu') }));
    expect(await screen.findByRole('heading', { name: t('menuEditor.title') })).toBeVisible();
  });

  it('says why a file is refused, and refuses one too large before sending it', async () => {
    const fake = fileServer().on('POST', '/api/v1/menu/files', () => ({
      status: 422,
      body: {
        code: 'MENU_FILE_REFUSED',
        message:
          'The menu file holds “notes.docx”, which is neither the sheet, the README nor a photo.',
      },
    }));
    const { user } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    const input = await screen.findByLabelText(t('menuFile.load'));
    await user.upload(input, zip(200 * 1024 * 1024));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('menuFile.tooLarge', { size: 100 }),
    );
    expect(fake.callsTo('POST', '/api/v1/menu/files')).toHaveLength(0);
    await user.upload(input, zip());
    expect(await screen.findByText(/notes\.docx/)).toBeVisible();
  });
});
