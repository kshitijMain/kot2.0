import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DailySummariesService } from './daily-summaries.service.js';

/** When the summaries are brought up to date. */
export const DAILY_SUMMARY_OPTIONS = Symbol('DAILY_SUMMARY_OPTIONS');

export interface DailySummaryOptions {
  /** After the server starts; negative turns the first run off. */
  readonly startDelayMs: number;
  /** Then every so often; 0 turns the timer off (tests call `refreshAll` themselves). */
  readonly checkMs: number;
}

export const DEFAULT_DAILY_SUMMARY_OPTIONS: DailySummaryOptions = {
  startDelayMs: 30 * 1000,
  checkMs: 15 * 60 * 1000,
};
export const TEST_DAILY_SUMMARY_OPTIONS: DailySummaryOptions = { startDelayMs: -1, checkMs: 0 };

/**
 * Keeps the daily summaries whole (P9-27): soon after the server starts it sums every closed date
 * that has none (the days closed before summaries existed: the backfill), and every quarter of an
 * hour the dates a later change marked stale. Reports are right meanwhile: they read such dates
 * from the live tables.
 */
@Injectable()
export class DailySummariesJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DailySummariesJob.name);
  private start: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly summaries: DailySummariesService,
    @Inject(DAILY_SUMMARY_OPTIONS) private readonly options: DailySummaryOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.startDelayMs >= 0) {
      this.start = setTimeout(() => {
        void this.run();
      }, this.options.startDelayMs);
      this.start.unref();
    }
    if (this.options.checkMs > 0) {
      this.timer = setInterval(() => {
        void this.run();
      }, this.options.checkMs);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    clearTimeout(this.start);
    clearInterval(this.timer);
  }

  /** One run at a time; a failure is logged and tried again at the next. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.summaries.refreshAll();
    } catch (error) {
      this.logger.error(`Summing the closed business dates failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
