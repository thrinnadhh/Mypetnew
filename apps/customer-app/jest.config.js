module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/auth/**/*.ts',
    'src/contracts/**/*.ts',
    'src/navigation/**/*.ts',
    'src/services/**/*.ts',
    'src/utils/**/*.ts',
    '!src/**/__tests__/**',
  ],
  coverageReporters: ['text', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 85,
      lines: 80,
    },
  },
};
