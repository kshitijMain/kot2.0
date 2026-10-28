import { describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import { readWorkbook } from '../../src/menu/import/workbook.js';
import { storedZip, unpackZip } from '../../src/menu/import/zip-limits.js';

/** A real workbook whose only cell is moved to `ref` (and its row to that row), as a few bytes. */
async function workbookReaching(ref: string): Promise<Buffer> {
  const made = await writeXlsxFile([[{ value: 'Dal' }]], { sheet: 'Items' }).toBuffer();
  const unpacked = await unpackZip(
    made,
    { maxEntries: 100, maxEntryBytes: 1_000_000, maxTotalBytes: 10_000_000 },
    () => true,
  );
  if (!unpacked.ok) throw new Error('Could not unpack the test workbook');
  const row = /\d+$/.exec(ref)?.[0] ?? '1';
  const parts = new Map(unpacked.files);
  for (const [name, content] of parts) {
    if (!name.startsWith('xl/worksheets/')) continue;
    const xml = content
      .toString('utf8')
      .replace(/<row r="1"/g, `<row r="${row}"`)
      .replace(/ r="A1"/g, ` r="${ref}"`)
      .replace(/<dimension ref="[^"]*"\/>/g, '');
    parts.set(name, Buffer.from(xml, 'utf8'));
  }
  return storedZip(parts);
}

describe('[MENU-012] [SEC-004] a workbook that reaches far beyond its data (QA-011)', () => {
  it.each(['XFD1048576', 'A1000000000', 'FXSHRXX1'])(
    'is refused at once with a plain message, not read cell by cell (%s)',
    async (ref) => {
      const started = Date.now();
      const read = await readWorkbook(await workbookReaching(ref));
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.message).toMatch(/empty rows and columns/);
      expect(Date.now() - started).toBeLessThan(2_000);
    },
  );

  it('still reads an ordinary workbook', async () => {
    const read = await readWorkbook(await workbookReaching('C40'));
    expect(read.ok).toBe(true);
  });
});
