import test from 'node:test';
import assert from 'node:assert/strict';
import { financeSourceKey } from '../apps/worker/src/finance-source-inventory-store.ts';
import { prepareUnmappedFinanceSourceInventory } from '../apps/worker/src/finance-source-inventory-prepare.ts';
import { inventoryFixture, inventoryNow } from './finance-source-inventory-fixture.mjs';

function sourceNine() {
  const f = inventoryFixture(), template = structuredClone(f.accounts[0]);
  f.accounts = Array.from({ length: 9 }, (_, i) => ({ ...structuredClone(template), sourceKey: financeSourceKey('account', 'fictional-item', 'fictional-account-' + i), name: 'Identical display name', kind: i === 2 || i === 3 ? 'credit' : 'investment', credit: i === 2 || i === 3 ? structuredClone(template.credit) : null }));
  f.predictions[0].accountSourceKey = f.accounts[0].sourceKey;
  f.predictions.push({ ...structuredClone(f.predictions[0]), sourceKey: financeSourceKey('prediction', 'fictional-item', 'another-fictional-stream'), accountSourceKey: f.accounts[8].sourceKey });
  f.availability.accounts = { status: 'available', coverage: 'complete', observedCount: 9 }; f.availability.recurring.observedCount = 2; f.availability.liabilities.observedCount = 2;
  return f;
}
test('exact attested source keys exclude two of nine identical-looking accounts without any name/amount inference', () => {
  const f = sourceNine(), before = structuredClone(f), mapped = f.accounts.slice(0, 2).map(account => account.sourceKey);
  const prepared = prepareUnmappedFinanceSourceInventory(f, { attestedMappedSourceKeys: mapped, expectedUnmappedAccountCount: 7 }, inventoryNow);
  assert.deepEqual(f, before); assert.equal(prepared.accounts.length, 7); assert(prepared.accounts.every(account => !mapped.includes(account.sourceKey)));
  assert.deepEqual(prepared.accounts, before.accounts.slice(2)); assert.equal(prepared.collectedAt, before.collectedAt);
  assert.equal(prepared.availability.accounts.coverage, 'partial'); assert.equal(prepared.availability.accounts.observedCount, 7);
  assert.equal(prepared.predictions[0].accountSourceKey, null); assert.equal(prepared.predictions[1].accountSourceKey, before.accounts[8].sourceKey);
  assert.deepEqual(prepared.availability.holdings, before.availability.holdings); assert.equal(prepared.accounts.filter(account => account.credit).length, 2);
  assert.doesNotMatch(JSON.stringify(prepared), /fictional-account-|fictional-item|canonicalId|totalCents/);
  assert(mapped.every(key => !JSON.stringify(prepared).includes(key)));
});
test('missing or duplicate attested identities, raw IDs and changed account counts stop instead of guessing', () => {
  const f = sourceNine(), options = { attestedMappedSourceKeys: f.accounts.slice(0, 2).map(account => account.sourceKey), expectedUnmappedAccountCount: 7 };
  for (const edit of [
    x => x.attestedMappedSourceKeys[0] = 'raw-provider-account', x => x.attestedMappedSourceKeys.push(x.attestedMappedSourceKeys[0]),
    x => x.attestedMappedSourceKeys[0] = financeSourceKey('account', 'different-item', 'fictional-account-0'), x => x.expectedUnmappedAccountCount = 8,
    x => x.expectedUnmappedAccountCount = -1,
  ]) { const changed = structuredClone(options); edit(changed); assert.throws(() => prepareUnmappedFinanceSourceInventory(f, changed, inventoryNow)); }
  const missing = structuredClone(f); missing.accounts.shift(); missing.availability.accounts.observedCount = 8;
  assert.throws(() => prepareUnmappedFinanceSourceInventory(missing, options, inventoryNow));
});
