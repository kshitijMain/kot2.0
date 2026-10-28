import { MENU_FILE_MAX_PHOTOS, MENU_IMPORT_MAX_BYTES } from '@rp/contracts';
import { MENU_IMPORT_COLUMNS } from '@rp/domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import { AppError } from '../../src/errors/app-error.js';
import { readMenuFile } from '../../src/menu/import/menu-file-reader.js';
import { storedZip, unpackZip } from '../../src/menu/import/zip-limits.js';

const sheet = () =>
  writeXlsxFile([
    { sheet: 'Items', data: [MENU_IMPORT_COLUMNS.Items.map((column) => column.name)] },
  ]).toBuffer();

const jpeg = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#c86428' } })
    .jpeg()
    .toBuffer();

/** The refusal's message, or a failure if the file was accepted. */
async function refusalOf(files: Map<string, Buffer>): Promise<string> {
  try {
    await readMenuFile(storedZip(files), { checkPhotos: true });
  } catch (error) {
    if (error instanceof AppError) return `${String(error.status)} ${error.message}`;
    throw error;
  }
  throw new Error('The file was accepted');
}

describe('[SEC-004] [ONB-005] reading a menu file', () => {
  it('takes backslash folders, a README in any form and photos in any folder', async () => {
    const content = await readMenuFile(
      storedZip(
        new Map([
          ['Menu\\menu.xlsx', await sheet()],
          ['Menu\\readme.md', Buffer.from('notes')],
          ['Menu\\photos\\mains\\PT01.JPG', await jpeg()],
          ['Menu\\Thumbs.db', Buffer.from('windows')],
          ['Menu/.DS_Store', Buffer.from('mac')],
        ]),
      ),
      { checkPhotos: true },
    );
    expect(content.kind).toBe('ZIP');
    expect(content.photos.map((photo) => photo.file)).toEqual(['photos/mains/PT01.JPG']);
    expect(content.photos[0]?.thumbnail?.width).toBe(160);
  });

  it('leaves the photos unchecked when only the sheet is needed', async () => {
    const content = await readMenuFile(
      storedZip(
        new Map([
          ['menu.xlsx', await sheet()],
          ['photos/PT01.jpg', await jpeg()],
        ]),
      ),
      { checkPhotos: false },
    );
    expect(content.photos[0]?.thumbnail).toBeUndefined();
  });

  it('refuses absolute paths, drive letters and parent folders', async () => {
    for (const name of ['/etc/menu.jpg', 'C:/menu.jpg', 'photos/../../menu.jpg', 'a//b.jpg']) {
      expect(
        await refusalOf(
          new Map([
            ['menu.xlsx', await sheet()],
            [name, await jpeg()],
          ]),
        ),
      ).toMatch(/^422 .*points outside/);
    }
  });

  it('refuses two workbooks, a workbook in a folder, and other files', async () => {
    expect(
      await refusalOf(
        new Map([
          ['menu.xlsx', await sheet()],
          ['old menu.xlsx', await sheet()],
        ]),
      ),
    ).toContain('more than one workbook');
    expect(
      await refusalOf(
        new Map([
          ['menu.xlsx', await sheet()],
          ['sheets/menu.xlsx', await sheet()],
        ]),
      ),
    ).toContain('neither the sheet');
    expect(
      await refusalOf(
        new Map([
          ['menu.xlsx', await sheet()],
          ['photos/run.exe', Buffer.from('MZ')],
        ]),
      ),
    ).toContain('photos/run.exe');
  });

  it('refuses more photos than a file may hold, and a workbook over 5 MB', async () => {
    const photo = await jpeg();
    const many = new Map<string, Buffer>([['menu.xlsx', await sheet()]]);
    for (let index = 0; index <= MENU_FILE_MAX_PHOTOS; index += 1) {
      many.set(`photos/${String(index)}.jpg`, photo);
    }
    expect(await refusalOf(many)).toContain(`more than ${String(MENU_FILE_MAX_PHOTOS)} photos`);
    expect(
      await refusalOf(new Map([['menu.xlsx', Buffer.alloc(MENU_IMPORT_MAX_BYTES + 1)]])),
    ).toContain('larger than 5 MB');
  });

  it('lists every entry and unpacks only those asked for', async () => {
    const unpacked = await unpackZip(
      storedZip(
        new Map([
          ['a.txt', Buffer.from('a')],
          ['b.txt', Buffer.from('b')],
        ]),
      ),
      { maxEntries: 10, maxEntryBytes: 10, maxTotalBytes: 10 },
      (name) => name === 'b.txt',
    );
    expect(unpacked).toEqual({
      ok: true,
      names: ['a.txt', 'b.txt'],
      files: new Map([['b.txt', Buffer.from('b')]]),
    });
    const tooMany = await unpackZip(
      storedZip(
        new Map([
          ['a.txt', Buffer.from('a')],
          ['b.txt', Buffer.from('b')],
        ]),
      ),
      { maxEntries: 1, maxEntryBytes: 10, maxTotalBytes: 10 },
      () => true,
    );
    expect(tooMany).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });
});
