/** Real settings controls; isolated static app, fictitious health transport only. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, relative } from 'node:path';
import { once } from 'node:events';

const root = resolve('apps/web/dist'), output = resolve('output/playwright/settings-connection');
const A = 'https://connection-a.invalid', B = 'https://connection-b.invalid';
const original = { Endpoint: A, ApiKey: 'synthetic-key-a', ConnectedAt: '2026-11-01T00:00:00Z' };
const cases = ['normal', 'normal-error', 'save-late-success', 'save-late-error', 'edit-late-success', 'edit-late-error', 'key-late-success', 'aba-late-success', 'leave-late-success', 'new-test-old-error'];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/familyhub/, '');
  const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
  if (relative(root, file).startsWith('..')) return response.writeHead(403).end();
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
let browser;
const results = [];
try {
  await mkdir(output, { recursive: true }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) for (const scenario of cases) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], external = [], requests = [], waiting = [], receivedCallbacks = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(initial => {
      localStorage.setItem('familyhub.worker.v1', JSON.stringify(initial));
      window.__healthBodiesRead = 0;
      const fetchOriginal = window.fetch;
      window.fetch = async (...args) => {
        const response = await fetchOriginal(...args);
        if (String(args[0]).endsWith('/health')) {
          const json = response.json.bind(response);
          response.json = async () => { try { return await json(); } finally { window.__healthBodiesRead++; } };
        }
        return response;
      };
    }, original);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (![A, B].includes(url.origin)) { external.push(url.origin); return route.abort(); }
      assert.equal(request.method(), 'GET', 'No private mutation or task dispatch');
      requests.push({ origin: url.origin, path: url.pathname });
      if (url.pathname === '/health') {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        waiting.push({ release, origin: url.origin });
        receivedCallbacks.shift()?.();
        const failure = await gate;
        return route.fulfill({ status: failure ? 503 : 200, json: failure ? { error: 'Synthetic health failure' } : { status: 'ok', version: url.origin === A ? 'fixture-A' : 'fixture-B', codex: 'synthetic' } });
      }
      return route.fulfill({ json: { status: 'ok', items: [], events: [], records: [], jobs: [] } });
    });
    await page.goto(base + '?view=more');
    const endpoint = page.getByLabel('Worker endpoint'), key = page.getByLabel('Pairing key');
    const panel = page.locator('.surface').filter({ has: page.getByRole('heading', { name: 'FamilyHub worker', exact: true }) });
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('familyhub.worker.v1')));
    async function start(index) {
      const received = new Promise(resolve => receivedCallbacks.push(resolve));
      await panel.getByRole('button', { name: 'Test connection', exact: true }).click(); await received;
      assert.equal(waiting.length, index + 1);
    }
    async function finish(index, failure, count) {
      waiting[index].release(failure);
      await page.waitForFunction(expected => window.__healthBodiesRead === expected, count);
      // Response JSON has been consumed by the real client. Let React commit it.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await endpoint.waitFor(); assert.equal(await key.getAttribute('type'), 'password');
    if (scenario === 'leave-late-success') await endpoint.fill(B);
    await start(0);
    if (scenario.startsWith('save-')) {
      await endpoint.fill(B); await panel.getByRole('button', { name: 'Save', exact: true }).click(); assert.equal((await stored()).Endpoint, B);
    } else if (scenario.startsWith('edit-') || scenario === 'new-test-old-error') await endpoint.fill(B);
    else if (scenario === 'key-late-success') await key.fill('synthetic-key-b');
    else if (scenario === 'aba-late-success') { await endpoint.fill(B); await endpoint.fill(A); }
    else if (scenario === 'leave-late-success') {
      await page.getByRole('button', { name: 'Projets', exact: true }).first().click();
      await page.locator('.project-tiles').waitFor();
    }
    if (scenario === 'new-test-old-error') {
      await start(1); await finish(1, false, 1);
      assert.equal((await stored()).Endpoint, B);
      await finish(0, true, 2);
    } else await finish(0, scenario.endsWith('error'), 1);
    if (scenario === 'leave-late-success') { assert.deepEqual(await stored(), original); await page.goBack(); await endpoint.waitFor(); }
    const saved = await stored();
    if (scenario === 'normal' || scenario === 'new-test-old-error') {
      const expected = scenario === 'normal' ? A : B;
      assert.equal(saved.Endpoint, expected); assert.notEqual(saved.ConnectedAt, original.ConnectedAt);
      assert.equal(await endpoint.inputValue(), expected); assert.equal(await key.inputValue(), original.ApiKey);
      assert.match(await panel.innerText(), scenario === 'normal' ? /fixture-A/i : /fixture-B/i);
      assert.equal(await panel.getByRole('alert').count(), 0);
    } else {
      assert.deepEqual(saved, scenario.startsWith('save-') ? { ...original, Endpoint: B } : original);
      assert.equal(await endpoint.inputValue(), scenario.startsWith('edit-') || scenario.startsWith('save-') ? B : A);
      assert.equal(await key.inputValue(), scenario === 'key-late-success' ? 'synthetic-key-b' : original.ApiKey);
      assert.equal(await panel.locator('.inline-status.success').count(), 0, 'No obsolete success indication');
      if (scenario === 'normal-error') assert.match(await panel.getByRole('alert').innerText(), /Synthetic health failure/);
      else assert.equal(await panel.getByRole('alert').count(), 0, 'No obsolete error indication');
    }
    assert.equal(await panel.getByRole('button', { name: 'Test connection', exact: true }).isEnabled(), true);
    assert.equal(requests.filter(r => r.path === '/health').length, scenario === 'new-test-old-error' ? 2 : 1, 'No automatic retry');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    // Use the keyboard for the meaningful form controls, without exposing key contents.
    await endpoint.focus(); await page.keyboard.press('Tab'); assert.equal(await key.evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Tab'); assert.equal(await panel.getByRole('button', { name: 'Save', exact: true }).evaluate(el => document.activeElement === el), true);
    if (width === 390 && ['normal', 'normal-error', 'save-late-success'].includes(scenario) || width === 320 && scenario === 'save-late-success') await panel.screenshot({ path: join(output, `${scenario}-${width}.png`) });
    results.push({ width, scenario, savedEndpoint: saved.Endpoint, requestCount: requests.length, healthReads: requests.filter(r => r.path === '/health').length, errors, external, keyboardControls: true, noOverflow: true });
    await context.close(); console.log(`Settings connection PASS ${width} ${scenario}`);
  }
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ synthetic: true, workerStarted: false, results }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
