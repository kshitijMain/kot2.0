import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';
import { AuditViewerService } from './audit-viewer.service.js';
import { PendingAuditService } from './pending-audit.service.js';

/** Global so every feature module can inject `AuditService` (AUD-001). */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditViewerService,
    PendingAuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService, AuditViewerService, PendingAuditService],
})
export class AuditModule {}
