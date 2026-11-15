/** Synthetic built-PWA acceptance only. No private worker, bank or provider is contacted. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { financeFixture } from '../../../tests/finance-fixture.mjs';
import { observationsFixture } from '../../../tests/finance-observations-fixture.mjs';
import { FinanceLibrary } from '../../worker/dist/finance-library.js';
import { financeSourceKey } from '../../worker/dist/finance-source-inventory-store.js';
import { SOURCE_INVENTORY_CAPABILITY as capability, validateFinanceSourceInventory } from '../../worker/dist/finance-source-inventory-model.js';

const root = resolve('apps/web/dist'), temp = await mkdtemp(join(tmpdir(), 'familyhub-source-ui-synthetic-'));
const output = resolve('output/playwright/finance-source-inventory'); await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname, file = resolve(root, '.' + pathname.replace(/^\/familyhub/, ''));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(file)] ?? 'text/html'); res.end(await readFile(file === root || pathname.endsWith('/') ? join(root, 'index.html') : file)); } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port + '/familyhub/?view=finances';
const old = new Date(Date.now() - 3 * 86400_000).toISOString(), day = old.slice(0, 10);
const unavailable = () => ({ status: 'unavailable', coverage: 'unknown', observedCount: 0 });
const source = validateFinanceSourceInventory({
  schemaVersion: 1, source: 'finances-plugin', collectedAt: old,
  accounts: Array.from({ length: 7 }, (_, i) => ({ sourceKey: financeSourceKey('account', 'synthetic-institution', 'synthetic-' + i), name: 'Compte source fictif ' + i, institution: 'Établissement fictif', kind: i < 2 ? 'credit' : 'investment', reconciliation: 'not-reconciled', balance: i === 6 ? null : { amountCents: i === 5 ? 0 : -(10001 + i), currency: i === 4 ? 'USD' : 'CAD', sourceAsOf: null }, credit: i < 2 ? { statementBalance: { amountCents: 8000, currency: 'CAD', sourceAsOf: '2020-01-01' }, minimumPayment: { amountCents: 1500, currency: 'CAD', sourceAsOf: '2020-01-02' }, paymentDueOn: '2031-02-03' } : null })),
  predictions: Array.from({ length: 29 }, (_, i) => ({ sourceKey: financeSourceKey('prediction', 'synthetic-institution', 'synthetic-stream-' + i), accountSourceKey: i % 2 ? null : financeSourceKey('account', 'synthetic-institution', 'synthetic-0'), name: 'Prévision fictive ' + i, flow: 'outflow', amount: { amountCents: 1250, currency: 'CAD' }, predictedOn: i % 2 ? '2031-02-10' : '2020-01-03', frequency: 'monthly', kind: 'forecast' })),
  availability: { accounts: { status: 'partial', coverage: 'partial', observedCount: 7 }, holdings: unavailable(), activity: unavailable(), recurring: { status: 'partial', coverage: 'partial', observedCount: 29 }, liabilities: { status: 'partial', coverage: 'partial', observedCount: 2 }, budgets: 'not-provided', goals: 'not-provided' },
});
const inventory = { capability, state: { revision: createHash('sha256').update(JSON.stringify(source)).digest('hex'), snapshot: source } };
let browser;
try {
  browser = await chromium.launch({ ...(process.env.FAMILYHUB_TEST_BROWSER_CHANNEL ? { channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL } : {}), headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const lib = new FinanceLibrary(join(temp, String(width))), before = (await lib.import({ bundle: financeFixture(), apply: true, expectedRevision: 'empty' })).state;
    const state = (await lib.import({ bundle: observationsFixture(before), apply: true, expectedRevision: before.revision })).state, canonical = JSON.stringify(state);
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Vancouver', serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], writes = []; let supported = true, mode = 'ready', inventoryReads = 0, releaseDelayed, delayedFinished, markDelayedStarted;
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('familyhub.worker.v1', JSON.stringify({ Endpoint: 'https://synthetic-worker.invalid', ApiKey: 'synthetic-key' })));
    await context.route('https://synthetic-worker.invalid/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (req.method() === 'OPTIONS') return route.fulfill({ json: {} });
      if (req.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 403, json: {} }); }
      if (path === '/finance/source-inventory') {
        inventoryReads++;
        if (mode === 'delayed') {
          let finish; delayedFinished = new Promise(resolve => { finish = resolve; });
          const gate = new Promise(resolve => { releaseDelayed = resolve; }); markDelayedStarted(); await gate;
          await route.fulfill({ json: inventory }); finish(); return;
        }
        if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable inventory' } });
        if (mode === 'empty') return route.fulfill({ json: { capability, state: { revision: 'empty', snapshot: null } } });
        return route.fulfill({ json: inventory });
      }
      const body = path === '/finances' ? state : path === '/health' ? { status: 'ok', version: '2.30.0', capabilities: supported ? [capability, 'finance-balance-observations-v1'] : ['finance-balance-observations-v1'] } : path === '/invoices' ? { items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] } : path === '/savings/contracts' ? { records: [] } : { records: [], jobs: [], items: [], state: 'idle' };
      return route.fulfill({ json: body });
    });
    await page.goto(base); const panel = page.locator('.finance-received-source');
    await page.getByRole('button', { name: 'Comptes', exact: true }).click();
    const bank = page.locator('[data-investment-account="bank"]'); await bank.waitFor(); assert.match(await bank.innerText(), /1\s?234,56/);
    await page.getByRole('heading', { name: 'Soldes reçus', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Comptes source non rapprochés', exact: true }).waitFor();
    assert.equal(await page.locator('[data-received-account]:visible').count(), 2);
    assert.equal(await panel.locator('.finance-source-accounts > li:visible').count(), 7, 'Every source account is visible without opening a disclosure');
    assert.equal(await page.locator('.finance-historical-accounts').getAttribute('open'), null);
    assert.equal(await page.locator('.finance-source-panel').count(), 0, 'No duplicate source account list');
    assert.equal(await page.locator('.finance-collection-note').count(), 0, 'No global canonical timestamp can contradict source receipts');
    const sourceLink = page.getByRole('link', { name: 'Voir les 7 comptes source non rapprochés', exact: true });
    await sourceLink.focus(); await page.keyboard.press('Enter');
    assert.equal(await panel.evaluate(el => document.activeElement === el), true, 'Native source jump is keyboard-accessible');
    assert.equal(await panel.locator('.finance-source-accounts > li').count(), 7);
    assert.equal(await panel.locator('.finance-source-status').filter({ hasText: 'Non rapproché' }).count(), 7);
    assert.match(await panel.innerText(), /Collecte ancienne/); assert.match(await panel.innerText(), /Date bancaire non fournie/);
    assert.match(await panel.innerText(), /USD/); assert.match(await panel.innerText(), /Montant non fourni/); assert.match(await panel.innerText(), /0,00/);
    assert.equal(await panel.locator('.finance-source-money time').first().getAttribute('datetime'), old);
    assert.doesNotMatch(await panel.innerText(), /Solde total|Patrimoine total|fsi_[a-f0-9]/);
    const credit = panel.getByText('Relevé et échéance de crédit', { exact: true }); assert.equal(await credit.count(), 2); await credit.first().click();
    assert.equal(await panel.locator('time[datetime="2020-01-01"]:visible').count(), 1);
    assert.equal(await panel.locator('time[datetime="2020-01-02"]:visible').count(), 1);
    assert.equal(await panel.locator('time[datetime="2031-02-03"]:visible').count(), 1);
    await panel.getByText('Disponibilité des sections', { exact: true }).click(); assert.match(await panel.innerText(), /Positions de placement : indisponible, couverture non établie/); assert.match(await panel.innerText(), /Budgets et objectifs : non fournis/);
    await panel.getByText('Prévisions récurrentes (29)', { exact: true }).click(); assert.equal(await panel.locator('.finance-source-forecasts li').count(), 29);
    assert.match(await panel.innerText(), /Date prévue déjà passée/); assert.match(await panel.innerText(), /ni des dépenses comptabilisées ni des factures confirmées/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await panel.getByText('Prévisions récurrentes (29)', { exact: true }).click(); await page.screenshot({ path: join(output, 'inventory-' + width + '.png'), fullPage: true });
    const historical = page.locator('.finance-historical-accounts'), summary = historical.locator(':scope > summary');
    for (let i = 0; i < 2; i++) { await summary.focus(); await page.keyboard.press('Enter'); assert.notEqual(await historical.getAttribute('open'), null); await page.keyboard.press('Enter'); assert.equal(await historical.getAttribute('open'), null); }
    await summary.focus(); await page.keyboard.press('Enter');
    const card = page.locator('[data-investment-account="card"]'); await card.focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Carte de test', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retour aux comptes', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-investment-account') === 'card');
    assert.notEqual(await historical.getAttribute('open'), null, 'Historical disclosure and return focus survive account details');
    await bank.click(); await page.getByRole('heading', { name: 'Compte courant', exact: true }).waitFor(); await page.getByRole('button', { name: 'Retour aux comptes', exact: true }).click(); assert.match(await bank.innerText(), /1\s?234,56/);
    for (const tab of ['Dépenses', 'Tendances', 'Comptes']) { await page.getByRole('button', { name: tab, exact: true }).click(); assert.equal(await page.locator('.finance-source-accounts > li').count(), 7); }
    mode = 'delayed'; const delayedStarted = new Promise(resolve => { markDelayedStarted = resolve; });
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click(); await delayedStarted; await panel.getByText(/Chargement de l'inventaire/).waitFor();
    await page.getByRole('button', { name: 'Actualiser', exact: true }).waitFor(); assert.match(await bank.innerText(), /1\s?234,56/, 'Canonical refresh is not delayed by the optional source request');
    mode = 'error'; await page.getByRole('button', { name: 'Actualiser', exact: true }).click(); await panel.getByText(/Inventaire source indisponible/).waitFor();
    assert.equal(typeof releaseDelayed, 'function'); releaseDelayed(); await delayedFinished;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await panel.innerText(), /Inventaire source indisponible/, 'Superseded successful inventory response cannot replace newer error state');
    assert.equal(await panel.locator('.finance-source-accounts').count(), 0); assert.match(await bank.innerText(), /1\s?234,56/);
    mode = 'empty'; await page.getByRole('button', { name: 'Actualiser', exact: true }).click(); await panel.getByText(/Inventaire non disponible/).waitFor(); assert.match(await bank.innerText(), /1\s?234,56/);
    mode = 'ready'; await page.getByRole('button', { name: 'Actualiser', exact: true }).click(); await panel.locator('.finance-source-accounts').waitFor();
    supported = false; const reads = inventoryReads; await page.getByRole('button', { name: 'Actualiser', exact: true }).click(); await panel.getByText(/nécessite une mise à jour/).waitFor(); assert.equal(inventoryReads, reads); assert.match(await bank.innerText(), /1\s?234,56/);
    assert.equal(JSON.stringify(state), canonical); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    const stored = await page.evaluate(() => Object.values(localStorage).join('\n')); assert.doesNotMatch(stored, /Compte source fictif|Prévision fictive|fsi_[a-f0-9]/);
    await context.close(); console.log(`PASS isolated 7-account inventory, credit dates, 29 forecasts, empty/error/old-worker, keyboard and preserved canonical observations at ${width}px (${day})`);
  }
} finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); assert(resolve(temp).startsWith(resolve(tmpdir()) + sep)); await rm(temp, { recursive: true, force: true }); }
