import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { renderTestPage } from '../../src/printing/escpos.js';
import { FolderTransport, slipText } from '../../src/printing/folder-transport.js';

/** The pilot's test-only printer (P9-25): every job saved in a folder instead of printed. */
const folder = mkdtempSync(join(tmpdir(), 'rp-printouts-'));

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('[KDS-008] a print saved in a folder (test only, P9-25)', () => {
  const page = renderTestPage({
    restaurantName: 'Mannat',
    printerName: 'Bill printer',
    paperWidthMm: 80,
    at: new Date('2026-11-01T10:00:00.000Z'),
    timeZone: 'Asia/Kolkata',
  });

  it('reads the slip as text, without the printer commands', () => {
    const text = slipText(page);
    expect(text).toContain('Mannat');
    expect(text).toContain('Bill printer');
    expect(text).toContain('cut');
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
  });

  it('saves the bytes and the text of every job, one pair each', async () => {
    const transport = new FolderTransport(
      join(folder, 'new'),
      () => new Date('2026-11-01T10:00:00.000Z'),
    );
    await transport.send({ connection: 'NETWORK', host: '127.0.0.1', port: 9100 }, page);
    await transport.send({ connection: 'NETWORK', host: '127.0.0.1', port: 9100 }, page);
    const files = readdirSync(join(folder, 'new')).sort();
    expect(files).toHaveLength(4);
    const bin = files.find((name) => name.endsWith('0001-127.0.0.1.bin')) ?? '';
    expect(Uint8Array.from(readFileSync(join(folder, 'new', bin)))).toEqual(page);
    const txt = files.find((name) => name.endsWith('0001-127.0.0.1.txt')) ?? '';
    expect(readFileSync(join(folder, 'new', txt), 'utf8')).toBe(slipText(page));
  });
});
