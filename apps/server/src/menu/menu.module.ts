import { AiMenuImportService } from './import/ai-menu-import.service.js';
import { AiMenuImportController, MenuImportController } from './import/menu-import.controller.js';
import { MenuFileController } from './import/menu-file.controller.js';
import { MenuFileService } from './import/menu-file.service.js';
import { MenuImportService } from './import/menu-import.service.js';
import { Module } from '@nestjs/common';
import { MenuAdminController } from './menu-admin.controller.js';
import { MenuAdminService } from './menu-admin.service.js';
import { MenuPublishController } from './menu-publish.controller.js';
import { MenuPublishService } from './menu-publish.service.js';
import { CloudModule } from '../cloud/cloud.module.js';
import { PhotosModule } from '../photos/photos.module.js';
import { SettingsModule } from '../settings/settings.module.js';

/** The menu (P1-03): the draft managers edit, combos, availability and published versions. */
@Module({
  imports: [SettingsModule, CloudModule, PhotosModule],
  controllers: [
    MenuAdminController,
    MenuPublishController,
    MenuImportController,
    MenuFileController,
    AiMenuImportController,
  ],
  providers: [
    MenuAdminService,
    MenuPublishService,
    MenuImportService,
    MenuFileService,
    AiMenuImportService,
  ],
  exports: [MenuAdminService, MenuPublishService],
})
export class MenuModule {}
