import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000, // Extended timeout for video processing tests
    hookTimeout: 30000,
  },
  esbuild: {
    target: 'es2022'
  }
});