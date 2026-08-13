module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/**/*.test.ts", "<rootDir>/**/*.test.tsx"],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"]
};
