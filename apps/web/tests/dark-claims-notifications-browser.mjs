/** Contrast and keyboard QA on the built PWA; invented claims and notifications, no live worker. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { once } from 'node:events';

const dist = resolve(process.env.FAMILYHUB_BROWSER_DIST ?? 'apps/web/dist');
const output = resolve('output/playwright/dark-claims-notifications');
const fixture = JSON.parse(await readFile('apps/web/tests/fixtures/household.json', 'utf8'));
const syntheticEvent = {
  id: 'synthetic-reimbursement', kind: 'reimbursement', title: 'Synthetic reimbursement update',
  detail: 'Synthetic evidence for dark-mode contrast.', target: { view: 'reimbursements' },
  createdAt: '2026-10-10T12:00:00Z', baseline: false, active: true, actionable: true,
};
const notificationState = {
  revision: 'synthetic', events: [syntheticEvent], preferences: { reimbursement: true },
  devices: [], sourceErrors: [], pushConfigured: false, lifecycleSupported: true,
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/familyhub/, '');
  const file = resolve(dist, '.' + (path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(dist + sep)) return res.writeHead(403).end();
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'text/plain');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
async function contrast(locator, minimum) {
  await locator.waitFor();
  const sample = await locator.evaluate(el => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Composite transparent badges and controls over their actual parent surfaces.
    const chain = [];
    for (let node = el; node; node = node.parentElement) chain.unshift(node);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    for (const node of chain) {
      ctx.fillStyle = getComputedStyle(node).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
    }
    const before = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    ctx.fillStyle = getComputedStyle(el).color;
    ctx.fillRect(0, 0, 1, 1);
    return { background: before, foreground: [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) };
  });
  const luma = channels => channels.map(v => {
    const c = v / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  const a = luma(sample.foreground), b = luma(sample.background);
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= minimum, JSON.stringify(sample));
}
async function keyboardDialog(page, trigger, screenshot) {
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await contrast(dialog, 4.5);
  const backdrop = await dialog.evaluate(el => getComputedStyle(el, '::backdrop').backgroundColor);
  assert.notEqual(backdrop, 'rgba(0, 0, 0, 0)');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Focus remains inside the active dialog');
  }
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await trigger.evaluate(el => el === document.activeElement), 'Closing the dialog restores its trigger focus');
}
await mkdir(output, { recursive: true });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light', locale: 'en-CA', reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(({ state }) => {
      localStorage.setItem('familyhub.reimbursements.v1', JSON.stringify(state));
      localStorage.setItem('familyhub.worker.v1', JSON.stringify({ Endpoint: 'https://dark-fixture.invalid', ApiKey: 'synthetic-only' }));
    }, { state: fixture.state });
    const external = [], errors = [];
    const page = await context.newPage();
    page.on('pageerror', err => errors.push(err.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (url.hostname !== 'dark-fixture.invalid') { external.push(url.hostname); return route.abort(); }
      assert.ok(['GET', 'OPTIONS'].includes(route.request().method()), 'Dark pages must not mutate the paired worker');
      const payload = url.pathname === '/invoices' ? fixture.snapshot : url.pathname === '/notifications' ? notificationState : { status: 'ok', version: '2.30.0', state: 'error' };
      await route.fulfill({ json: payload, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    });

    await page.goto(base + '?view=more');
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
    await page.goto(base + '?view=reimbursements');
    await page.locator('.expense-card').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en-CA');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), 'dark');
    await contrast(page.locator('.workflow-tabs button.active'), 4.5);
    await contrast(page.locator('.workflow-tabs button.active span').last(), 4.5);
    await contrast(page.locator('.coverage-overview summary'), 4.5);
    const nav = page.locator('.bottom-nav:visible, .app-rail nav:visible');
    await contrast(nav.locator('button[aria-current="page"]'), 4.5);
    await contrast(nav.locator('button:not([aria-current])').first(), 4.5);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No Claims overflow');
    await page.screenshot({ path: join(output, `claims-${width}.png`), animations: 'disabled' });
    await keyboardDialog(page, page.getByRole('button', { name: 'Filters', exact: true }), join(output, `claim-filters-${width}.png`));

    await page.goto(base + '?view=notifications');
    await contrast(page.locator('.notification-card[data-kind="reimbursement"] .notification-category-icon'), 4.5);
    await contrast(page.locator('.notification-card h2').first(), 4.5);
    await keyboardDialog(page, page.getByRole('button', { name: 'Preferences', exact: true }), join(output, `notification-settings-${width}.png`));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No Notifications overflow');
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    console.log(`PASS dark Claims + Notifications at ${width}px: selected and inactive controls, warning, icon, dialogs and keyboard focus`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
