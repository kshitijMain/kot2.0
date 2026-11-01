import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MdnsService } from './mdns.service.js';
import { TlsController } from './tls.controller.js';
import { TlsService } from './tls.service.js';

/** LAN TLS with the installation's private CA (P0-15, ADR-0011, SEC-001). */
@Module({
  imports: [AuthModule],
  controllers: [TlsController],
  providers: [TlsService, MdnsService],
  exports: [TlsService, MdnsService],
})
export class TlsModule {}
