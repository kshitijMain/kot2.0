import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  type MenuFileChoices,
  type MenuFileImportResult,
  type MenuFileReview,
  type MenuImportReport,
  PHOTO_WIDTHS,
} from '@rp/contracts';
import {
  MENU_FILE_PHOTOS,
  MENU_FILE_README,
  MENU_FILE_WORKBOOK,
  type MenuFileSource,
  type MenuImportSheets,
  matchPhotos,
  menuFileDishes,
  menuFileNames,
  menuFilePhotoName,
  menuFileRows,
  renameMenuFileNames,
} from '@rp/domain';
import { createTranslator } from '@rp/i18n';
import type { Principal } from '../../auth/principal.js';
import { newId } from '../../common/ids.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppError } from '../../errors/app-error.js';
import { PhotosService } from '../../photos/photos.service.js';
import { MenuAdminService } from '../menu-admin.service.js';
import { type MenuFileContent, readMenuFile } from './menu-file-reader.js';
import { MenuImportService } from './menu-import.service.js';
import { buildMenuWorkbook } from './menu-template.js';
import { storedZip } from './zip-limits.js';

/** A loaded file waits this long for its check and import, then is removed. */
const KEEP_LOADED_MS = 24 * 60 * 60 * 1000;

const fold = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

const t = createTranslator();

/**
 * The menu file (ONB-005, ONB-007): the empty file to fill in, the menu exported as one, and
 * loading one: kept on this PC's data drive while the manager reviews it, then imported through
 * the menu import (`planMenuImport`, into the draft) with the photos through the photo upload's
 * checks. Nothing here needs the internet, the Control Plane, a licence or a signature.
 */
@Injectable()
export class MenuFileService {
  private readonly folder: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly imports: MenuImportService,
    private readonly admin: MenuAdminService,
    private readonly photos: PhotosService,
  ) {
    this.folder = resolve(config.dataDir, 'menu-files');
  }

  /** The empty template, an empty photos folder and the README, zipped. */
  async emptyFile(): Promise<Buffer> {
    return storedZip(
      new Map([
        [MENU_FILE_WORKBOOK, await buildMenuWorkbook({})],
        [`${MENU_FILE_PHOTOS}/`, Buffer.alloc(0)],
        [MENU_FILE_README, Buffer.from(t('menuFile.readme').replace(/\n/g, '\r\n'), 'utf8')],
      ]),
    );
  }

  /**
   * The draft menu's active entries as a menu file, each dish's photo (its largest rendition) in
   * the photos folder named by short code or name, so the file loads into another restaurant as
   * the same menu.
   */
  async exportFile(principal: Principal): Promise<Buffer> {
    const { restaurantId } = principal;
    const [draft, taxGroups, stations] = await Promise.all([
      this.admin.draft(restaurantId),
      this.prisma.taxGroup.findMany({ where: { restaurantId }, select: { id: true, name: true } }),
      this.prisma.station.findMany({ where: { restaurantId }, select: { id: true, name: true } }),
    ]);
    const taxName = new Map(taxGroups.map((group) => [group.id, group.name]));
    const stationName = new Map(stations.map((station) => [station.id, station.name]));
    const active = <T extends { archivedAt: string | null }>(list: readonly T[]) =>
      list.filter((entry) => entry.archivedAt === null);
    const categories = active(draft.categories);
    const categoryIds = new Set(categories.map((category) => category.id));
    const items = active(draft.items).filter((item) => categoryIds.has(item.categoryId));
    const groups = active(draft.modifierGroups);
    const groupIds = new Set(groups.map((group) => group.id));
    const itemIds = new Set(items.map((item) => item.id));
    const source: MenuFileSource = {
      categories,
      modifierGroups: groups.map((group) => ({
        ...group,
        options: active(group.options),
      })),
      items: items.map((item) => ({
        ...item,
        taxGroupName: taxName.get(item.taxGroupId) ?? '',
        stationName: stationName.get(item.stationId) ?? '',
        variants: active(item.variants),
        modifierGroupIds: item.modifierGroupIds.filter((id) => groupIds.has(id)),
      })),
      combos: draft.combos.filter((combo) => itemIds.has(combo.itemId)),
    };
    const files = new Map<string, Buffer>([
      [MENU_FILE_WORKBOOK, await buildMenuWorkbook(menuFileRows(source))],
      [`${MENU_FILE_PHOTOS}/`, Buffer.alloc(0)],
    ]);
    const photoIds = items.flatMap((item) => (item.photoId === null ? [] : [item.photoId]));
    const stored = new Map(
      (
        await this.prisma.photo.findMany({
          where: { id: { in: photoIds }, restaurantId },
          select: { id: true, storageKey: true },
        })
      ).map((photo) => [photo.id, photo.storageKey]),
    );
    const taken = new Set<string>();
    for (const item of items) {
      const key = item.photoId === null ? undefined : stored.get(item.photoId);
      if (key === undefined) continue;
      const content = await this.largestRendition(key);
      if (content === undefined) continue;
      files.set(`${MENU_FILE_PHOTOS}/${menuFilePhotoName(item, 'webp', taken)}`, content);
    }
    files.set(MENU_FILE_README, Buffer.from(t('menuFile.readme').replace(/\n/g, '\r\n'), 'utf8'));
    return storedZip(files);
  }

  /**
   * Opens a menu file, keeps it for the review, and answers with the names to map (with this PC's
   * ones of the same name), every dish, every photo with its match, and the check with those.
   */
  async load(principal: Principal, data: Buffer): Promise<MenuFileReview> {
    await this.removeOld();
    const content = await readMenuFile(data, { checkPhotos: true });
    const id = newId();
    await mkdir(this.folder, { recursive: true });
    await writeFile(this.pathOf(id), data, { mode: 0o600 });

    const [taxGroups, stations] = await this.namesOnThisPc(principal.restaurantId);
    const names = menuFileNames(content.sheets);
    const suggest = (list: readonly string[], onPc: readonly { id: string; name: string }[]) =>
      list.map((name) => ({
        name,
        suggestedId: onPc.find((entry) => fold(entry.name) === fold(name))?.id ?? null,
      }));
    const suggestedTaxGroups = suggest(names.taxGroups, taxGroups);
    const suggestedStations = suggest(names.stations, stations);
    const dishes = menuFileDishes(content.sheets);
    const matches = this.matchesOf(content, dishes);
    const report = await this.imports.checkSheets(
      principal,
      this.renamed(
        content.sheets,
        {
          taxGroups: chosen(suggestedTaxGroups),
          stations: chosen(suggestedStations),
        },
        taxGroups,
        stations,
      ),
    );
    return {
      id,
      kind: content.kind,
      names: { taxGroups: suggestedTaxGroups, stations: suggestedStations },
      dishes: dishes.map((dish) => ({
        ...dish,
        sizes: [...dish.sizes],
        addOnGroups: [...dish.addOnGroups],
      })),
      photos: content.photos.map((photo, index) => ({
        file: photo.file,
        dish: matches[index]?.itemId ?? null,
        by: matches[index]?.by ?? null,
        thumbnailBase64: photo.thumbnail?.data.toString('base64') ?? '',
      })),
      report,
    };
  }

  /** The check of a loaded file with the manager's choices; nothing is written. */
  async check(
    principal: Principal,
    fileId: string,
    choices: MenuFileChoices,
  ): Promise<MenuImportReport> {
    const content = await this.loaded(fileId);
    const [taxGroups, stations] = await this.namesOnThisPc(principal.restaurantId);
    return this.imports.checkSheets(
      principal,
      this.renamed(content.sheets, choices, taxGroups, stations),
    );
  }

  /**
   * Adds a loaded file to the draft: checked again, then its chosen photos stored (as uploads
   * are), then the dishes written with them in one transaction. The loaded file is then removed.
   */
  async import(
    principal: Principal,
    fileId: string,
    choices: MenuFileChoices,
  ): Promise<MenuFileImportResult> {
    const content = await this.loaded(fileId);
    const [taxGroups, stations] = await this.namesOnThisPc(principal.restaurantId);
    const sheets = this.renamed(content.sheets, choices, taxGroups, stations);
    // Checked first, so a file with problems stores no photos.
    const checked = await this.imports.checkSheets(principal, sheets);
    if (!checked.ok) return { report: checked, photos: 0 };

    const dishes = new Set(menuFileDishes(content.sheets).map((dish) => fold(dish.name)));
    const byFile = new Map(content.photos.map((photo) => [photo.file, photo]));
    const photoIds = new Map<string, string>();
    for (const choice of choices.photos) {
      const photo = byFile.get(choice.file);
      if (photo === undefined || choice.dish === null) continue;
      const dish = fold(choice.dish);
      // The first photo chosen for a dish is its photo.
      if (!dishes.has(dish) || photoIds.has(dish)) continue;
      photoIds.set(dish, (await this.photos.uploadContent(principal, photo.content)).id);
    }
    const report = await this.imports.commitSheets(
      principal,
      sheets,
      { format: 'MENU_FILE', file: content.kind, photos: String(photoIds.size) },
      photoIds,
    );
    if (report.committed) await rm(this.pathOf(fileId), { force: true });
    return { report, photos: report.committed ? photoIds.size : 0 };
  }

  private matchesOf(
    content: MenuFileContent,
    dishes: readonly { name: string; shortCode: string | null }[],
  ) {
    return matchPhotos(
      content.photos.map((photo) => photo.file),
      dishes.map((dish) => ({ id: dish.name, name: dish.name, shortCode: dish.shortCode })),
    );
  }

  /** The sheets with the file's names replaced by the chosen tax groups and stations' names. */
  private renamed(
    sheets: MenuImportSheets,
    choices: Pick<MenuFileChoices, 'taxGroups' | 'stations'>,
    taxGroups: readonly { id: string; name: string }[],
    stations: readonly { id: string; name: string }[],
  ): MenuImportSheets {
    const mapping = (
      list: readonly { name: string; id: string }[],
      onPc: readonly { id: string; name: string }[],
    ) => {
      const names = new Map(onPc.map((entry) => [entry.id, entry.name]));
      return new Map(
        list.flatMap((choice) => {
          const name = names.get(choice.id);
          return name === undefined ? [] : [[choice.name, name] as const];
        }),
      );
    };
    return renameMenuFileNames(sheets, {
      taxGroups: mapping(choices.taxGroups, taxGroups),
      stations: mapping(choices.stations, stations),
    });
  }

  private async namesOnThisPc(restaurantId: string) {
    const active = { restaurantId, archivedAt: null };
    return Promise.all([
      this.prisma.taxGroup.findMany({ where: active, select: { id: true, name: true } }),
      this.prisma.station.findMany({ where: active, select: { id: true, name: true } }),
    ]);
  }

  private async loaded(fileId: string): Promise<MenuFileContent> {
    let data: Buffer;
    try {
      data = await readFile(this.pathOf(fileId));
    } catch {
      throw new AppError(
        404,
        'MENU_FILE_NOT_FOUND',
        'That menu file is no longer here (files are kept for a day). Load it again.',
      );
    }
    return readMenuFile(data, { checkPhotos: false });
  }

  /** The id is a UUID (checked by the contract), so the path stays in the folder. */
  private pathOf(fileId: string): string {
    return join(this.folder, `${fileId}.zip`);
  }

  /** Loaded files nobody imported within a day. */
  private async removeOld(now = Date.now()): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.folder);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(this.folder, name);
      const info = await stat(path).catch(() => undefined);
      if (info !== undefined && now - info.mtimeMs > KEEP_LOADED_MS) {
        await rm(path, { force: true });
      }
    }
  }

  private async largestRendition(storageKey: string): Promise<Buffer | undefined> {
    for (const width of [...PHOTO_WIDTHS].reverse()) {
      if (await this.photos.store.exists(storageKey, width)) {
        return readFile(this.photos.store.fileOf(storageKey, width));
      }
    }
    return undefined;
  }
}

/** The suggested matches as choices. */
function chosen(names: readonly { name: string; suggestedId: string | null }[]) {
  return names.flatMap((entry) =>
    entry.suggestedId === null ? [] : [{ name: entry.name, id: entry.suggestedId }],
  );
}
