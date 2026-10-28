import { z } from 'zod';
import { FoodType, Id, Paise } from './common.js';
import { MenuImportReport } from './menu-import.js';

/**
 * The menu file (ONB-005, ONB-007): one .zip with the menu template filled in (`menu.xlsx`), the
 * dishes' photos in `photos/` (named by short code or dish name) and a README. Managed only on the
 * restaurant's own PC, without the internet: download it empty, load it (a plain .xlsx works for a
 * menu without photos), review and map names, add it as a draft, then publish; or export the menu
 * as the same file, to load at another restaurant or keep as a copy.
 *
 * Files travel as raw bytes: the download is the zip itself, and the upload's body is the file
 * (`application/zip`, or the workbook's own type for a plain .xlsx).
 */

/** The largest menu file accepted: the sheet and a few hundred photos. */
export const MENU_FILE_MAX_BYTES = 100 * 1024 * 1024;
/** The most photos one file may hold. */
export const MENU_FILE_MAX_PHOTOS = 500;
/** What the zip may unpack to in all. */
export const MENU_FILE_MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
export const MENU_FILE_CONTENT_TYPE = 'application/zip';
export const MENU_FILE_WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Download names. */
export const MENU_FILE_EMPTY_NAME = 'menu-file.zip';

export const MenuFileParams = z.strictObject({ fileId: Id });
export type MenuFileParams = z.infer<typeof MenuFileParams>;

/** A dish as the file lists it, readable even when the file has mistakes elsewhere. */
export const MenuFileDish = z.object({
  /** The Items sheet's row. */
  row: z.int().positive(),
  name: z.string(),
  shortCode: z.string().nullable(),
  category: z.string(),
  subCategory: z.string().nullable(),
  foodType: FoodType.nullable(),
  /** Null when blank or not an amount (the report says which). */
  price: Paise.nullable(),
  sizes: z.array(z.object({ name: z.string(), price: Paise.nullable() })),
  addOnGroups: z.array(z.string()),
  combo: z.boolean(),
});
export type MenuFileDish = z.infer<typeof MenuFileDish>;

/** A photo in the file and the dish it goes with (matched by short code or name). */
export const MenuFilePhoto = z.object({
  /** Its name in `photos/`. */
  file: z.string(),
  /** The dish's name, or null when it matched none. */
  dish: z.string().nullable(),
  by: z.enum(['CODE', 'NAME']).nullable(),
  /** A small WebP of it, base64, for the review. */
  thumbnailBase64: z.string(),
});
export type MenuFilePhoto = z.infer<typeof MenuFilePhoto>;

/** A name the file uses for a tax group or a kitchen station, and this PC's one it matches. */
export const MenuFileName = z.object({
  name: z.string(),
  /** The active tax group or station with this name (any case), or null. */
  suggestedId: Id.nullable(),
});
export type MenuFileName = z.infer<typeof MenuFileName>;

/** What the manager reviews after loading a file; nothing is saved yet. */
export const MenuFileReview = z.object({
  /** The loaded file, kept on this PC for a day for the check and the import. */
  id: Id,
  kind: z.enum(['ZIP', 'XLSX']),
  names: z.object({ taxGroups: z.array(MenuFileName), stations: z.array(MenuFileName) }),
  dishes: z.array(MenuFileDish),
  photos: z.array(MenuFilePhoto),
  /** The check with the suggested names and photo matches. */
  report: MenuImportReport,
});
export type MenuFileReview = z.infer<typeof MenuFileReview>;

const NameChoice = z.strictObject({ name: z.string().min(1).max(200), id: Id });

/** The manager's choices: what each name stands for on this PC, and each photo's dish. */
export const MenuFileChoices = z.strictObject({
  taxGroups: z.array(NameChoice).max(100),
  stations: z.array(NameChoice).max(100),
  photos: z
    .array(
      z.strictObject({
        file: z.string().min(1).max(255),
        /** The dish's name as the file has it, or null to leave the photo out. */
        dish: z.string().min(1).max(80).nullable(),
      }),
    )
    .max(MENU_FILE_MAX_PHOTOS),
});
export type MenuFileChoices = z.infer<typeof MenuFileChoices>;

/** After importing: the report (its `committed` says whether the draft was written). */
export const MenuFileImportResult = z.object({
  report: MenuImportReport,
  /** Photos added to their dishes. */
  photos: z.int().nonnegative(),
});
export type MenuFileImportResult = z.infer<typeof MenuFileImportResult>;
