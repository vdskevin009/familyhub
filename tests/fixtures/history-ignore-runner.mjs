import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeInvoices, collectInvoices, invoiceSnapshot, setExpenseIgnored, invoiceHistoryStart } from '../../apps/worker/dist/invoices.js';
const account = 'test@example.test';
const classification = { kind: 'receipt', confidence: .97, transaction: true, reimbursement: 'unknown', reason: 'Synthetic',
  amount: 40, currency: 'CAD', category: 'health', member: 'Kevin', documentRole: 'expense', insurer: null,
  serviceDate: '2025-06-01', billedAmount: 40, reimbursedAmount: null,
  healthcare: { InvoiceNumber: 'SYNTHETIC-1', Provider: 'Example Clinic', OriginalBilledAmount: 40 } };
let fail = true, classified = 0, historyCalls = [];
const deps = {
  credentials: async () => ({ accounts: [{ email: account, label: 'Test' }] }), accessToken: async () => 'synthetic',
  classify: async () => { classified++; return { result: classification, source: 'codex' }; },
  historicalClassify: async () => { classified++; return { result: classification, source: 'codex' }; },
  reviewer: async () => ({ verdict: 'missing-evidence', candidateId: null, confidence: .5, explanation: 'Synthetic', evidenceIds: [] }),
  gmail: async (_token, path) => {
    if (path.startsWith('messages?')) {
      const params = new URL(path, 'https://example.test/').searchParams;
      const query = params.get('q');
      if (!query.includes(`after:${invoiceHistoryStart} `)) return { messages: [] };
      assert.match(query, /has:attachment/);
      assert.doesNotMatch(query, /in:inbox/);
      assert.match(query, /-in:sent -in:drafts/);
      const page = params.get('pageToken') || 'first'; historyCalls.push(page);
      if (page === 'first') return { messages: [{ id: 'one' }], nextPageToken: 'second' };
      if (page === 'second') { if (fail) throw new Error('Synthetic transient failure'); return { messages: [{ id: 'copy' }], nextPageToken: 'third' }; }
      if (page === 'third') return { messages: [{ id: 'one' }] };
      throw new Error('Unexpected synthetic page');
    }
    const id = path.match(/^messages\/([^?]+)\?/)?.[1];
    if (id) return { id, threadId: 'thread', internalDate: String(Date.parse('2025-06-01T07:00:00Z')),
      payload: { headers: [{ name: 'Subject', value: 'Document' }, { name: 'From', value: 'Example Clinic' }],
        mimeType: 'text/plain', body: { data: Buffer.from('Invoice #SYNTHETIC-1. Total paid CAD 40').toString('base64url') } } };
    throw new Error('Unexpected synthetic request');
  }
};
await initializeInvoices();
await collectInvoices(deps);
let snapshot = await invoiceSnapshot();
assert.equal(snapshot.coverage.complete, false);
assert.equal(snapshot.progress[account].invoiceHistoryWindow.page, 'second');
assert.equal(snapshot.items.length, 1);
const first = snapshot.items[0];
await setExpenseIgnored([first.Id], true);
assert.equal((await invoiceSnapshot()).reconciliations.length, 0);
await initializeInvoices(); // Restart retains the exact ignore decision.
fail = false;
await collectInvoices(deps);
snapshot = await invoiceSnapshot();
assert.equal(snapshot.progress[account].invoiceHistoryVersion, 1);
assert.equal(snapshot.progress[account].invoiceHistoryWindow, undefined);
assert.equal(snapshot.progress[account].error, undefined);
assert.deepEqual(historyCalls, ['first', 'second', 'second', 'third']);
assert.equal(snapshot.items.length, 2);
assert.equal(classified, 2); // The ignored source was not reclassified.
assert.equal(snapshot.reconciliations.length, 0); // The exact duplicate inherits ignore.
assert.equal(snapshot.ignoredExpenses.length, 1);
assert.equal(snapshot.ignoredExpenses[0].DocumentIds.length, 2);
assert.ok(snapshot.items.every(item => item.IgnoredAt && item.Status === 4));
const saved = JSON.parse(await readFile(join(process.env.FAMILYHUB_WORKER_DATA, 'invoices.json'), 'utf8'));
assert.equal(saved.corrections.length, 0, 'Ignore must not train a provider/template rule');
assert.ok(saved.items.every(item => item.Status === 0), 'Underlying statuses remain available for restoration');
await assert.rejects(() => setExpenseIgnored(['missing'], true), /unavailable/);
await setExpenseIgnored(snapshot.ignoredExpenses[0].DocumentIds, false);
await initializeInvoices();
snapshot = await invoiceSnapshot();
assert.equal(snapshot.ignoredExpenses.length, 0);
assert.equal(snapshot.reconciliations.length, 1);
assert.equal(snapshot.reconciliations[0].DocumentIds.length, 2);
await collectInvoices(deps);
assert.equal(historyCalls.length, 4, 'Completed historical audit is not repeated');
console.log('Historical pagination, restart, exact ignore, duplicate inheritance and restoration verified.');
