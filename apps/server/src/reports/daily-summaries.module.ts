import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import {
  DAILY_SUMMARY_OPTIONS,
  DailySummariesJob,
  DEFAULT_DAILY_SUMMARY_OPTIONS,
  TEST_DAILY_SUMMARY_OPTIONS,
} from './daily-summaries.job.js';
import { DailySummariesService } from './daily-summaries.service.js';

/**
 * The daily summaries (P9-27): written by day-end, read by the reports, kept whole by their job.
 * Its own module so day-end can use it without the reports' dependencies.
 */
@Module({
  providers: [
    DailySummariesService,
    DailySummariesJob,
    {
      provide: DAILY_SUMMARY_OPTIONS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.nodeEnv === 'test' ? TEST_DAILY_SUMMARY_OPTIONS : DEFAULT_DAILY_SUMMARY_OPTIONS,
    },
  ],
  exports: [DailySummariesService, DailySummariesJob],
})
export class DailySummariesModule {}
