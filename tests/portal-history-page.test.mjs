import test from 'node:test';
import assert from 'node:assert/strict';
import { findPortalHistoryPage } from '../apps/worker/dist/portal-history-page.js';
import { tryPortalLogin } from '../apps/worker/dist/portal-login.js';
const dj = 'https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx';
const bc = 'https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/Claims.aspx?MODULE=ALL';
function page(url, { visible = true, closed = false, grids = 1 } = {}) {
  let inspections = 0;
  return { url: () => url, isClosed: () => closed, inspections: () => inspections,
    locator: () => { inspections++; return { count: async () => grids, isVisible: async () => visible }; } };
}
const context = (...pages) => ({ pages: () => pages });
test('operator history in another tab resumes while the initial tab still shows login', async () => {
  const initial = page('https://id.desjardins.com/login?state=synthetic');
  const history = page(dj);
  const result = await findPortalHistoryPage(context(initial, history), initial, 'desjardins');
  assert.equal(result.page, history);
  assert.deepEqual(result.diagnostic, { contextPages: 2, currentClosed: false, currentStage: 'login', historyPages: 1, readyPages: 1, selection: 'other-tab' });
  assert.equal(initial.inspections(), 0);
  assert.ok(!JSON.stringify(result.diagnostic).includes('synthetic'));
});
test('closing the initial tab does not discard a verified operator history tab', async () => {
  const initial = page('about:blank', { closed: true }); const history = page(dj);
  assert.equal((await findPortalHistoryPage(context(initial, history), initial, 'desjardins')).page, history);
});
test('Blue Cross uses only its exact history path with a visible claims grid', async () => {
  const initial = page('https://service.pac.bluecross.ca/member/login'); const history = page(bc);
  assert.equal((await findPortalHistoryPage(context(initial, history), initial, 'bluecross')).page, history);
  assert.equal((await findPortalHistoryPage(context(initial, page(bc, { visible: false })), initial, 'bluecross')).page, undefined);
});
test('untrusted, HTTP, credential-bearing and lookalike paths are never inspected as history', async () => {
  const initial = page('about:blank');
  const rejected = [dj.replace('https:', 'http:'), dj.replace('www.agea-gbim.dsf-dfs.com', 'www.agea-gbim.dsf-dfs.com.evil.test'), dj.replace('https://', 'https://synthetic@'), dj + '/other', 'https://service.pac.bluecross.ca/member/'].map(url => page(url));
  assert.equal((await findPortalHistoryPage(context(initial, ...rejected), initial, 'desjardins')).page, undefined);
  assert.ok(rejected.every(p => p.inspections() === 0));
});
test('multiple alternate ready tabs remain ambiguous; a verified current tab retains authority', async () => {
  const initial = page('https://id.desjardins.com/login'); const first = page(dj); const second = page(dj);
  const pending = await findPortalHistoryPage(context(initial, first, second), initial, 'desjardins');
  assert.equal(pending.page, undefined); assert.equal(pending.diagnostic.selection, 'ambiguous');
  assert.equal((await findPortalHistoryPage(context(first, second), first, 'desjardins')).page, first);
});
test('missing or ambiguous grids do not establish authenticated history', async () => {
  const initial = page('about:blank');
  for (const grids of [0, 2]) assert.equal((await findPortalHistoryPage(context(initial, page(dj, { grids })), initial, 'desjardins')).page, undefined);
});
test('verified alternate-tab authentication needs no credential read or submission', async () => {
  const initial = page('https://id.desjardins.com/login'); const history = page(dj);
  let active = initial;
  const ready = async () => { const match = await findPortalHistoryPage(context(initial, history), active, 'desjardins'); if (!match.page) return false; active = match.page; return true; };
  const forbidden = async () => { throw new Error('Credential/control access must not occur for an authenticated tab'); };
  assert.equal(await tryPortalLogin(initial, 'desjardins', ready, { now: Date.now, read: forbidden, save: forbidden, credentials: forbidden, submit: forbidden }), undefined);
  assert.equal(active, history);
});
test('a closed initial page can wait for an operator history tab without a login replay', async () => {
  const history = page(dj); const tabs = [];
  const initial = { ...page('about:blank', { closed: true }), locator: () => ({ first() { return this; }, isVisible: async () => false, innerText: async () => '' }), waitForTimeout: async () => { tabs.push(history); throw new Error('Initial tab closed'); } };
  let active = initial;
  const ready = async () => { const match = await findPortalHistoryPage(context(...tabs), active, 'desjardins'); if (!match.page) return false; active = match.page; return true; };
  const forbidden = async () => { throw new Error('Authentication must be observed, never replayed'); };
  assert.equal(await tryPortalLogin(initial, 'desjardins', ready, { now: Date.now, read: forbidden, save: forbidden, credentials: forbidden, submit: forbidden }), undefined);
  assert.equal(active, history);
});
