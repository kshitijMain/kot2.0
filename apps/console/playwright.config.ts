import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { fakeCameraShowing } from './e2e/fake-camera.js';

// Cloud sessions ship a Chromium build that may be older than this Playwright's: use it directly.
// CI installs the matching browser instead (`playwright install chromium webkit`).
const chromium =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

/** The phone web app's tests (P9-28) run on phones; the console's on a desktop. */
const PHONE_TESTS = /phone\.e2e\.ts$/;

/**
 * End-to-end tests of the console against the real local server and PostgreSQL (P0-14b), and of
 * the waiter app in phones' browsers (P9-28): an iPhone's (WebKit, the engine every iPhone browser
 * runs on, Chrome included) and an Android phone's (Chrome). Run after `pnpm build`:
 * `pnpm --filter @rp/console e2e`.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      testIgnore: PHONE_TESTS,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromium !== undefined && { executablePath: chromium }),
          // The camera shows the QR code of the pager the e2e test registers (P2-04b2), allowed
          // without asking.
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${fakeCameraShowing('RP-PAGER:WP-0101')}`,
          ],
        },
      },
    },
    { name: 'iphone', testMatch: PHONE_TESTS, use: { ...devices['iPhone 15'] } },
    {
      name: 'android',
      testMatch: PHONE_TESTS,
      use: {
        ...devices['Pixel 7'],
        ...(chromium !== undefined && { launchOptions: { executablePath: chromium } }),
      },
    },
  ],
});
