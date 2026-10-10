import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { configureDesjardinsFilters, createReaderStages, desjardinsSessionExpired, inspectDesjardinsFilters, observeDesjardinsSession } from '../apps/worker/dist/desjardins-history-reader.js';
import { collectWithRetry } from '../apps/worker/dist/collection-retry.js';
import { collectDesjardinsPortal } from '../apps/worker/dist/desjardins-collector.js';

test('filter inspection reports only fixed labels and counts, including missing expected options', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent(`<select id="form_cbPour"><option value="all">Tous</option><option value="private-id">PRIVATE PERSON</option></select>
      <select id="form_cbCategorie"><option value="all">Toutes les catégories</option><option value="secret-service">PRIVATE SERVICE</option></select>
      <select id="form_cbNbResltRechr"><option>10</option><option>100</option></select>`);
    const result = await inspectDesjardinsFilters(page);
    assert.equal(result.patient.controls, 1);
    assert.equal(result.patient.expected, 0);
    assert.deepEqual(result.patient.alternatives, ['Tous']);
    assert.equal(result.category.expected, 1);
    assert.equal(result.category.selectedExpected, true);
    assert.equal(result.pageSize.selectedExpected, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private-id|secret-service/);
    await page.setContent('<select id="one_cbPour"></select><select id="two_cbPour"></select>');
    assert.equal((await inspectDesjardinsFilters(page)).patient.controls, 2);
  } finally { await browser.close(); }
});

test('reader stages retain exact transition and coarse failure without leaking portal errors', async () => {
  const events = []; const stage = createReaderStages(async event => events.push(event));
  await assert.rejects(stage('filter-patient', async () => { throw new Error('Timeout 30000ms; PRIVATE PERSON https://private.invalid?token=secret'); }), /Timeout/);
  assert.deepEqual(events, [{ stage: 'filter-patient', state: 'started' }, { stage: 'filter-patient', state: 'failed', errorKind: 'timeout' }]);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|private.invalid|secret/);
  assert.equal(await stage('history-read', async () => 7), 7);
});

test('session-only reader mode cannot be combined with credentials or interactive login', async () => {
  for (const args of [[true, 1, undefined, { sessionOnly: true }], [false, 1, {}, { sessionOnly: true }], [false, 1, undefined, { inspectFiltersOnly: true }]])
    await assert.rejects(collectDesjardinsPortal(...args), /saved session without credential recovery/);
  const source = await readFile(new URL('../apps/worker/src/desjardins-collector.ts', import.meta.url), 'utf8');
  assert.match(source, /options\.sessionOnly \? \(await observeDesjardinsSession\(/);
  assert.ok(source.indexOf('if (options.inspectFiltersOnly) return') < source.indexOf('await authenticatedPortal("desjardins")'));
});

test('saved-session observation waits for redirects but stops at credentials or a challenge', async () => {
  let waits = 0, observations = 0;
  const page = { isClosed: () => false, waitForTimeout: async () => { waits++; },
    locator: selector => ({ first() { return this; }, isVisible: async () => false, innerText: async () => '' }) };
  assert.equal(await observeDesjardinsSession(() => page, async () => ++observations === 3), true);
  assert.equal(waits, 2);
  for (const [password, text] of [[true, ''], [false, 'Enter your verification code']]) {
    const blocked = { ...page, locator: selector => ({ first() { return this; }, isVisible: async () => password, innerText: async () => text }) };
    assert.equal(await observeDesjardinsSession(() => blocked, async () => false), false);
  }
  assert.equal(await observeDesjardinsSession(() => page, async () => false, 0), false);
});

test('filter selection normalizes labels, validates every option first and never retries layout drift', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage();
    const url = 'https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx';
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    await page.goto(url);
    const fixture = label => `<select id="x_cbPour"><option>PRIVATE PERSON</option><option value="all">Tous&nbsp;les patients</option></select>
      <select id="x_cbCategorie"><option>PRIVATE SERVICE</option><option value="all">${label}</option></select>
      <select id="x_cbNbResltRechr"><option>10</option><option value="hundred">100</option></select>
      <input type="button" id="x_btnRechercher" value="Search"><table class="tableau-donnees"><tbody><tr><td>Synthetic</td></tr></tbody></table>`;
    await page.setContent(fixture('Toutes&nbsp;les catégories'));
    const events = []; const stage = createReaderStages(async entry => events.push(entry));
    await configureDesjardinsFilters(page, stage);
    assert.equal(await page.locator('#x_cbPour').inputValue(), 'all');
    assert.equal(await page.locator('#x_cbCategorie').inputValue(), 'all');
    assert.equal(await page.locator('#x_cbNbResltRechr').inputValue(), 'hundred');
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|hundred/);
    await page.setContent(fixture('Unsupported category'));
    let attempts = 0;
    await assert.rejects(collectWithRetry(async () => { attempts++; await configureDesjardinsFilters(page, stage); }, async () => {}), /structure changed \(category\)/);
    assert.equal(attempts, 1);
    assert.equal(await page.locator('#x_cbPour').inputValue(), 'PRIVATE PERSON', 'no filter event precedes full validation');
    await page.goto('https://untrusted.invalid/');
    await assert.rejects(configureDesjardinsFilters(page, stage), /structure changed \(location\)/);
    await page.goto(url);
    await page.setContent('<h1>Session expirée</h1><p>Expired session</p>');
    assert.equal(await desjardinsSessionExpired(page), true);
    assert.equal(await observeDesjardinsSession(() => page, async () => false), false);
    await page.goto('https://untrusted.invalid/');
    await page.setContent('<h1>Session expirée</h1>');
    assert.equal(await desjardinsSessionExpired(page), false);
  } finally { await browser.close(); }
});
