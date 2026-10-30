import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the production build can be served from any static host or sub-path.
  base: './',
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/compiler/**', 'src/cli/**'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90, branches: 85, functions: 90 },
    },
  },
});
