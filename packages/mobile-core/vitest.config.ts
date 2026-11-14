import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The browser glue runs only in a browser: the phone web e2e covers it (P9-28).
      exclude: [
        'src/index.ts',
        'src/testing/**',
        'src/web/index.ts',
        'src/web/browser-environment.ts',
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
});
