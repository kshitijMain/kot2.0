import {
  MENU_IMPORT_MAX_ROWS,
  MENU_IMPORT_SHEETS,
  type MenuImportSheet,
  type MenuImportSheets,
} from '@rp/domain';
import readXlsxFile from 'read-excel-file/node';
import {
  unpackWorkbook,
  unpackZip,
  XLSX_MAX_ENTRY_BYTES,
  XLSX_MAX_TOTAL_BYTES,
} from './zip-limits.js';

export type WorkbookResult =
  | { readonly ok: true; readonly sheets: MenuImportSheets }
  | { readonly ok: false; readonly message: string };

const UNREADABLE = 'The workbook could not be read. Save it again as .xlsx from Excel.';

const pad = (value: number) => String(value).padStart(2, '0');

/** Rows and columns a sheet may reach: well beyond a menu (2,000 dishes, about 30 columns). */
export const SHEET_MAX_ROWS = MENU_IMPORT_MAX_ROWS + 1_000;
export const SHEET_MAX_COLUMNS = 200;

const TOO_FAR =
  'A sheet reaches far beyond its data. Delete the empty rows and columns after your menu, save it again as .xlsx and try again.';

/** The column number of a cell reference's letters: A = 1, Z = 26, AA = 27. */
function columnNumber(letters: string): number {
  let number = 0;
  for (const letter of letters) number = number * 26 + (letter.charCodeAt(0) - 64);
  return number;
}

/**
 * Whether a sheet's cells stay within reach. The reader makes a row for every row up to the
 * last one named and a cell for every column up to the last, all at once, so a file of a few
 * bytes naming cell XFD1048576 would fill the memory and stop the whole server (QA-011).
 */
function withinReach(xml: string): boolean {
  for (const match of xml.matchAll(/<row\b[^>]*?\br="(\d+)"/g)) {
    if (Number(match[1]) > SHEET_MAX_ROWS) return false;
  }
  for (const match of xml.matchAll(/<c\b[^>]*?\br="([A-Z]+)(\d+)"/g)) {
    const [, letters = '', row = '0'] = match;
    if (letters.length > 3 || columnNumber(letters) > SHEET_MAX_COLUMNS) return false;
    if (Number(row) > SHEET_MAX_ROWS) return false;
  }
  return true;
}

/**
 * A cell as the text a person typed: numbers without float noise ("249.5"), dates as
 * YYYY-MM-DD, and a time-only cell (Excel keeps it on 30 Dec 1899) as HH:MM.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (value.getUTCFullYear() < 1901)
      return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
    return `${String(value.getUTCFullYear())}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'number') return String(Number(value.toPrecision(12)));
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return '';
}

/** Reads the template's sheets from a .xlsx; sheet names are matched without case. */
export async function readWorkbook(content: Buffer): Promise<WorkbookResult> {
  // Unpacked here within the limits (PC-D4); the reader gets the parts again, stored.
  const unpacked = await unpackWorkbook(content);
  if (!unpacked.ok) {
    return {
      ok: false,
      message:
        unpacked.reason === 'TOO_LARGE'
          ? 'The workbook unpacks to more than a menu needs. Remove other sheets or pictures.'
          : unpacked.reason === 'NOT_ZIP'
            ? 'The file is not an Excel workbook (.xlsx). Save it as .xlsx or send CSV sheets.'
            : UNREADABLE,
    };
  }
  const sheetsXml = await unpackZip(
    unpacked.archive,
    { maxEntries: 1_000, maxEntryBytes: XLSX_MAX_ENTRY_BYTES, maxTotalBytes: XLSX_MAX_TOTAL_BYTES },
    (name) => name.startsWith('xl/worksheets/') && name.endsWith('.xml'),
  );
  if (!sheetsXml.ok) return { ok: false, message: UNREADABLE };
  for (const xml of sheetsXml.files.values()) {
    if (!withinReach(xml.toString('utf8'))) return { ok: false, message: TOO_FAR };
  }
  let workbook: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    workbook = await readXlsxFile(unpacked.archive);
  } catch {
    return { ok: false, message: UNREADABLE };
  }
  const sheets: Partial<Record<MenuImportSheet, string[][]>> = {};
  for (const { sheet, data } of workbook) {
    const name = MENU_IMPORT_SHEETS.find(
      (known) => known.toLowerCase() === sheet.trim().toLowerCase(),
    );
    if (name === undefined || sheets[name] !== undefined) continue;
    sheets[name] = data.map((row) => row.map(cellText));
  }
  return { ok: true, sheets };
}
