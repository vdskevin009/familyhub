import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'familyhub-authority-'));
process.env.FAMILYHUB_WORKER_DATA = dir;
const api = await import('../apps/worker/dist/invoices.js');
const { toInvoice, recordId } = await import('../apps/worker/dist/invoice-model.js');
const { automaticReplacement } = await import('../apps/worker/dist/ingestion-policy.js');
const { buildReconciliationSnapshot } = await import('../apps/worker/dist/reconciliation.js');
const { desjardinsInvoices, planDesjardinsUpsert, desjardinsIdentity } = await import('../apps/worker/dist/desjardins.js');
const { parsePortalPages } = await import('../apps/worker/dist/bluecross-collector.js');
const { desjardinsSnapshotDirectory } = await import('../apps/worker/dist/desjardins-collector.js');
after(async () => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))); await rm(dir, { recursive: true, force: true }); });

const email = 'synthetic@example.test';
const date = '2026-09-03';
const mail = (id = 'invoice-one') => ({ id, threadId: id, internetMessageId: `<${id}@example.test>`, subject: 'Invoice #SAMPLE123', sender: 'Example Clinic', receivedAt: date + 'T12:00:00Z', text: 'Invoice #SAMPLE123 Total paid CAD 100.00', labels: [], unsubscribe: false, bulk: false, attachments: [] });
const classification = { kind: 'invoice', confidence: .99, transaction: true, reimbursement: 'possible', reason: 'Synthetic expense', amount: 100, currency: 'CAD', category: 'health', member: 'Kevin', documentRole: 'expense', insurer: null, serviceDate: date, billedAmount: 100, reimbursedAmount: null };
const invoice = (id = 'invoice-one', patch = {}) => ({ ...toInvoice(mail(id), email, 'Test', classification, 'rules'), Healthcare: { ServiceDate: date, ServiceType: 'Physiotherapy', Provider: 'Example Clinic', OriginalBilledAmount: 100, InsurerPayments: {} }, ...patch });
const djCollection = (paid = 80) => ({ collectedAt: new Date().toISOString(), collectorVersion: 1, pageCount: 1, complete: true, warnings: [], rows: [{ identity: desjardinsIdentity('SYNTHETIC-DJ', null, 1), sourceClaimId: 'SYNTHETIC-DJ', member: 'Kevin', serviceDate: date, service: 'Physiotherapy', submitted: 100, paid, statementDate: date, needsReview: false }] });
const bcHtml = (paid = 20, claimId = 'SYNTHETIC-BC') => `<table id="grdClaimsGrid"><th>Amount Claimed</th><th>Amount Paid</th><tr rowId="0" data-claim-id="${claimId}"><td>Sep 03, 2026</td><td>Kevin Vanderstraeten</td><td>Physiotherapy</td><td>$100.00</td><td>$${paid.toFixed(2)}</td><td>Sep 03, 2026</td><td>Details</td></tr><tfoot><tr><td>Page Total Grand Total</td><td><div>$100.00</div><div>$100.00</div></td><td><div>$${paid.toFixed(2)}</div><div>$${paid.toFixed(2)}</div></td></tr></tfoot></table>`;
const bcCollection = (paid = 20, claimId) => parsePortalPages([{ html: bcHtml(paid, claimId), hasNext: false }]);
const bcInvoice = (paid = 20) => api.planBlueCrossUpsert([], bcCollection(paid)).items[0];
const read = async () => JSON.parse(await readFile(join(dir, 'invoices.json'), 'utf8'));
async function seed(items, extra = {}) {
  await writeFile(join(dir, 'invoices.json'), JSON.stringify({ items, corrections: [], decisions: [], matchDecisions: [], unmatchedDecisions: [], workflowRecords: [], reviews: [], accounts: { [email]: { healthReceiptRepairVersion: 4 } }, opaqueExtension: { retained: true }, ...extra }));
  await api.initializeInvoices();
}
function gmailDeps(ids, classify = async () => ({ result: classification, source: 'rules' })) {
  return { credentials: async () => ({ accounts: [{ email, label: 'Test' }] }), accessToken: async () => 'synthetic', classify, historicalClassify: classify, reviewer: async () => ({ explanation: 'Synthetic review' }), gmail: async (_token, path) => {
    if (path.startsWith('messages?')) return { messages: [...ids, ...ids].map(id => ({ id })) };
    const id = path.split('/')[1].split('?')[0]; const message = mail(id);
    return { id, threadId: id, internalDate: String(Date.parse(message.receivedAt)), payload: { headers: [{ name: 'Subject', value: message.subject }, { name: 'From', value: message.sender }], mimeType: 'text/plain', body: { data: Buffer.from(message.text).toString('base64url') } } };
  } };
}
async function applyDJ(collection = djCollection()) {
  await mkdir(desjardinsSnapshotDirectory, { recursive: true });
  const path = join(desjardinsSnapshotDirectory, 'synthetic-authority-preview.json');
  await writeFile(path, JSON.stringify(collection));
  await api.initializeDesjardinsStatus();
  await api.syncDesjardinsPortal(false, false, async () => ({ status: 'success', collection, snapshotPath: path }));
  return api.syncDesjardinsPortal(true);
}
const applyBC = (collection = bcCollection()) => api.syncBlueCrossPortal(true, false, async () => ({ status: 'success', collection, snapshotPath: 'synthetic' }));

for (const kind of ['ignore', 'invoice', 'receipt', 'bill']) test(`manual ${kind} survives full Gmail history/amount repair and restart`, async () => {
  const item = invoice(); await seed([item], { accounts: {} }); await api.correctInvoice(item.Id, kind);
  const before = (await read()).items[0]; let classified = 0;
  await api.collectInvoices(gmailDeps(['invoice-one'], async () => { classified++; return { result: { ...classification, member: 'Jasmine', amount: 999, kind: 'other' }, source: 'codex' }; }));
  await api.initializeInvoices(); await api.collectInvoices(gmailDeps(['invoice-one']));
  assert.equal(classified, 0); assert.deepEqual((await read()).items, [before]);
});

test('manual Closed/status and corrected beneficiary, amounts, allocation and opaque fields remain byte-equivalent', async () => {
  const item = invoice('invoice-one', { Member: 'Jasmine', BilledAmount: 125, DetectedAmount: 125, CustomAllocation: { chosen: 17 }, Healthcare: { ServiceDate: date, ServiceType: 'Physiotherapy', OriginalBilledAmount: 125, InsurerPayments: { 'blue-cross': 17 }, FieldSources: { OriginalBilledAmount: 'manual', 'InsurerPayments.blue-cross': 'manual' } } });
  await seed([item]); await api.updateInvoiceStatus(item.Id, 3); const before = (await read()).items[0];
  await api.collectInvoices(gmailDeps(['invoice-one'])); await api.initializeInvoices();
  assert.deepEqual((await read()).items, [before]);
  const payment = { ...bcInvoice(), Member: 'Jasmine' };
  const result = buildReconciliationSnapshot([before, payment], [{ reimbursementId: payment.Id, expenseId: before.Id, decision: 'confirmed', at: date }]);
  assert.equal(result.cases[0].BlueCrossReimbursedAmount, 17); assert.equal(result.cases[0].OriginalAmount, 125);
  assert.ok(result.cases[0].ReconciliationReasons.includes('manual-allocation-source-conflict'));
});

test('duplicate Gmail ingestion creates one stable source document', async () => {
  await seed([]); const deps = gmailDeps(['invoice-one']);
  await api.collectInvoices(deps); const before = (await read()).items;
  await api.collectInvoices(deps); assert.deepEqual((await read()).items, before);
  assert.equal(before.length, 1); assert.equal(before[0].Id, recordId(email, 'invoice-one'));
});

for (const insurer of ['Blue Cross', 'Desjardins']) test(`duplicate ${insurer} apply preserves historical ignored and manually reclassified rows`, async () => {
  await seed([]); const apply = insurer === 'Blue Cross' ? applyBC : applyDJ;
  await apply(); const item = (await read()).items[0];
  await api.updateInvoiceStatus(item.Id, 4); const before = await read();
  await apply(); await api.initializeInvoices(); await apply();
  assert.deepEqual((await read()).items, before.items); assert.equal((await read()).items.length, 1);
  await api.correctInvoice(item.Id, 'invoice'); const classified = (await read()).items;
  await apply(); assert.deepEqual((await read()).items, classified);
});

test('copied Blue Cross Gmail re-import respects ignored legacy status without CorrectedAt', async () => {
  const original = bcInvoice(); await seed([{ ...original, Status: 4, LastDecisionId: undefined, CorrectedAt: undefined }]);
  const before = (await read()).items[0];
  const deps = gmailDeps(['aabbccdd']); deps.gmail = async (_token, path) => ({ id: path.split('/')[1].split('?')[0], threadId: 'copy', payload: { headers: [{ name: 'Subject', value: 'Blue Cross statement' }], mimeType: 'text/plain', body: { data: Buffer.from(bcHtml()).toString('base64url') } } });
  await api.importBlueCrossMessages(email, ['aabbccdd'], true, deps);
  await api.importBlueCrossMessages(email, ['aabbccdd'], true, deps);
  assert.deepEqual((await read()).items.find(item => item.Id === original.Id), before);
  assert.equal((await read()).items.filter(item => item.StructuredSource).length, 1);
});

test('manual association remains authoritative when better candidates arrive, or its target is unavailable', async () => {
  const chosen = invoice('chosen', { BilledAmount: 120, Healthcare: { ServiceDate: date, ServiceType: 'Physiotherapy', OriginalBilledAmount: 120 } });
  const payment = bcInvoice(); const decision = { reimbursementId: payment.Id, expenseId: chosen.Id, decision: 'confirmed', at: date };
  await seed([chosen, payment], { matchDecisions: [decision] });
  const better = invoice('better');
  const initial = buildReconciliationSnapshot([chosen, payment], [decision]);
  const rescanned = buildReconciliationSnapshot([better, payment, chosen], [decision]);
  assert.equal(initial.cases[0].MatchAssignments[0].Verification, 'confirmed-manually');
  assert.equal(rescanned.cases.find(item => item.ExpenseDocumentIds.includes(chosen.Id)).MatchAssignments[0].ExpenseDocumentId, chosen.Id);
  const absent = buildReconciliationSnapshot([better, payment], [decision]);
  assert.equal(absent.cases[0].MatchAssignments.length, 0); assert.equal(absent.unmatched[0].DetailReason, 'manual-target-unavailable');
  await api.collectInvoices(gmailDeps(['chosen'])); await api.initializeInvoices();
  assert.deepEqual((await read()).matchDecisions, [decision]);
});

test('legacy migration is additive, repeatable and read-only initialization never persists', async () => {
  const item = invoice('invoice-one', { Sender: 'notifications@github.com', Subject: 'Workflow notification', Status: 3, LastDecisionId: undefined });
  await seed([item], { decisions: [{ id: 'old-decision', itemId: item.Id, type: 'status', at: date, before: { Status: 0 }, after: { Status: 3 } }], CustomLegacyField: { preserved: true } });
  const migrated = await read(); assert.equal(migrated.items[0].Status, 3); assert.equal(migrated.items[0].DocumentType, 'invoice');
  assert.ok(migrated.items[0].ManualOverride.Reasons.includes('decision-history')); assert.equal(migrated.CustomLegacyField.preserved, true);
  const bytes = await readFile(join(dir, 'invoices.json'), 'utf8'); await api.initializeInvoices(); assert.equal(await readFile(join(dir, 'invoices.json'), 'utf8'), bytes);
  await api.initializeInvoices(true); assert.equal(await readFile(join(dir, 'invoices.json'), 'utf8'), bytes);
  assert.deepEqual(migrated.items[0].Healthcare, item.Healthcare); assert.equal(migrated.items[0].Id, item.Id);
});

test('undoing one choice retains earlier authority and automatic replacement cannot erase extension fields', async () => {
  const item = invoice(); await seed([item]); const classified = await api.correctInvoice(item.Id, 'bill');
  const classifiedId = classified.LastDecisionId;
  const status = await api.updateInvoiceStatus(item.Id, 3);
  await assert.rejects(api.undoInvoiceDecision(classifiedId), /latest decision/);
  await api.undoInvoiceDecision(status.LastDecisionId);
  const current = (await read()).items[0]; assert.equal(current.LastDecisionId, classifiedId); assert.equal(current.DocumentType, 'bill');
  assert.strictEqual(automaticReplacement(current, invoice()), current);
  await api.undoInvoiceDecision(classifiedId); assert.equal((await read()).items[0].ManualOverride, undefined);
});

test('a manual Open choice made during asynchronous Gmail classification wins the serialized write', async () => {
  const item = invoice('invoice-one', { AnalysisVersion: 1, ClassificationSource: 'unavailable' });
  await seed([item]); let chosen;
  await api.collectInvoices(gmailDeps(['invoice-one'], async () => {
    if (!chosen) { await api.updateInvoiceStatus(item.Id, 0); chosen = (await read()).items[0]; }
    return { result: { ...classification, amount: 999, billedAmount: 999, member: 'Jasmine', kind: 'ignore' }, source: 'codex' };
  }));
  assert.deepEqual((await read()).items[0], chosen);
});

test('different stable Blue Cross claim IDs never merge through their business key, and duplicate payment evidence stays unresolved', async () => {
  const first = api.planBlueCrossUpsert([], bcCollection(20, 'EXPLICIT-ONE')).items[0];
  const second = api.planBlueCrossUpsert([first], bcCollection(20, 'EXPLICIT-TWO'));
  assert.equal(second.new, 1); assert.equal(second.changed, 0); assert.notEqual(second.items[0].Id, first.Id);
  const records = [invoice(), first, second.items[0]]; const snapshot = buildReconciliationSnapshot(records);
  assert.equal(snapshot.cases[0].MatchAssignments.length, 0); assert.equal(snapshot.unmatched.length, 2);
  assert.ok(snapshot.unmatched.every(item => item.DetailReason === 'possible-duplicate'));
  assert.deepEqual(buildReconciliationSnapshot(records.reverse()), snapshot);
  const legacy = { ...first, Id: 'legacy-id-with-stable-reference', Fingerprint: 'legacy-reference' };
  const enriched = api.planBlueCrossUpsert([legacy], bcCollection(25, 'EXPLICIT-ONE'));
  assert.equal(enriched.new, 0); assert.equal(enriched.items[0].Id, legacy.Id);
  assert.equal(api.planBlueCrossUpsert([first, { ...first }], bcCollection(25, 'EXPLICIT-ONE')).ambiguous, 1);
});

test('rejected pairs supersede older confirmations, and protected canonical copies retain the selected target identity', () => {
  const selected = invoice('selected'); const copy = invoice('copy'); const payment = bcInvoice();
  const shared = [selected, copy].map(item => ({ ...item, Healthcare: { ...item.Healthcare, InvoiceNumber: 'SHARED' } }));
  const confirmation = { reimbursementId: payment.Id, expenseId: selected.Id, decision: 'confirmed', at: '2026-09-04' };
  const snapshot = buildReconciliationSnapshot([...shared, payment], [confirmation]);
  assert.equal(snapshot.cases[0].MatchAssignments[0].ExpenseDocumentId, selected.Id);
  const rejected = buildReconciliationSnapshot([selected, payment], [confirmation, { ...confirmation, decision: 'rejected', at: '2026-09-05' }]);
  assert.equal(rejected.cases[0].MatchAssignments.length, 0); assert.equal(rejected.unmatched[0].DetailReason, 'manual-match-rejected');
});

test('uncertainty persists separately and distinct manual workflow decisions are never collapsed', async () => {
  const shared = [invoice('first'), invoice('second')].map(item => ({ ...item, Healthcare: { ...item.Healthcare, InvoiceNumber: 'SHARED' } }));
  await seed(shared, { workflowRecords: [
    { ExpenseDocumentId: shared[0].Id, ManualStatus: 'open', AutomaticStatus: 'open', ChangedAt: date, History: [] },
    { ExpenseDocumentId: shared[1].Id, ManualStatus: 'closed', AutomaticStatus: 'open', ChangedAt: date, History: [] }
  ] });
  const snapshot = await api.invoiceSnapshot(); assert.equal(snapshot.reconciliations.length, 2);
  assert.deepEqual(new Set(snapshot.reconciliations.map(item => item.WorkflowStatus)), new Set(['open', 'closed']));
  assert.ok((await read()).reconciliationIssues.Cases.every(item => item.Reasons.includes('invoice-without-reimbursement')));
  const before = (await read()).workflowRecords; await api.collectInvoices(gmailDeps(['first', 'second'])); await api.initializeInvoices();
  assert.deepEqual((await read()).workflowRecords, before);
});

const scenarios = [
  ['invoice + Desjardins', () => [invoice(), ...desjardinsInvoices(djCollection())], s => { assert.equal(s.cases[0].DesjardinsReimbursedAmount, 80); assert.equal(s.cases[0].PotentialRemaining, 20); }],
  ['primary + secondary / invoice + both insurers', () => [invoice(), ...desjardinsInvoices(djCollection()), bcInvoice()], s => { assert.equal(s.cases[0].ReimbursedAmount, 100); assert.equal(s.cases[0].Status, 'fully-reimbursed'); }],
  ['reimbursement without invoice', () => [bcInvoice()], s => assert.equal(s.unmatched[0].DetailReason, 'reimbursement-without-invoice')],
  ['invoice without reimbursement', () => [invoice()], s => assert.ok(s.cases[0].ReconciliationReasons.includes('invoice-without-reimbursement'))],
  ['partial reimbursement', () => [invoice(), bcInvoice(35)], s => assert.equal(s.cases[0].PotentialRemaining, 65)],
  ['amount mismatch', () => [invoice('invoice-one', { BilledAmount: 140, Healthcare: { ServiceDate: date, ServiceType: 'Physiotherapy', OriginalBilledAmount: 140 } }), bcInvoice()], s => assert.equal(s.unmatched[0].DetailReason, 'amount-mismatch')],
  ['ambiguous matches', () => [invoice(), invoice('invoice-two'), bcInvoice()], s => assert.equal(s.unmatched[0].DetailReason, 'several-plausible-matches')],
  ['duplicate source document', () => [invoice(), { ...invoice('copy'), Healthcare: { ...invoice().Healthcare, InvoiceNumber: 'SAME' } }].map(i => ({ ...i, Healthcare: { ...i.Healthcare, InvoiceNumber: 'SAME' } })), s => assert.equal(s.cases.length, 1)]
];
for (const [name, make, verify] of scenarios) test(`end-to-end ${name}: initial state equals full rescan/reconciliation state`, async () => {
  const items = make(); await seed(items); const initial = await api.invoiceSnapshot();
  const before = buildReconciliationSnapshot((await read()).items); verify(before);
  const ids = items.filter(item => !item.StructuredSource).map(item => item.SourceMessageId);
  await api.collectInvoices(gmailDeps(ids));
  if (items.some(item => item.StructuredSource === 'desjardins-portal')) await applyDJ();
  if (items.some(item => item.StructuredSource === 'blue-cross-portal')) await applyBC(bcCollection(items.find(item => item.StructuredSource === 'blue-cross-portal').ReimbursedAmount));
  await api.initializeInvoices(); await api.collectInvoices(gmailDeps(ids));
  const after = buildReconciliationSnapshot((await read()).items); verify(after);
  assert.deepEqual(after, before); assert.equal((await api.invoiceSnapshot()).items.length, initial.items.length);
  assert.deepEqual(buildReconciliationSnapshot([...items].reverse()), buildReconciliationSnapshot(items), 'source order is deterministic');
});

for (const status of ['open', 'closed', 'ignore']) test(`manual workflow ${status} survives full rescan, both insurers and restart`, async () => {
  const item = invoice(); await seed([item]); await api.setReimbursementWorkflowStatus(item.Id, status);
  const manual = (await read()).workflowRecords.find(record => record.ExpenseDocumentId === item.Id);
  await api.collectInvoices(gmailDeps(['invoice-one'])); await applyDJ(); await applyBC(); await api.initializeInvoices();
  const current = (await read()).workflowRecords.find(record => record.ExpenseDocumentId === item.Id);
  assert.equal(current.ManualStatus, status); assert.deepEqual(current.History, manual.History); assert.equal(current.ChangedAt, manual.ChangedAt);
  const snapshot = await api.invoiceSnapshot(); const cases = status === 'ignore' ? snapshot.ignoredExpenses : snapshot.reconciliations;
  assert.equal(cases[0].WorkflowStatus, status); assert.equal(cases[0].WorkflowOrigin, 'manual');
});
