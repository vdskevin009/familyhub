import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'familyhub-bc-collector-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const { parsePortalPages, savePortalSnapshot } = await import('../apps/worker/dist/bluecross-collector.js');
const { initializeInvoices, initializeBlueCrossStatus, syncBlueCrossPortal, planBlueCrossUpsert } = await import('../apps/worker/dist/invoices.js');
const { buildReconciliationSnapshot } = await import('../apps/worker/dist/reconciliation.js');

const row = (service = 'Physiotherapy Treatment', paid = 80) => ({ service, paid });
function table(rows, grandPaid = rows.reduce((sum, item) => sum + item.paid, 0), grandClaimed = rows.length * 100) {
  const claimed = rows.length * 100;
  const paid = rows.reduce((sum, item) => sum + item.paid, 0);
  return `<table id="grdClaimsGrid"><thead><tr><th>Amount Claimed</th><th>Amount Paid</th></tr></thead><tbody>${rows.map((item, index) => `<tr rowId="${index}"><td>Sep 03, 2026</td><td>Jasmine Wing</td><td>${item.service}</td><td>$100.00</td><td>$${item.paid.toFixed(2)}</td><td>Sep 10, 2026</td><td>Details</td></tr>`).join('')}</tbody><tfoot><tr><td></td><td></td><td><div>Page Total</div><div>Grand Total</div></td><td><div>$${claimed.toFixed(2)}</div><div>$${grandClaimed.toFixed(2)}</div></td><td><div>$${paid.toFixed(2)}</div><div>$${grandPaid.toFixed(2)}</div></td></tr></tfoot></table>`;
}
const collection = rows => parsePortalPages([{ html: table(rows), hasNext: false }]);
const base = collection([row()]);
const initial = planBlueCrossUpsert([], base).items[0];
const expense = { ...initial, Id: 'test-expense', DocumentRole: 'expense', DocumentType: 'receipt', Insurer: null,
  Provider: 'Physiotherapy Treatment', ReimbursedAmount: null, DetectedAmount: 100, NeedsReview: false, Confidence: 99 };
const old = { ...initial, Id: 'old-claim', ClaimedService: 'Dental exam', Provider: 'Blue Cross · Dental exam' };
const seed = { items: [expense, old], corrections: [], decisions: [],
  matchDecisions: [{ reimbursementId: initial.Id, expenseId: expense.Id, decision: 'confirmed', at: '2026-09-11T00:00:00Z' }],
  unmatchedDecisions: [{ reimbursementId: old.Id, decision: 'ignored', at: '2026-09-11T00:00:00Z', reason: 'no-expense-match' }],
  workflowRecords: [{ ExpenseDocumentId: expense.Id, ManualStatus: 'closed', AutomaticStatus: 'open', ChangedAt: '2026-09-11T00:00:00Z', History: [] }],
  reviews: [], accounts: {} };
const legacy = structuredClone(seed);
delete legacy.items[0].AttentionLevel;
await writeFile(join(directory, 'invoices.json'), JSON.stringify(legacy));
const legacyBytes = await readFile(join(directory, 'invoices.json'), 'utf8');
await initializeInvoices(true);
const remainedUnchanged = await readFile(join(directory, 'invoices.json'), 'utf8') === legacyBytes;
await writeFile(join(directory, 'invoices.json'), JSON.stringify(seed));
await initializeInvoices();
await initializeBlueCrossStatus();

test('CLI read-only initialization leaves an older invoice index byte-for-byte unchanged', () => {
  assert.equal(remainedUnchanged, true);
});

test('one row, multiple pages, and page totals use existing parser', () => {
  assert.equal(base.rows.length, 1);
  const first = table([row()], 140, 200);
  const second = table([row('Massage therapy', 60)], 140, 200);
  const pages = parsePortalPages([{ html: first, hasNext: true }, { html: second, hasNext: false }]);
  assert.equal(pages.pageCount, 2);
  assert.equal(pages.rows.length, 2);
  assert.equal(pages.complete, true);
});
test('known, new, changed, duplicate, and ambiguous rows are distinguished', () => {
  assert.equal(planBlueCrossUpsert([initial], base).unchanged, 1);
  assert.equal(planBlueCrossUpsert([], base).new, 1);
  const changed = collection([row('Physiotherapy Treatment', 70)]);
  const plan = planBlueCrossUpsert([initial], changed);
  assert.equal(plan.changed, 1);
  assert.equal(plan.items[0].Id, initial.Id);
  assert.equal(planBlueCrossUpsert([plan.items[0]], changed).unchanged, 1);
  const duplicate = parsePortalPages([{ html: table([row()]), hasNext: true }, { html: table([row()]), hasNext: false }]);
  assert.ok(duplicate.warnings.length);
  assert.equal(planBlueCrossUpsert([], duplicate).ambiguous, 1);
  assert.equal(planBlueCrossUpsert([initial, { ...initial, Id: 'other' }], changed).ambiguous, 1);
  const stable = parsePortalPages([{ html: table([row()]).replace('rowId="0"', 'rowId="0" data-claim-id="SAMPLE-123"'), hasNext: false }]);
  const stableChanged = parsePortalPages([{ html: table([row('Physiotherapy Treatment', 70)]).replace('rowId="0"', 'rowId="0" data-claim-id="SAMPLE-123"'), hasNext: false }]);
  assert.equal(stable.rows[0].identity, stableChanged.rows[0].identity);
  assert.equal(planBlueCrossUpsert(planBlueCrossUpsert([], stable).items, stableChanged).changed, 1);
});
test('malformed row, partial collection, and network failure are non-applicable', async () => {
  const malformed = parsePortalPages([{ html: table([row()]).replace('$80.00</td>', '$bad</td>'), hasNext: false }]);
  assert.equal(malformed.complete, false);
  const partial = parsePortalPages([{ html: table([row()], 140), hasNext: true }], 'Network timeout');
  assert.equal(partial.complete, false);
  await assert.rejects(syncBlueCrossPortal(true, false, async () => ({ status: 'success', collection: partial, snapshotPath: 'test' })), /incomplete/);
  await assert.rejects(syncBlueCrossPortal(false, false, async () => { throw new Error('Network timeout'); }), /Network timeout/);
  const saved = JSON.parse(await readFile(join(directory, 'invoices.json'), 'utf8'));
  assert.equal(saved.items.length, seed.items.length);
});
test('expired session returns login-required without changing invoice ledger', async () => {
  const before = await readFile(join(directory, 'invoices.json'), 'utf8');
  const result = await syncBlueCrossPortal(false, false, async () => ({ status: 'login-required' }));
  assert.equal(result.status, 'login-required');
  assert.equal(await readFile(join(directory, 'invoices.json'), 'utf8'), before);
});
test('preview is non-destructive, apply preserves decisions and recomputes reconciliation; repeated apply is idempotent', async () => {
  const collector = async () => ({ status: 'success', collection: base, snapshotPath: 'test' });
  const before = await readFile(join(directory, 'invoices.json'), 'utf8');
  const preview = await syncBlueCrossPortal(false, false, collector);
  assert.equal(preview.new, 1);
  assert.equal(await readFile(join(directory, 'invoices.json'), 'utf8'), before);
  const applied = await syncBlueCrossPortal(true, false, collector);
  assert.equal(applied.new, 1);
  const saved = JSON.parse(await readFile(join(directory, 'invoices.json'), 'utf8'));
  assert.equal(saved.items.some(item => item.Id === old.Id), true, 'old records remain');
  assert.deepEqual(saved.matchDecisions, seed.matchDecisions);
  assert.deepEqual(saved.unmatchedDecisions, seed.unmatchedDecisions);
  assert.equal(saved.workflowRecords.find(item => item.ExpenseDocumentId === expense.Id).ManualStatus, 'closed');
  const reconciliation = buildReconciliationSnapshot(saved.items.filter(item => item.Id !== old.Id), saved.matchDecisions);
  assert.equal(reconciliation.unmatched.length, 0);
  assert.equal(reconciliation.cases[0].MatchAssignments.length, 1);
  for (let index = 0; index < 2; index++) {
    const repeat = await syncBlueCrossPortal(true, false, collector);
    assert.equal(repeat.new, 0); assert.equal(repeat.changed, 0); assert.equal(repeat.unchanged, 1);
  }
  const repeated = JSON.parse(await readFile(join(directory, 'invoices.json'), 'utf8'));
  assert.equal(repeated.items.length, saved.items.length);
  const changed = collection([row('Physiotherapy Treatment', 70)]);
  const changedCollector = async () => ({ status: 'success', collection: changed, snapshotPath: 'test' });
  assert.equal((await syncBlueCrossPortal(true, false, changedCollector)).changed, 1);
  const changedState = JSON.parse(await readFile(join(directory, 'invoices.json'), 'utf8'));
  assert.equal(changedState.items.find(item => item.Id === initial.Id).ReimbursedAmount, 70);
  assert.deepEqual(changedState.matchDecisions, seed.matchDecisions);
  assert.equal((await syncBlueCrossPortal(true, false, changedCollector)).unchanged, 1);
  assert.equal(JSON.parse(await readFile(join(directory, 'invoices.json'), 'utf8')).items.length, saved.items.length);
});
test('snapshots are immutable audit inputs with minimal source facts', async () => {
  const path = await savePortalSnapshot(base);
  const contents = await readFile(path, 'utf8');
  assert.equal(JSON.parse(contents).rows.length, 1);
  assert.equal(contents.includes('grdClaimsGrid'), false);
  await savePortalSnapshot(base);
  assert.equal(await readFile(path, 'utf8'), contents);
});

test.after(async () => { await rm(directory, { recursive: true, force: true }); });
