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
const views = ['reimbursements', 'invoices', 'desjardins', 'blue-cross', 'finances', 'savings', 'groceries', 'notifications', 'other', 'today', 'plan', 'more'];
let browser, page; const errors = [], metrics = [];
try {
  await mkdir(output, { recursive: true }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
  browser = await chromium.launch({ headless: true });
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
      assert.equal(colors.scheme, 'light', 'Explicit supported light theme remains coherent under dark system preference');
      assert.equal(colors.canvas, 'rgb(245, 246, 248)'); assert.equal(colors.ink, 'rgb(32, 33, 36)'); assert.equal(colors.accent, 'rgb(36, 99, 211)');
      for (const value of [colors.ink, colors.muted, colors.accent]) for (const background of [colors.canvas, 'rgb(255, 255, 255)']) assert.ok(ratio(value, background) >= 4.5);
      for (const value of [colors.success, colors.warning, colors.danger]) assert.ok(ratio(value, 'rgb(255, 255, 255)') >= 4.5);
      assert.ok(ratio(colors.boundary, 'rgb(255, 255, 255)') >= 3);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) console.log('OVERFLOW', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].map(e => ({ tag: e.tagName, cls: e.className, right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width, position: getComputedStyle(e).position, overflow: getComputedStyle(e).overflowX })).filter(e => e.width && e.right > innerWidth + 1))));
      assert.equal(overflow, false, `${view} ${width} overflow`);
      assert.equal(await page.locator('main h1').first().evaluate(e => getComputedStyle(e).fontSize), '20px');
      if (['invoices', 'desjardins', 'blue-cross'].includes(view)) {
        const bell = await page.getByRole('button', { name: 'Ouvrir les notifications', exact: true }).boundingBox();
        const tabs = page.getByRole('navigation', { name: 'Document sources', exact: true });
        for (const button of await tabs.getByRole('button').all()) {
          const box = await button.boundingBox();
          assert.ok(box.x + box.width <= bell.x || box.y >= bell.y + bell.height, 'Source tab label/control must not sit beneath notification bell');
          await button.click({ trial: true });
        }
      }
      metrics.push({ view, width, colorScheme, overflow: false });
      if (colorScheme === 'light') await page.screenshot({ path: join(output, `${view}-${width}.png`), fullPage: true });
      if (view === 'reimbursements') {
        const before = await page.evaluate(() => localStorage.getItem('familyhub.reimbursements.v1'));
        const trigger = page.getByRole('button', { name: 'Filters', exact: true });
        for (const closeWith of ['escape', 'close']) {
          await trigger.focus(); await trigger.press('Enter');
          const dialog = page.getByRole('dialog', { name: 'Filter claims', exact: true }); await dialog.waitFor();
          for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(e => e.contains(document.activeElement)), true); }
          if (colorScheme === 'light' && closeWith === 'escape') await page.screenshot({ path: join(output, `claims-dialog-${width}.png`) });
          if (closeWith === 'escape') await page.keyboard.press('Escape'); else await dialog.getByRole('button', { name: 'Close Filter claims', exact: true }).click();
          await dialog.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('familyhub.reimbursements.v1')), before);
      }
      await page.close();
    }
    // Use actual navigation controls and browser history; no storage/route hacks.
    page = await context.newPage(); await page.goto(base + '?view=other');
    const nav = page.locator(width <= 760 ? '.bottom-nav' : '.app-rail nav');
    await nav.getByRole('button', { name: 'Courses', exact: true }).click(); await page.getByRole('button', { name: 'Comparaisons masquées', exact: true }).click();
    await nav.getByRole('button', { name: 'Finances', exact: true }).click(); await page.goBack(); await page.getByRole('heading', { name: 'Courses', exact: true }).waitFor();
    await page.goForward(); await page.getByRole('heading', { name: 'Finances', exact: true }).waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []); await writeFile(join(output, 'report.json'), JSON.stringify({ metrics, errors }, null, 2));
  console.log('PASS: neutral theme, semantic contrast, 12 routes x4 widths x2 system preferences, native-dialog focus/return, navigation/history and preserved synthetic state.');
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
