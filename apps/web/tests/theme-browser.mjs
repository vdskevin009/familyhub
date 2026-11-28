/** Built PWA, disposable contexts and synthetic Claims fixtures. Never touches a real worker. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, relative } from 'node:path';
import { once } from 'node:events';
const root = resolve('apps/web/dist'), output = resolve('artifacts/theme');
const fixture = JSON.parse(await readFile('apps/web/tests/fixtures/household.json', 'utf8'));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/familyhub/, '');
  const file = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (relative(root, file).startsWith('..')) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'text/plain'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
const ratio = (a, b) => {
  const lum = x => { const c = x.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const expectedCanvas = { light: 'rgb(245, 246, 248)', dark: 'rgb(16, 20, 28)' };
const expectedSurface = { light: 'rgb(255, 255, 255)', dark: 'rgb(25, 34, 50)' };
const views = ['reimbursements', 'invoices', 'desjardins', 'blue-cross', 'finances', 'savings', 'groceries', 'notifications', 'other', 'today', 'plan', 'more'];
let browser, page; const errors = [], metrics = [];
try {
  await mkdir(output, { recursive: true }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const colorScheme of ['light', 'dark']) for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('https://theme-fixture.invalid/**', async route => {
      assert.equal(route.request().method(), 'GET', 'Theme inspection must not submit a mutation');
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(path === '/invoices' ? fixture.snapshot : { status: 'ok', capabilities: [], state: 'up-to-date', lastSuccess: '2026-10-12T00:00:00Z' }) });
    });
    for (const view of views) {
      page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ state, paired }) => {
        localStorage.setItem('familyhub.reimbursements.v1', JSON.stringify(state));
        if (paired) localStorage.setItem('familyhub.worker.v1', JSON.stringify({ Endpoint: 'https://theme-fixture.invalid', ApiKey: 'synthetic-only' }));
        else localStorage.removeItem('familyhub.worker.v1');
      }, { state: fixture.state, paired: ['reimbursements', 'invoices', 'desjardins', 'blue-cross'].includes(view) });
      await page.goto(base + '?view=' + view); await page.locator('main h1').first().waitFor();
      if (view === 'reimbursements') await page.locator('.expense-card').first().waitFor();
      const colors = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
        const color = token => { const e = document.createElement('span'); e.style.color = `var(${token})`; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; };
        return { scheme: style.colorScheme, canvas: body.backgroundColor, ink: body.color, muted: color('--muted'), accent: color('--accent'), success: color('--success'), warning: color('--warning'), danger: color('--danger'), boundary: color('--control-line') };
      });
      assert.equal(colors.scheme, colorScheme, 'Unconfigured appearance follows the system');
      assert.equal(colors.canvas, expectedCanvas[colorScheme]);
      if (colorScheme === 'light') {
        assert.equal(colors.ink, 'rgb(32, 33, 36)'); assert.equal(colors.accent, 'rgb(36, 99, 211)');
      }
      for (const value of [colors.ink, colors.muted, colors.accent]) for (const background of [colors.canvas, expectedSurface[colorScheme]]) assert.ok(ratio(value, background) >= 4.5);
      for (const value of [colors.success, colors.warning, colors.danger]) assert.ok(ratio(value, expectedSurface[colorScheme]) >= 4.5);
      assert.ok(ratio(colors.boundary, expectedSurface[colorScheme]) >= 3);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) console.log('OVERFLOW', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].map(e => ({ tag: e.tagName, cls: e.className, right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width, position: getComputedStyle(e).position, overflow: getComputedStyle(e).overflowX })).filter(e => e.width && e.right > innerWidth + 1))));
      assert.equal(overflow, false, `${view} ${width} overflow`);
      const titleSize = await page.locator('main h1').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
      if (view === 'today') assert.ok(titleSize >= 23 && titleSize <= 30);
      else if (view === 'finances') assert.ok(titleSize >= 26 && titleSize <= 34, 'Approved finance title remains legible across viewport sizes');
      else assert.equal(titleSize, 20);
      if (['invoices', 'desjardins', 'blue-cross'].includes(view)) {
        const bell = await page.getByRole('button', { name: 'Open notifications', exact: true }).boundingBox();
        const tabs = page.getByRole('navigation', { name: 'Document sources', exact: true });
        for (const button of await tabs.getByRole('button').all()) {
          const box = await button.boundingBox();
          assert.ok(box.x + box.width <= bell.x || box.y >= bell.y + bell.height, 'Source tab label/control must not sit beneath notification bell');
          await button.click({ trial: true });
        }
      }
      metrics.push({ view, width, colorScheme, overflow: false });
      if (colorScheme === 'light' || [320, 390, 1440].includes(width)) await page.screenshot({ path: join(output, `${view}-${colorScheme}-${width}.png`), fullPage: true });
      if (view === 'reimbursements') {
        const before = await page.evaluate(() => localStorage.getItem('familyhub.reimbursements.v1'));
        const trigger = page.getByRole('button', { name: 'Filters', exact: true });
        for (const closeWith of ['escape', 'close']) {
          await trigger.focus(); await trigger.press('Enter');
          const dialog = page.getByRole('dialog', { name: 'Filter claims', exact: true }); await dialog.waitFor();
          for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(e => e.contains(document.activeElement)), true); }
          if (closeWith === 'escape') await page.screenshot({ path: join(output, `claims-dialog-${colorScheme}-${width}.png`) });
          if (closeWith === 'escape') await page.keyboard.press('Escape'); else await dialog.getByRole('button', { name: 'Close Filter claims', exact: true }).click();
          await dialog.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('familyhub.reimbursements.v1')), before);
      }
      await page.close();
    }
    // Use actual navigation controls and browser history; no storage/route hacks.
    page = await context.newPage(); await page.goto(base + '?view=other');
    const nav = page.locator('.bottom-nav:visible, .app-rail nav:visible');
    await nav.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.locator('.project-tiles').getByRole('button', { name: 'Groceries', exact: true }).click();
    await page.getByRole('button', { name: 'Purchases', exact: true }).click();
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), expectedCanvas[colorScheme]);
    assert.equal(await page.locator('main h1').first().evaluate(e => getComputedStyle(e).fontSize), '20px');
    assert.equal(await page.getByRole('button', { name: 'Catalogue', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Cheaper elsewhere', exact: true }).count(), 0);
    await nav.getByRole('button', { name: 'More', exact: true }).click();
    await nav.getByRole('button', { name: 'Finances', exact: true }).click();
    await page.goBack(); await page.getByRole('heading', { name: 'More', exact: true }).waitFor();
    await page.goBack(); await page.getByRole('heading', { name: 'Groceries', exact: true }).waitFor();
    await page.goForward(); await page.getByRole('heading', { name: 'More', exact: true }).waitFor();
    await page.goForward(); await page.getByRole('heading', { name: 'Finances', exact: true }).waitFor();
    await context.close();
  }
  // Delay the app bundle so this asserts actual HTML bootstrap, before React or CSS can mask a flash.
  const prefs = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'dark', serviceWorkers: 'block' });
  const fixed = await prefs.newPage();
  await fixed.addInitScript(() => localStorage.setItem('familyhub.appearance.v1', 'light'));
  let release;
  const waitForBundle = new Promise(resolve => { release = resolve; });
  await fixed.route('**/assets/*.js', async route => { await waitForBundle; await route.continue(); });
  await fixed.goto(base + '?view=more', { waitUntil: 'commit' });
  await fixed.waitForFunction(() => document.documentElement.dataset.theme === 'light' && getComputedStyle(document.documentElement).backgroundColor === 'rgb(245, 246, 248)');
  assert.equal(await fixed.locator('#root').innerText(), '', 'No React was loaded to set the early colour');
  release();
  const theme = fixed.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.waitFor();
  assert.equal(await theme.inputValue(), 'light');
  await fixed.emulateMedia({ colorScheme: 'light' });
  await theme.selectOption('dark');
  assert.equal(await fixed.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await fixed.locator('meta[name="theme-color"]').getAttribute('content'), '#10141c');

  // Use a separate page without a forced preference to verify persistence and storage synchronization.
  const shared = await prefs.newPage();
  await shared.emulateMedia({ colorScheme: 'light' });
  let releaseDark;
  const waitForDarkBundle = new Promise(resolve => { releaseDark = resolve; });
  await shared.route('**/assets/*.js', async route => { await waitForDarkBundle; await route.continue(); });
  await shared.goto(base + '?view=more', { waitUntil: 'commit' });
  await shared.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.documentElement).backgroundColor === 'rgb(16, 20, 28)');
  assert.equal(await shared.locator('#root').innerText(), '', 'Persisted Dark is present before hydration even on a light OS');
  assert.equal(await shared.locator('meta[name="theme-color"]').getAttribute('content'), '#10141c');
  releaseDark();
  const sharedTheme = shared.getByRole('combobox', { name: 'Theme', exact: true });
  await sharedTheme.waitFor();
  assert.equal(await sharedTheme.inputValue(), 'dark');
  await shared.reload();
  await sharedTheme.waitFor(); assert.equal(await sharedTheme.inputValue(), 'dark');
  await shared.emulateMedia({ colorScheme: 'light' });
  assert.equal(await shared.evaluate(() => document.documentElement.dataset.theme), 'dark', 'Explicit Dark ignores OS preference');
  await sharedTheme.selectOption('system');
  await shared.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await shared.emulateMedia({ colorScheme: 'dark' });
  await shared.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await fixed.waitForFunction(() => document.querySelector('.settings-appearance select')?.value === 'system');
  await prefs.close();
  assert.deepEqual(errors, []); await writeFile(join(output, 'report.json'), JSON.stringify({ metrics, errors }, null, 2));
  console.log('PASS: neutral theme, semantic contrast, 12 routes x4 widths x2 system preferences, native-dialog focus/return, navigation/history and preserved synthetic state.');
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
