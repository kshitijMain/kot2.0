import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from './audit.service.js';

/**
 * Writes the audit entries a migration queued into the hash chain (ADR-0023): a migration changes
 * records in SQL, but only the server computes the chain's hashes. Each entry is written once, in
 * the same transaction that marks it recorded, so a restart midway neither loses nor repeats one.
 */
@Injectable()
export class PendingAuditService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PendingAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.recordPending();
    } catch (error) {
      this.logger.error(`Writing queued audit entries failed: ${String(error)}`);
    }
  }

  /** Writes every queued entry; returns how many. */
  async recordPending(): Promise<number> {
    const pending = await this.prisma.pendingAuditEntry.findMany({
      where: { recordedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let recorded = 0;
    for (const entry of pending) {
      const done = await this.prisma.transaction(async (tx) => {
        const claimed = await tx.pendingAuditEntry.updateMany({
          where: { id: entry.id, recordedAt: null },
          data: { recordedAt: new Date() },
        });
        if (claimed.count === 0) return false;
        await this.audit.record(tx, {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          actorId: null,
          deviceId: null,
          restaurantId: entry.restaurantId,
          before: entry.before,
          after: entry.after,
          reason: entry.reason,
        });
        return true;
      });
      if (done) recorded += 1;
    }
    return recorded;
  }
}
