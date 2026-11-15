import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchFinanceSourceInventory, importFinanceSourceInventory } from '../apps/web/src/worker.ts';
import { SOURCE_INVENTORY_CAPABILITY as capability, validateFinanceSourceInventory } from '../apps/worker/src/finance-source-inventory-model.ts';
import { inventoryFixture } from './finance-source-inventory-fixture.mjs';
const config = { Endpoint: 'https://synthetic.invalid', ApiKey: 'synthetic-key' };
const reply = body => new Response(JSON.stringify(body), { status: 200 });
function fixture() {
  const input = inventoryFixture(); input.collectedAt = new Date(Date.now() - 1000).toISOString(); input.accounts[0].credit.statementBalance.sourceAsOf = '2020-01-01'; input.accounts[0].credit.minimumPayment.sourceAsOf = null;
  const snapshot = validateFinanceSourceInventory(input), revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return { snapshot, revision, result: { capability, applied: false, alreadyImported: false, expectedRevision: 'empty', proposedRevision: revision, snapshot, state: null } };
}
test('capability precedes preview/apply and older workers do not receive a POST or inventory GET', async () => {
  const original = globalThis.fetch, calls = []; globalThis.fetch = async (url, init) => { calls.push([url, init?.method ?? 'GET']); return reply({ capabilities: [] }); };
  try {
    assert.equal(await fetchFinanceSourceInventory(config), null);
    for (const apply of [false, true]) await assert.rejects(importFinanceSourceInventory(config, {}, 'empty', apply), /worker PC/);
    assert.equal(calls.length, 3); assert(calls.every(([url, method]) => url.endsWith('/health') && method === 'GET'));
  } finally { globalThis.fetch = original; }
});
test('preview preserves exact validated snapshot and apply requires matching separate GET readback', async () => {
  const original = globalThis.fetch, f = fixture(), calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init?.method ?? 'GET']); if (url.endsWith('/health')) return reply({ capabilities: [capability] });
    if (init?.method === 'POST') { const body = JSON.parse(init.body); assert.equal(body.capability, capability); return reply({ ...f.result, applied: body.apply, state: body.apply ? { revision: f.revision, snapshot: f.snapshot } : null }); }
    return reply({ capability, state: { revision: f.revision, snapshot: f.snapshot } });
  };
  try {
    assert.equal((await importFinanceSourceInventory(config, f.snapshot, 'empty')).state, null);
    const applied = await importFinanceSourceInventory(config, f.snapshot, 'empty', true); assert.equal(applied.state.revision, f.revision);
    assert.deepEqual(calls.map(([, method]) => method), ['GET', 'POST', 'GET', 'POST', 'GET']);
  } finally { globalThis.fetch = original; }
});
test('dropped, altered or uncertain receipts/readback never replay a POST or report success', async () => {
  const original = globalThis.fetch, f = fixture();
  try {
    for (const mode of ['missing-capability', 'dropped-date', 'wrong-revision', 'readback-mismatch', 'network-loss']) {
      let posts = 0; globalThis.fetch = async (url, init) => {
        if (url.endsWith('/health')) return reply({ capabilities: [capability] });
        if (init?.method === 'POST') {
          posts++; if (mode === 'network-loss') throw Error('synthetic lost response');
          const result = { ...f.result, applied: true, state: { revision: f.revision, snapshot: structuredClone(f.snapshot) } };
          if (mode === 'missing-capability') delete result.capability;
          if (mode === 'dropped-date') delete result.state.snapshot.collectedAt;
          if (mode === 'wrong-revision') result.state.revision = 'a'.repeat(64);
          return reply(result);
        }
        return reply({ capability, state: { revision: f.revision, snapshot: { ...f.snapshot, predictions: [], availability: { ...f.snapshot.availability, recurring: { status: 'unavailable', coverage: 'unknown', observedCount: 0 } } } } });
      };
      await assert.rejects(importFinanceSourceInventory(config, f.snapshot, 'empty', true)); assert.equal(posts, 1, mode);
    }
  } finally { globalThis.fetch = original; }
});
