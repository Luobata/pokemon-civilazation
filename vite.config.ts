import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: { input: { game: 'index.html', audit: 'audit.html', editor: 'editor.html', multiplayer: 'multiplayer.html', guide: 'guide.html' } },
  },
  test: {
    environment: 'node',
    include: ['tests/core/**/*.test.ts', 'tests/ai/**/*.test.ts', 'tests/tools/**/*.test.ts', 'tests/network/**/*.test.ts', 'tests/editor/**/*.test.ts'],
  },
});
