/** Jest with the React Native preset, as in `@rp/ui-native`; the Keystore module is mocked. */
module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/test/**/*.test.tsx'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  // The first render in each test file transforms and loads React Native's renderer. On a CI runner
  // with every package's tests running at once and a cold transform cache, that alone has taken
  // over 30 s, so tests get 2 minutes; CI keeps the transform cache between runs (ci.yml).
  testTimeout: 120_000,
  cacheDirectory: '<rootDir>/../../node_modules/.cache/jest',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@rp/([a-z0-9-]+)$': '<rootDir>/../../packages/$1/dist/index.js',
    '^@rp/([a-z0-9-]+)/testing$': '<rootDir>/../../packages/$1/dist/testing/index.js',
  },
  // Expo's packages ship TypeScript sources (expo-status-bar): they are compiled too, or a test
  // file with a cold transform cache cannot load the app (P9-16).
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(@react-native|react-native|@rp|expo[a-z0-9-]*|@expo)/))',
  ],
  // Root and session wire the native modules; the Android build and Maestro cover them.
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/Root.tsx', '!src/session.ts'],
  coverageThreshold: { global: { lines: 80, functions: 80, statements: 80, branches: 70 } },
};
