import { MENU_IMPORT_COLUMNS, MENU_IMPORT_SHEETS, type MenuImportSheet } from '@rp/domain';
import writeXlsxFile from 'write-excel-file/node';

export const MENU_TEMPLATE_FILENAME = 'menu-template.xlsx';

/**
 * The vendor menu template (ONB-005): one sheet per part, a bold header row, and a notes row
 * saying whether each column is required and what goes in it. The notes row starts with
 * "Required" or "Optional" and is skipped on import.
 */
export async function buildMenuTemplate(): Promise<Buffer> {
  return buildMenuWorkbook({});
}

/**
 * The template with rows under the notes row (a menu exported as a menu file, ONB-005); each row
 * has the template's columns in order, as text.
 */
export async function buildMenuWorkbook(
  rows: Partial<Record<MenuImportSheet, readonly (readonly string[])[]>>,
): Promise<Buffer> {
  const sheets = MENU_IMPORT_SHEETS.map((sheet) => {
    const columns = MENU_IMPORT_COLUMNS[sheet];
    return {
      sheet,
      data: [
        columns.map((column) => ({ value: column.name, fontWeight: 'bold' as const })),
        columns.map((column) => ({
          value: `${column.required ? 'Required' : 'Optional'}: ${column.hint}`,
          fontStyle: 'italic' as const,
          wrap: true,
        })),
        ...(rows[sheet] ?? []).map((cells) =>
          cells.map((value) => (value === '' ? null : { value })),
        ),
      ],
      columns: columns.map((column) => ({ width: Math.max(14, column.name.length + 4) })),
      stickyRowsCount: 2,
    };
  });
  return writeXlsxFile(sheets).toBuffer();
}
