// The static web demo's specs (H51 site.spec.ts, H64 states.spec.ts), apart from the main e2e projects: it needs only `npm run build:site`
// and a static file server, never the CLI, a hub or dist/web. Run: npx playwright test -c test/site
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// 4393 unless SITE_PORT says otherwise: a run beside other work on the machine moves to a free one.
const PORT = Number(process.env.SITE_PORT) || 4393;
const root = join(import.meta.dirname, '..', '..');

export default defineConfig({
  testDir: '.',
  testMatch: /(site|states)\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: join(root, 'test-results', 'site'),
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `node scripts/site-server.mjs --port ${PORT}`,
    cwd: root,
    url: `http://127.0.0.1:${PORT}/worklings/`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'site-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'site-375', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
  ],
});
