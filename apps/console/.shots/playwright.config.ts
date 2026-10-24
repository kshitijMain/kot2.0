import { defineConfig, devices } from '@playwright/test';

// Temporary: before/after screenshots for the Parossa redesign. Not part of the repository.
export default defineConfig({
  testDir: '.',
  testMatch: '*.shots.ts',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  globalSetup: '../e2e/global-setup.ts',
  reporter: 'list',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
