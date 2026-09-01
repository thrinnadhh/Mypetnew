module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/**/*.test.ts", "<rootDir>/**/*.test.tsx"],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
  coverageThreshold: {
    global: {
      statements: 36,
      branches: 28,
      functions: 36,
      lines: 40
    },
    "src/test-support/**/*.{ts,tsx}": {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90
    }
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"]
};
