import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SOURCE_INVENTORY_LIMITS, validateFinanceSourceInventory, sourceInventoryIsStale } from '../apps/worker/src/finance-source-inventory-model.ts';
import { FinanceSourceInventoryStore, SourceInventoryConflict, financeSourceKey } from '../apps/worker/src/finance-source-inventory-store.ts';
import { inventoryFixture, inventoryNow } from './finance-source-inventory-fixture.mjs';

test('minimized source evidence preserves signed cents, unknown balance date and field-specific dates', () => {
  const input = inventoryFixture(), before = structuredClone(input), output = validateFinanceSourceInventory(input, inventoryNow);
  assert.deepEqual(input, before); assert.notEqual(output, input); assert.notEqual(output.accounts[0], input.accounts[0]);
  assert.equal(output.accounts[0].balance.amountCents, -12345); assert.equal(output.accounts[0].balance.sourceAsOf, null);
  assert.equal(output.accounts[0].credit.statementBalance.sourceAsOf, '2030-04-18');
  assert.equal(output.accounts[0].credit.minimumPayment.sourceAsOf, '2030-04-19');
  assert.equal(output.accounts[0].credit.paymentDueOn, '2030-05-09');
  assert.equal(output.predictions[0].predictedOn, '2030-04-28');
  assert.equal(output.availability.holdings.status, 'unavailable'); assert.equal(output.availability.activity.coverage, 'unknown');
  assert.equal(JSON.stringify(output).includes('fictional-item'), false); assert.equal(Object.hasOwn(output, 'totalCents'), false);
});
test('missing amounts stay null and explicit zero remains a genuine observation', () => {
  const input = inventoryFixture(); input.accounts[0].balance = null; input.predictions[0].amount = null;
  assert.equal(validateFinanceSourceInventory(input, inventoryNow).accounts[0].balance, null);
  input.accounts[0].balance = { amountCents: 0, currency: 'CAD', sourceAsOf: null };
  assert.equal(validateFinanceSourceInventory(input, inventoryNow).accounts[0].balance.amountCents, 0);
});
test('stable keys are namespaced hashes, do not concatenate ambiguously, and reject malformed identities', () => {
  const key = financeSourceKey('account', 'item', 'id');
  assert.match(key, /^fsi_[a-f0-9]{64}$/); assert.equal(key, financeSourceKey('account', 'item', 'id'));
  assert.notEqual(key, financeSourceKey('prediction', 'item', 'id')); assert.notEqual(key, financeSourceKey('account', 'other-item', 'id'));
  assert.notEqual(financeSourceKey('account', 'ab', 'c'), financeSourceKey('account', 'a', 'bc'));
  for (const args of [['account', '', 'id'], ['account', 'a'.repeat(513), 'id'], ['account', 'item', 'id\n'], ['secret', 'item', 'id']]) assert.throws(() => financeSourceKey(...args));
});
test('strict nested allowlists refuse raw IDs, secrets, inferred mappings and canonical rows', () => {
  for (const mutate of [
    f => f.access_token = 'fictional-secret', f => f.accounts[0].account_id = 'fictional-raw-id',
    f => f.accounts[0].canonicalId = 'bank', f => f.accounts[0].reconciliation = 'reconciled',
    f => f.accounts[0].balance.available = 999, f => f.accounts[0].credit.fullCardNumber = 'synthetic',
    f => f.predictions[0].kind = 'confirmed-bill', f => f.predictions[0].sourceKey = 'raw-id',
    f => f.availability.holdings.warning = 'raw-provider-output', f => f.transactions = [],
    f => f.accounts[0].name = '', f => f.accounts[0].name = 'a'.repeat(161),
  ]) { const input = inventoryFixture(); mutate(input); assert.throws(() => validateFinanceSourceInventory(input, inventoryNow)); }
});
test('strict calendar dates, future collection/source dates, unsafe money, count caps and coverage contradictions fail closed', () => {
  for (const mutate of [
    f => f.collectedAt = '2030-02-30T12:00:00Z', f => f.collectedAt = '2030-05-01', f => f.collectedAt = '2030-05-01T12:05:01Z',
    f => f.accounts[0].balance.sourceAsOf = '2030-05-02', f => f.accounts[0].balance.sourceAsOf = '2030-05-01T12:06:00Z',
    f => f.accounts[0].credit.paymentDueOn = '2030-02-30', f => f.predictions[0].predictedOn = '2030-13-01',
    f => f.accounts[0].balance.amountCents = 1.5, f => f.accounts[0].balance.amountCents = Number.MAX_SAFE_INTEGER,
    f => f.accounts[0].balance.amountCents = NaN, f => f.accounts[0].balance.currency = 'cad',
    f => f.accounts = Array.from({ length: SOURCE_INVENTORY_LIMITS.accounts + 1 }, () => f.accounts[0]),
    f => f.predictions = Array.from({ length: SOURCE_INVENTORY_LIMITS.predictions + 1 }, () => f.predictions[0]),
    f => f.accounts.push(structuredClone(f.accounts[0])), f => f.predictions.push(structuredClone(f.predictions[0])),
    f => f.availability.holdings.status = 'available', f => f.availability.holdings.coverage = 'complete',
    f => f.availability.accounts.observedCount = 9, f => f.availability.recurring.observedCount = null,
    f => f.predictions[0].accountSourceKey = financeSourceKey('account', 'missing', 'missing'),
    f => f.accounts[0].kind = 'loan',
  ]) { const input = inventoryFixture(); mutate(input); assert.throws(() => validateFinanceSourceInventory(input, inventoryNow)); }
});
test('small collection clock tolerance, dated future forecasts and due dates are separate from observed dates', () => {
  const f = inventoryFixture(); f.collectedAt = '2030-05-01T12:05:00Z'; f.predictions[0].predictedOn = '2031-05-01'; f.accounts[0].credit.paymentDueOn = '2031-05-01';
  assert.equal(validateFinanceSourceInventory(f, inventoryNow).collectedAt, '2030-05-01T12:05:00.000Z');
  assert.equal(sourceInventoryIsStale(f, new Date('2030-05-02T12:05:00Z')), false);
  assert.equal(sourceInventoryIsStale(f, new Date('2030-05-02T12:05:01Z')), true);
});
async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'familyhub-source-inventory-synthetic-'));
  try { await run(new FinanceSourceInventoryStore(directory), directory); }
  finally { if (!resolve(directory).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unexpected test cleanup path'); await rm(directory, { recursive: true, force: true }); }
}
test('separate sidecar is revision-checked, replay-safe, durable, and never changes canonical ledger bytes', async () => withStore(async (store, directory) => {
  await writeFile(join(directory, 'finances.json'), 'synthetic-canonical-ledger');
  assert.deepEqual(await store.read(inventoryNow), { revision: 'empty', snapshot: null });
  const saved = await store.save(inventoryFixture(), 'empty', inventoryNow);
  assert.deepEqual(await new FinanceSourceInventoryStore(directory).read(inventoryNow), saved);
  assert.deepEqual(await store.save(inventoryFixture(), saved.revision, inventoryNow), saved);
  await assert.rejects(store.save(inventoryFixture(), 'empty', inventoryNow), SourceInventoryConflict);
  const older = inventoryFixture(); older.collectedAt = '2030-04-30T12:00:00.000Z';
  await assert.rejects(store.save(older, saved.revision, inventoryNow), SourceInventoryConflict);
  const contradiction = inventoryFixture(); contradiction.accounts[0].balance.amountCents = 20;
  await assert.rejects(store.save(contradiction, saved.revision, inventoryNow), SourceInventoryConflict);
  assert.equal(await readFile(join(directory, 'finances.json'), 'utf8'), 'synthetic-canonical-ledger');
  assert.deepEqual(await readdir(join(directory, 'finance')), ['source-inventory.json']);
}));
test('queued operations clone inputs and reject one of two concurrent stale revisions', async () => withStore(async store => {
  const saved = await store.save(inventoryFixture(), 'empty', inventoryNow), later = new Date('2030-05-02T12:00:00Z');
  const input = inventoryFixture(); input.collectedAt = later.toISOString();
  const pending = store.save(input, saved.revision, later); input.accounts[0].name = 'Mutated after enqueue';
  const competing = store.save(input, saved.revision, later);
  const results = await Promise.allSettled([pending, competing]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal((await store.read(later)).snapshot.accounts[0].name, 'Carte fictive');
}));
test('corrupt and oversized existing sidecars fail closed and are never overwritten', async () => {
  for (const raw of ['broken-json', JSON.stringify({ revision: 'wrong', snapshot: inventoryFixture() }), 'x'.repeat(SOURCE_INVENTORY_LIMITS.bytes + 257)]) {
    await withStore(async (store, directory) => {
      await mkdir(join(directory, 'finance')); const path = join(directory, 'finance', 'source-inventory.json'); await writeFile(path, raw);
      await assert.rejects(store.read(inventoryNow)); await assert.rejects(store.save(inventoryFixture(), 'empty', inventoryNow));
      assert.equal(await readFile(path, 'utf8'), raw);
    });
  }
});
