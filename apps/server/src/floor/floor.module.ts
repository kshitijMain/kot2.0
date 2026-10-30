import { Module } from '@nestjs/common';
import { LicensingModule } from '../licensing/licensing.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { FloorController, SectionsController, TablesController } from './floor.controller.js';
import { FloorService } from './floor.service.js';
import { TableQrController } from './table-qr.controller.js';
import { TableQrService } from './table-qr.service.js';
import { TableSessionsController } from './table-sessions.controller.js';
import { TableSessionsService } from './table-sessions.service.js';
import { TableTransfersService } from './table-transfers.service.js';

/** The floor (P1-02a): sections, tables and the day's waiter assignment. */
@Module({
  imports: [SettingsModule, LicensingModule],
  controllers: [
    FloorController,
    SectionsController,
    // Before TablesController, so `qr-codes` is never read as a table id.
    TableQrController,
    TablesController,
    TableSessionsController,
  ],
  providers: [FloorService, TableSessionsService, TableTransfersService, TableQrService],
  exports: [FloorService, TableSessionsService],
})
export class FloorModule {}
