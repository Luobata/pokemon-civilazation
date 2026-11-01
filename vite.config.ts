import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: { input: { game: 'index.html', audit: 'audit.html' } },
  },
  test: {
    environment: 'node',
    include: ['tests/core/**/*.test.ts', 'tests/ai/**/*.test.ts', 'tests/tools/**/*.test.ts'],
  },
});
