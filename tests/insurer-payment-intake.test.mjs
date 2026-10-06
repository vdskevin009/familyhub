import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'familyhub-new-payments-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const intake = await import('../apps/worker/dist/insurer-payment-intake.js');
const invoices = await import('../apps/worker/dist/invoices.js');
const { desjardinsIdentity, desjardinsInvoices } = await import('../apps/worker/dist/desjardins.js');
test.after(() => rm(directory, { recursive: true, force: true }));
const policy = join(directory, 'insurer-collection-policy.json');
const ledger = join(directory, 'invoices.json');
const bc = (patch = {}) => ({ collectedAt: new Date().toISOString(), collectorVersion: 1, pageCount: 1, warnings: [], complete: true,
  rows: [{ member: 'Kevin', serviceDate: '2026-01-15', service: 'Physiotherapy Treatment', claimed: 100, paid: 20,
    statementDate: '2026-03-01', identity: 'synthetic-secondary-payment', needsReview: false }], ...patch });
const dj = (patch = {}) => ({ collectedAt: new Date().toISOString(), collectorVersion: 1, pageCount: 1, warnings: [], complete: true,
  rows: [{ member: 'Kevin', serviceDate: '2026-01-15', service: 'Physiotherapy', submitted: 100, paid: 80,
    statementDate: '2026-02-01', sourceClaimId: 'synthetic-primary', identity: desjardinsIdentity('synthetic-primary', null, 1), needsReview: false }], ...patch });
const bcRecord = invoices.planBlueCrossUpsert([], bc()).items[0];
const djRecord = desjardinsInvoices(dj())[0];
const expense = { ...bcRecord, Id: 'synthetic-original-receipt', SourceMessageId: 'synthetic-receipt', DocumentRole: 'expense', DocumentType: 'receipt',
  StructuredSource: undefined, PortalClaimId: undefined, Insurer: null, Provider: 'Synthetic Clinic', ClaimedService: 'Physiotherapy', ReimbursedAmount: null };
async function seed(items = [expense, djRecord]) {
  await writeFile(ledger, JSON.stringify({ items, corrections: [], decisions: [], matchDecisions: [], unmatchedDecisions: [], confirmedServiceDates: [],
    workflowRecords: [{ ExpenseDocumentId: expense.Id, ManualStatus: 'open', AutomaticStatus: 'open', ChangedAt: '2026-02-01T00:00:00Z', History: [] }], reviews: [], accounts: {} }));
  await invoices.initializeInvoices(); await invoices.initializeBlueCrossStatus(); await invoices.initializeDesjardinsStatus();
  return await readFile(ledger, 'utf8');
}
const collector = collection => async () => ({ status: 'success', collection, snapshotPath: 'synthetic-snapshot' });
test('automatic recording requires the local opt-in; an API flag cannot grant it', async () => {
  assert.equal(await intake.automaticInsurerPaymentsEnabled(), false);
  assert.equal(await intake.automaticInsurerCollectionRequested(false, true), false);
  await writeFile(policy, JSON.stringify({ version: 1, autoImportNewPayments: true }));
  assert.equal(await intake.automaticInsurerCollectionRequested(false, undefined), true);
  assert.equal(await intake.automaticInsurerCollectionRequested(false, false), false);
  assert.equal(await intake.automaticInsurerCollectionRequested(true, undefined), false);
  await assert.rejects(intake.automaticInsurerCollectionRequested(false, 'yes'), /boolean/);
  await writeFile(policy, '{corrupt');
  await assert.rejects(intake.automaticInsurerCollectionRequested(false, undefined), /unreadable/);
  assert.equal(await intake.automaticInsurerCollectionRequested(false, false), false);
  await writeFile(policy, JSON.stringify({ version: 1, autoImportNewPayments: false }));
  assert.equal(await intake.automaticInsurerCollectionRequested(false, undefined), false);
});
test('Blue Cross saves a secondary payment during ordinary collection, recomputes reconciliation and preserves manual Open', async () => {
  const before = JSON.parse(await seed());
  const result = await invoices.syncBlueCrossPortal(false, false, collector(bc()), true);
  assert.deepEqual([result.autoImported, result.pendingNew, result.pendingChanged, result.applied], [1, 0, 0, true]);
  const after = JSON.parse(await readFile(ledger, 'utf8'));
  for (const old of before.items) assert.deepEqual(after.items.find(x => x.Id === old.Id), old);
  const workflow = after.workflowRecords.find(x => x.ExpenseDocumentId === expense.Id);
  assert.deepEqual({ ...workflow, AutomaticStatus: undefined }, { ...before.workflowRecords[0], AutomaticStatus: undefined });
  assert.equal(workflow.AutomaticStatus, "closed");
  const claim = (await invoices.invoiceSnapshot()).reconciliations.find(x => x.ExpenseDocumentId === expense.Id);
  assert.equal(claim.DesjardinsReimbursedAmount, 80); assert.equal(claim.BlueCrossReimbursedAmount, 20); assert.equal(claim.PotentialRemaining, 0);
  assert.equal(claim.WorkflowStatus, 'open'); assert.equal(claim.WorkflowOrigin, 'manual');
  assert.ok(result.backup); assert.ok(await readFile(join(directory, result.backup), 'utf8'));
  const stable = await readFile(ledger, 'utf8');
  const repeated = await invoices.syncBlueCrossPortal(false, false, collector(bc()), true);
  assert.equal(repeated.autoImported, 0); assert.equal(repeated.new, 0); assert.equal(await readFile(ledger, 'utf8'), stable);
});
test('an explicit or low-level preview remains read-only even with the opt-in enabled', async () => {
  await writeFile(policy, JSON.stringify({ version: 1, autoImportNewPayments: true }));
  const before = await seed();
  const auto = await intake.automaticInsurerCollectionRequested(false, false);
  const result = await invoices.syncBlueCrossPortal(false, false, collector(bc()), auto);
  assert.equal(result.applied, false); assert.equal(result.autoImported, undefined); assert.equal(result.new, 1);
  assert.equal(await readFile(ledger, 'utf8'), before);
});
test('a known payment change stays pending while a separate new validated payment is added', async () => {
  await seed([expense, { ...bcRecord, ReimbursedAmount: 15 }]);
  const current = bc(); current.rows.push({ ...current.rows[0], identity: 'synthetic-different-claim', serviceDate: '2026-01-16' });
  const result = await invoices.syncBlueCrossPortal(false, false, collector(current), true);
  assert.deepEqual([result.autoImported, result.pendingNew, result.pendingChanged, result.applied], [1, 0, 1, false]);
  const after = JSON.parse(await readFile(ledger, 'utf8'));
  assert.equal(after.items.find(x => x.Id === bcRecord.Id).ReimbursedAmount, 15);
});
test('a protected existing payment is never overwritten and ambiguity prevents automatic additions', async () => {
  const protectedRow = { ...bcRecord, ReimbursedAmount: 15, Notes: 'Synthetic manual choice', ManualOverride: { Version: 1, Reasons: ['decision-history'] } };
  const before = await seed([expense, protectedRow]);
  const current = bc(); current.rows.push({ ...current.rows[0], identity: 'synthetic-extra', serviceDate: '2026-01-16' });
  const result = await invoices.syncBlueCrossPortal(false, false, collector(current), true);
  assert.equal(result.autoImported, 0); assert.ok(result.ambiguous); assert.equal(await readFile(ledger, 'utf8'), before);
});
for (const [name, alter] of [
  ['incomplete history', x => { x.complete = false; x.warnings = ['Synthetic incomplete page']; }],
  ['duplicate identity', x => { x.rows.push({ ...x.rows[0] }); }],
  ['unknown payment', x => { x.rows[0].paid = null; x.rows[0].needsReview = true; }],
  ['zero payment', x => { x.rows[0].paid = 0; }],
  ['unknown member', x => { x.rows[0].member = 'unknown'; }],
  ['review-marked row', x => { x.rows[0].needsReview = true; }]
]) test(name+' cannot silently enter the saved payment ledger', async () => {
  const before = await seed(); const current = bc(); alter(current);
  const result = await invoices.syncBlueCrossPortal(false, false, collector(current), true);
  assert.equal(result.autoImported, 0); assert.equal(await readFile(ledger, 'utf8'), before);
});
test('Desjardins uses the same additive validation and duplicate prevention', async () => {
  const before = JSON.parse(await seed([expense, bcRecord]));
  const result = await invoices.syncDesjardinsPortal(false, false, collector(dj()), true);
  assert.deepEqual([result.autoImported, result.pendingNew, result.pendingChanged], [1, 0, 0]);
  const after = JSON.parse(await readFile(ledger, 'utf8'));
  for (const old of before.items) assert.deepEqual(after.items.find(x => x.Id === old.Id), old);
  const workflow = after.workflowRecords.find(x => x.ExpenseDocumentId === expense.Id);
  assert.deepEqual({ ...workflow, AutomaticStatus: undefined }, { ...before.workflowRecords[0], AutomaticStatus: undefined });
  assert.equal(workflow.AutomaticStatus, "closed");
  const bytes = await readFile(ledger, 'utf8');
  assert.equal((await invoices.syncDesjardinsPortal(false, false, collector(dj()), true)).autoImported, 0);
  assert.equal(await readFile(ledger, 'utf8'), bytes);
});
test('Desjardins authentication failure neither applies old snapshots nor changes the ledger', async () => {
  const before = await seed();
  const result = await invoices.syncDesjardinsPortal(false, false, async () => ({ status: 'login-required', authReason: 'human-required' }), true);
  assert.equal(result.status, 'login-required'); assert.equal(await readFile(ledger, 'utf8'), before);
});
test('invalid source/payment/date facts cannot qualify for automatic recording', () => {
  const valid = invoices.planBlueCrossUpsert([], bc()).items[0];
  const current = bc();
  for (const patch of [{ ReimbursedAmount: NaN }, { ReimbursedAmount: Infinity }, { ReimbursedAmount: 101 }, { BilledAmount: null }, { ServiceDate: '2026-02-31' }, { ClaimedService: '' }, { StructuredSource: 'gmail' }, { DocumentRole: 'expense' }, { ManualOverride: { Version: 1, Reasons: ['manual'] } }]) {
    assert.equal(intake.validatedNewInsurerPayments([], current, { ambiguous: 0, duplicates: 0, items: [{ ...valid, ...patch }] }).length, 0);
  }
});
