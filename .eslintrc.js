module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    'src/video/**/*',
    'src/cli/**/*',
    'benchmarks/**/*',
    'dist/**/*',
    'node_modules/**/*',
    '**/*.test.ts',
    'test-*.js'
  ],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
    'no-var': 'error',
    'no-console': 'off', // Allow console in development
  },
};