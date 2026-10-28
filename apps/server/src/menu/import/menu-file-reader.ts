import {
  MENU_FILE_MAX_BYTES,
  MENU_FILE_MAX_PHOTOS,
  MENU_FILE_MAX_UNPACKED_BYTES,
  MENU_IMPORT_MAX_BYTES,
} from '@rp/contracts';
import type { MenuImportSheets } from '@rp/domain';
import { AppError } from '../../errors/app-error.js';
import { type EncodedRendition, processPhoto } from '../../photos/photo-processing.js';
import { readWorkbook } from './workbook.js';
import { unpackZip, type ZipLimits } from './zip-limits.js';

/** A photo of a menu file, checked and re-encoded as any upload is. */
export interface MenuFilePhotoContent {
  /** Its path in the file, without the folder the zip was made from (`photos/PT01.jpg`). */
  readonly file: string;
  readonly content: Buffer;
  /** The smallest rendition, for the review; only when the photos were checked. */
  readonly thumbnail?: EncodedRendition;
}

export interface MenuFileContent {
  readonly kind: 'ZIP' | 'XLSX';
  readonly sheets: MenuImportSheets;
  readonly photos: readonly MenuFilePhotoContent[];
}

/** The sheet and the photos may be large; everything else in a menu file is small. */
const LIMITS: ZipLimits = {
  maxEntries: MENU_FILE_MAX_PHOTOS + 50,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: MENU_FILE_MAX_UNPACKED_BYTES,
};

/** Photos checked at the same time. */
const PHOTOS_AT_ONCE = 4;

const IMAGE = /\.(jpe?g|png|webp|heic|heif)$/i;
const SHEET = /\.xlsx$/i;
const NOTES = /^readme(\.(txt|md))?$/i;
/** What zip tools and file managers add on their own; never part of a menu. */
const SYSTEM_FILE = /^(__MACOSX\/|.*\/?\._)|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

const refused = (message: string, details?: Record<string, unknown>) =>
  new AppError(422, 'MENU_FILE_REFUSED', message, details);

/** A character below the space: no file name has one. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/**
 * A path that stays inside the archive: relative, no `..`, no drive letter, no empty or control
 * characters. Backslashes (some Windows tools) count as folder separators.
 */
function safePath(name: string): string | undefined {
  const path = name.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || hasControlCharacter(path)) {
    return undefined;
  }
  const parts = path.split('/');
  // A folder entry ends with "/", so its last part is empty; nothing else may be.
  if (parts.slice(0, -1).some((part) => part === '' || part === '.' || part === '..')) {
    return undefined;
  }
  if (parts.at(-1) === '..' || parts.at(-1) === '.') return undefined;
  return path;
}

/** The archive's own folder ("Swaad menu/") when every entry is inside one, else "". */
function commonFolder(paths: readonly string[]): string {
  const first = paths[0]?.split('/')[0];
  if (first === undefined || paths.some((path) => !path.startsWith(`${first}/`))) return '';
  return `${first}/`;
}

/** A workbook is itself a zip; Excel always puts this part at its root. */
const isWorkbookArchive = (names: readonly string[]) => names.includes('[Content_Types].xml');

/**
 * Opens a menu file (ONB-005, ONB-007, SEC-004): a zip with the filled template, the photos and a
 * README, or a plain .xlsx. Within the size limits; refused, saying why, when a path would point
 * outside the archive, when it holds anything but the sheet, a README and images (what zip tools
 * add on their own is skipped), or when a photo is not an image we can use. With `checkPhotos`
 * every photo is checked and re-encoded as a photo upload is (and gets a thumbnail); without, the
 * photos are left for the upload's own checks when they are stored.
 */
export async function readMenuFile(
  data: Buffer,
  options: { readonly checkPhotos: boolean },
): Promise<MenuFileContent> {
  if (data.length > MENU_FILE_MAX_BYTES) {
    throw new AppError(
      413,
      'MENU_FILE_TOO_LARGE',
      `The menu file is larger than ${String(MENU_FILE_MAX_BYTES / 1024 / 1024)} MB. Use smaller photos.`,
    );
  }
  const listed = await unpackZip(data, LIMITS, () => false);
  if (!listed.ok) {
    throw refused(
      listed.reason === 'NOT_ZIP'
        ? 'This is not a menu file. Choose the .zip you filled in, or a menu.xlsx.'
        : listed.reason === 'TOO_LARGE'
          ? 'The menu file unpacks to more than a menu needs. Use fewer or smaller photos.'
          : 'The menu file is damaged. Make the zip again.',
    );
  }
  if (isWorkbookArchive(listed.names)) {
    if (data.length > MENU_IMPORT_MAX_BYTES) {
      throw refused('The workbook is larger than 5 MB.');
    }
    return { kind: 'XLSX', sheets: await sheetsOf(data), photos: [] };
  }

  const paths = new Map<string, string>();
  for (const name of listed.names) {
    const path = safePath(name);
    if (path === undefined) {
      throw refused(
        `The menu file holds “${name}”, a path that points outside it. Make the zip again from the folder.`,
        { file: name },
      );
    }
    if (!path.endsWith('/') && !SYSTEM_FILE.test(path)) paths.set(path, name);
  }
  const folder = commonFolder([...paths.keys()]);
  let sheet: string | undefined;
  const photoNames: string[] = [];
  for (const [path] of paths) {
    const inside = path.slice(folder.length);
    if (!inside.includes('/') && SHEET.test(inside)) {
      if (sheet !== undefined) {
        throw refused('The menu file holds more than one workbook. Keep only menu.xlsx.');
      }
      sheet = path;
    } else if (!inside.includes('/') && NOTES.test(inside)) {
      // The README: read by people, not by the import.
    } else if (IMAGE.test(inside)) {
      photoNames.push(path);
    } else {
      throw refused(
        `The menu file holds “${inside}”, which is neither the sheet, the README nor a photo. Take it out and make the zip again.`,
        { file: inside },
      );
    }
  }
  if (sheet === undefined) {
    throw refused('The menu file has no menu.xlsx. Put the filled template in it.');
  }
  if (photoNames.length > MENU_FILE_MAX_PHOTOS) {
    throw refused(`The menu file holds more than ${String(MENU_FILE_MAX_PHOTOS)} photos.`);
  }

  const wanted = new Set([sheet, ...photoNames].map((path) => paths.get(path)));
  const unpacked = await unpackZip(data, LIMITS, (name) => wanted.has(name));
  if (!unpacked.ok) throw refused('The menu file is damaged. Make the zip again.');
  const contentOf = (path: string): Buffer => {
    const content = unpacked.files.get(paths.get(path) ?? '');
    if (content === undefined) throw refused('The menu file is damaged. Make the zip again.');
    return content;
  };

  const workbook = contentOf(sheet);
  if (workbook.length > MENU_IMPORT_MAX_BYTES) throw refused('The workbook is larger than 5 MB.');
  const sheets = await sheetsOf(workbook);
  const checkPhoto = async (path: string): Promise<MenuFilePhotoContent> => {
    const file = path.slice(folder.length);
    const content = contentOf(path);
    if (!options.checkPhotos) return { file, content };
    try {
      const processed = await processPhoto(content);
      const thumbnail = processed.renditions[0];
      if (thumbnail === undefined) throw new Error('No renditions were produced');
      return { file, content, thumbnail };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      throw refused(`${file}: ${error.message}`, { file });
    }
  };
  // A few at a time: a whole menu's photos, without holding every decoded image at once.
  const photos: MenuFilePhotoContent[] = [];
  for (let start = 0; start < photoNames.length; start += PHOTOS_AT_ONCE) {
    photos.push(
      ...(await Promise.all(photoNames.slice(start, start + PHOTOS_AT_ONCE).map(checkPhoto))),
    );
  }
  return { kind: 'ZIP', sheets, photos };
}

async function sheetsOf(workbook: Buffer): Promise<MenuImportSheets> {
  const read = await readWorkbook(workbook);
  if (!read.ok) throw refused(read.message);
  return read.sheets;
}
