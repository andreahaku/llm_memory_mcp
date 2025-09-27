module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      transpileOnly: true,
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: [
    '**/tests/**/*.test.ts',
    '!**/spike/**/*',
    '!**/node_modules/**/*',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/spike/',
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/video/**/*',
    '!src/cli/**/*',
  ],
  testTimeout: 30000,
  verbose: true,
};