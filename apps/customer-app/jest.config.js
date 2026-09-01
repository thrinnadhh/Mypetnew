module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.appointment-slot-time.setup.js'],
  collectCoverageFrom: [
    'src/auth/**/*.ts',
    'src/contracts/**/*.ts',
    'src/navigation/**/*.ts',
    'src/services/**/*.ts',
    'src/utils/**/*.ts',
    '!src/**/__tests__/**',
  ],
  coverageReporters: ['text', 'json-summary', 'lcov'],
  // Global floors are regression tripwires only; the meaningful per-module
  // gates live in scripts/check-production-coverage.cjs and are enforced in CI.
  coverageThreshold: {
    global: {
      statements: 72,
      branches: 68,
      functions: 74,
      lines: 76,
    },
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|decode-uri-component)',
  ],
};

