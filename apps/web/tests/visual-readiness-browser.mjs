/** Existing screens, synthetic API only. Exercises freshness, stale reads and disclosed detail. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, relative } from 'node:path';
import { once } from 'node:events';

const root = resolve('apps/web/dist'), output = resolve('output/playwright/visual-readiness');
const fixture = JSON.parse(await readFile('apps/web/tests/fixtures/household.json', 'utf8'));
const api = 'https://visual-readiness-fixture.invalid';
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/familyhub/, '');
  const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
  if (relative(root, file).startsWith('..')) return response.writeHead(403).end();
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(file)] || 'text/plain');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
let browser, diagnostic;
const errors = [], external = [], mutations = [], results = [];
try {
  await mkdir(output, { recursive: true }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  async function contextFor(width, delayed = false, delayedSync = false) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const snapshot = structuredClone(fixture.snapshot); snapshot.lastSuccess = null;
    const state = { invoiceReads: 0, syncs: 0 };
    if (delayed) snapshot.items[0].Provider = 'LATE_UNMOUNTED_RESPONSE';
    await context.addInitScript(state => {
      localStorage.setItem('familyhub.reimbursements.v1', JSON.stringify(state));
      localStorage.setItem('familyhub.worker.v1', JSON.stringify({ Endpoint: 'https://visual-readiness-fixture.invalid', ApiKey: 'synthetic-only' }));
    }, fixture.state);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (url.origin !== api) { external.push(url.origin); return route.abort(); }
      if (delayedSync && request.method() === 'POST' && url.pathname === '/bluecross/sync') {
        state.syncs++; await gate;
        return route.fulfill({ json: { status: 'success', complete: true, autoImported: 1, new: 1, changed: 0, unchanged: 0 } });
      }
      if (request.method() !== 'GET') { mutations.push(url.pathname); return route.abort(); }
      if (url.pathname === '/invoices') { state.invoiceReads++; if (delayed) await gate; return route.fulfill({ json: snapshot }); }
      const current = new Date().toISOString();
      return route.fulfill({ json: { status: 'ok', version: '2.30.2', capabilities: [], state: 'up-to-date', lastSuccess: current } });
    });
    return { context, release, state };
  }
  for (const width of [320, 360, 390, 412, 768, 1440]) {
    const { context } = await contextFor(width);
    const page = await context.newPage(); diagnostic = page; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '?view=reimbursements');
    await page.locator('.expense-card').first().waitFor();
    assert.equal(await page.locator('.page-subtitle').textContent(), 'Saved results', 'missing success timestamp must never become the current time');
    assert.match(await page.locator('.reimbursement-totals > summary').innerText(), /estimate, not guaranteed/);
    assert.equal(await page.locator('.reimbursement-totals').getAttribute('open'), null, 'method and history details start disclosed on demand');
    await page.locator('.reimbursement-totals > summary').click();
    assert.equal(await page.getByRole('link', { name: 'Desjardins history', exact: true }).isVisible(), true);
    await page.locator('.reimbursement-totals > summary').click();
    const sourceTrigger = page.getByRole('button', { name: /^Sources/ }).first();
    await sourceTrigger.click();
    const dialog = page.getByRole('dialog', { name: 'Sources & sync', exact: true }); await dialog.waitFor();
    // Every collapsed native disclosure in the dialog must remain keyboard-reachable.
    const summaries = await dialog.locator('summary:visible').all();
    assert.ok(summaries.length > 0);
    const expected = await Promise.all(summaries.map(summary => summary.innerText()));
    const visited = new Set();
    for (let index = 0; index < 65; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
      const active = await page.evaluate(() => document.activeElement?.tagName === 'SUMMARY' ? document.activeElement.textContent.trim() : '');
      if (active) visited.add(active);
    }
    for (const summary of expected) assert.ok(visited.has(summary.trim()), `disclosure reachable: ${summary}`);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await sourceTrigger.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} width`);
    await page.screenshot({ path: join(output, `reimbursements-${width}.png`), fullPage: true });
    const nav = page.locator('.bottom-nav:visible, .app-rail nav:visible');
    await nav.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.locator('.project-tiles').getByRole('button', { name: 'Mortgage', exact: true }).click();
    assert.equal(await nav.locator('[aria-current="page"]').count(), 1, 'mortgage must not select both Projects and Plus');
    assert.equal(await nav.locator('[aria-current="page"]').getAttribute('aria-label') || await nav.locator('[aria-current="page"]').innerText(), 'Projects');
    results.push({ width, freshness: true, detailKeyboard: true, navigation: true, overflow: false });
    await context.close();
  }
  const { context, release } = await contextFor(390, true);
  const page = await context.newPage(); diagnostic = page; page.on('pageerror', error => errors.push(error.message));
  const started = page.waitForRequest(request => request.url() === api + '/invoices');
  await page.goto(base + '?view=reimbursements'); await started;
  await page.locator('.bottom-nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  const before = await page.evaluate(() => localStorage.getItem('familyhub.reimbursements.v1'));
  const responded = page.waitForResponse(response => response.url() === api + '/invoices');
  release(); await responded;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => localStorage.getItem('familyhub.reimbursements.v1')), before, 'a late read from a departed screen must not rewrite shared saved state');
  await context.close();
  // A sync already dispatched may finish, but a departed screen must not launch its follow-up read.
  const syncCase = await contextFor(390, false, true);
  const syncPage = await syncCase.context.newPage(); diagnostic = syncPage;
  syncPage.on('pageerror', error => errors.push(error.message));
  await syncPage.goto(base + '?view=reimbursements'); await syncPage.locator('.expense-card').first().waitFor();
  await syncPage.getByRole('button', { name: /^Sources/ }).first().click();
  const syncStarted = syncPage.waitForRequest(request => request.url() === api + '/bluecross/sync');
  await syncPage.getByRole('button', { name: 'Retry / update Blue Cross', exact: true }).click(); await syncStarted;
  await syncPage.keyboard.press('Escape');
  await syncPage.locator('.bottom-nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await syncPage.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  const readsBefore = syncCase.state.invoiceReads;
  const syncResponded = syncPage.waitForResponse(response => response.url() === api + '/bluecross/sync');
  syncCase.release(); await syncResponded;
  await syncPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(syncCase.state.invoiceReads, readsBefore, 'late sync completion must not start another shared-state refresh');
  assert.equal(syncCase.state.syncs, 1, 'synthetic sync is never replayed');
  await syncCase.context.close();
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(mutations, []);
  await writeFile(join(output, 'regressions.json'), JSON.stringify({ results, staleReadIgnored: true, lateSyncIgnored: true, syntheticSyncs: 1, errors, external, unexpectedMutations: mutations }, null, 2));
  console.log('PASS: six widths, unknown freshness, keyboard disclosures, single active navigation, late read and post-unmount sync ignored; one isolated synthetic sync, no external requests.');
} catch (error) {
  if (diagnostic && !diagnostic.isClosed()) {
    await diagnostic.screenshot({ path: join(output, 'regression-failure.png'), fullPage: true });
    await writeFile(join(output, 'regression-failure.txt'), await diagnostic.locator('body').innerText());
  }
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
