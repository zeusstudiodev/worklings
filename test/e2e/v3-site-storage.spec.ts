import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { expect, test } from '@playwright/test';
import { boardFrame, sheetUp } from './v3-kit.ts';

// The static demo with the browser's site data blocked (a privacy setting, some embedded views): reading
// localStorage or sessionStorage throws at the property itself. The demo has to draw and work all the same.
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary' };

let server: Server;
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const out = join(process.env.E2E_SCRATCH ?? tmpdir(), `site-${Date.now()}`);
  // Built at the root of its own address, so the spec needs no base path.
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'site', '--base', '/', '--outDir', out, '--emptyOutDir'], { stdio: 'ignore' });
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')).replace(/^([/\\])+/, '');
    let file = join(out, path);
    if (!file.startsWith(out)) file = join(out, 'index.html');
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html');
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(() => {
  server?.close();
});

test('the static demo lobby and a company draw and work with site data blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  // Page code as a string, as the other specs do, since the Node typecheck has no DOM types.
  await page.addInitScript(`(() => {
    const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: deny });
    Object.defineProperty(window, 'sessionStorage', { get: deny });
  })()`);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
  // The demo says there is no lobby of yours to go back to, and sends nobody to a repository that is not public yet.
  await expect(page.getByText(/this page has no lobby of yours to go back to/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave the demo' })).toHaveCount(0);
  await page.getByRole('button', { name: /Café Lumen/ }).first().click();
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible();
  // Still office is the one switch that keeps a setting in storage: it works for the visit.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /^Still office/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-still', 'on');
  // The views that keep something per tab or per browser: Plant Pal's proposal (the version it compares with), the
  // tasks (how they're grouped), the plan (an unsaved draft) and the dashboards (the board last viewed).
  await page.goto(`${origin}/c/plant-pal`);
  await sheetUp(page);
  await expect(page.getByRole('heading', { name: "The CEO's proposal" })).toBeVisible();
  for (const [path, board] of [['/c/demo/tasks', 'Tasks'], ['/c/demo/plan', 'Tasks'], ['/c/demo/dashboards', 'Dashboards']] as const) {
    await page.goto(`${origin}${path}`);
    await expect(boardFrame(page, board).getByRole('heading', { level: 2, name: board }), path).toBeVisible();
  }
  expect(errors).toEqual([]);
});
