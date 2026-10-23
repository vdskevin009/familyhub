import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'familyhub-evidence-pair-'));
process.env.FAMILYHUB_WORKER_DATA = dir;
const api = await import('../apps/worker/dist/invoices.js');
const common = { AccountLabel: 'Synthetic portal', AccountEmail: '', SourceMessageId: 'portal', ThreadId: 'portal',
  InternetMessageId: '', Sender: 'Synthetic insurer', Subject: 'Claim row', ReceivedAt: '2026-08-15T12:00:00Z',
  Category: 0, Status: 0, Currency: 'CAD', Notes: '', Attachments: [], WorkerManaged: true,
  ReimbursementEligibility: 'unknown', ClassificationSource: 'rules', AmountSource: 'email-text',
  HasUnsubscribe: false, AttentionLevel: 'none', AttentionReason: '', Reasons: [],
  Member: 'Kevin', ServiceDate: '2026-08-14', BilledAmount: 140, Confidence: 99, NeedsReview: false,
  DocumentRole: 'insurer-statement', DocumentType: 'claim' };
const rows = [
  { ...common, Id: 'dj', Fingerprint: 'dj', Provider: 'Desjardins · DÉTARTRAGE DEUX UNITÉS', ClaimedService: 'DÉTARTRAGE DEUX UNITÉS',
    Insurer: 'desjardins', StructuredSource: 'desjardins-portal', ReimbursedAmount: 112, DetectedAmount: 112 },
  { ...common, Id: 'bc', Fingerprint: 'bc', Provider: 'Blue Cross · Scaling, Two units', ClaimedService: 'Scaling, Two units',
    Insurer: 'blue-cross', StructuredSource: 'blue-cross-portal', ReimbursedAmount: 28, DetectedAmount: 28 }
];

test('derived pair workflow persists and restores atomically without creating an invoice', async () => {
  try {
    await writeFile(join(dir, 'invoices.json'), JSON.stringify({items: rows, accounts:{}}));
    await api.initializeInvoices();
    let snap = await api.invoiceSnapshot();
    assert.equal(snap.reconciliations.length, 1);
    const id = snap.reconciliations[0].ExpenseDocumentId;
    assert.equal(snap.reconciliations[0].WorkflowStatus, 'closed');
    assert.equal(snap.unmatchedReimbursements.length, 0);
    assert.equal(snap.items.length, 2);
    assert.ok(snap.items.every(row => row.DocumentRole === 'insurer-statement'));
    await api.setReimbursementWorkflowStatus(id, 'open');
    await api.initializeInvoices();
    snap = await api.invoiceSnapshot();
    assert.equal(snap.reconciliations[0].WorkflowStatus, 'open');
    assert.equal(snap.reconciliations[0].WorkflowOrigin, 'manual');
    await api.setReimbursementWorkflowStatus(id, 'ignore');
    await api.initializeInvoices();
    snap = await api.invoiceSnapshot();
    assert.equal(snap.reconciliations.length, 0);
    assert.equal(snap.ignoredExpenses.length, 1);
    assert.equal(snap.ignoredExpenses[0].DocumentIds.length, 2);
    assert.ok(snap.items.every(row => row.IgnoredAt));
    await api.setReimbursementWorkflowStatus(id, 'automatic');
    await api.initializeInvoices();
    snap = await api.invoiceSnapshot();
    assert.equal(snap.reconciliations[0].WorkflowStatus, 'closed');
    assert.equal(snap.reconciliations[0].WorkflowOrigin, 'automatic');
    assert.equal(snap.ignoredExpenses.length, 0);
    assert.ok(snap.items.every(row => !row.IgnoredAt));
    for (const original of rows) {
      const actual = snap.items.find(row => row.Id === original.Id);
      for (const key of ['BilledAmount','ReimbursedAmount','ClaimedService','ServiceDate','Member','Insurer']) assert.equal(actual[key], original[key]);
    }
    // API clients cannot use a derived insurer pair as an invoice target.
    let extra = JSON.parse(await readFile(join(dir,'invoices.json'),'utf8'));
    extra.items.push({ ...rows[1], Id:'unrelated', Fingerprint:'unrelated', ClaimedService:'Physiotherapy', Provider:'Physiotherapy' });
    await writeFile(join(dir,'invoices.json'),JSON.stringify(extra));await api.initializeInvoices();
    await assert.rejects(api.setManualMatch('unrelated',id), /Target expense not found/);
    extra = JSON.parse(await readFile(join(dir,'invoices.json'),'utf8'));
    extra.items = extra.items.filter(row=>row.Id!=='unrelated');
    await writeFile(join(dir,'invoices.json'),JSON.stringify(extra));await api.initializeInvoices();
    // A subsequently available receipt gets ordinary assignments and retains the owner workflow choice.
    await api.setReimbursementWorkflowStatus(id, 'open');
    const saved = JSON.parse(await readFile(join(dir,'invoices.json'),'utf8'));
    saved.items.push({ ...common, Id:'receipt', Fingerprint:'receipt', Provider:'Synthetic Clinic', ClaimedService:'Scaling, Two units',
      DocumentRole:'expense', DocumentType:'receipt', Insurer:null, ReimbursedAmount:null, DetectedAmount:140,
      Healthcare:{ServiceType:'Scaling, Two units',OriginalBilledAmount:140} });
    await writeFile(join(dir,'invoices.json'),JSON.stringify(saved));
    await api.initializeInvoices();
    snap = await api.invoiceSnapshot();
    assert.equal(snap.reconciliations.length,1);
    assert.equal(snap.reconciliations[0].ExpenseDocumentId,'receipt');
    assert.equal(snap.reconciliations[0].MatchAssignments.length,2);
    assert.equal(snap.reconciliations[0].WorkflowStatus,'open');
    assert.equal(snap.reconciliations[0].WorkflowOrigin,'manual');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
