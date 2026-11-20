import { defineConfig, devices } from '@playwright/test';

/** Dev server port; E2E_PORT overrides it when 4173 is taken on a shared machine (as E2E_PROD_PORT does for the production config). */
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
