import { defineConfig, devices } from '@playwright/test';

// Smoke specs against a production build (`vite build` + `vite preview`): the built CSS bundle orders the stylesheets
// differently from the dev server, so overlay placement is checked here too (tests/browser-prod).
const port = Number(process.env.E2E_PROD_PORT ?? 4243);
const outDir = 'dist-e2e';

export default defineConfig({
  testDir: './tests/browser-prod',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `npx vite build --outDir ${outDir} --emptyOutDir && npx vite preview --outDir ${outDir} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
