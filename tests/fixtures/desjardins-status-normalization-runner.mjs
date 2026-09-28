import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeInvoices, invoiceSnapshot } from '../../apps/worker/dist/invoices.js';
import { toInvoice } from '../../apps/worker/dist/invoice-model.js';

const account = 'test@example.test';
const baseMail = {
  id: 'desjardins-received',
  threadId: 'desjardins-thread',
  internetMessageId: '<desjardins-status@example.test>',
  subject: 'Your claim has been received',
  sender: 'Desjardins Insurance <eob@dsf.ca>',
  receivedAt: '2025-06-02T16:26:33Z',
  text: 'Thank you for sending your claim online. Once processed, your explanation of benefits will be posted in Claims history.',
  labels: [],
  unsubscribe: false,
  bulk: false,
  attachments: []
};
const statusClassification = {
  kind: 'claim',
  confidence: .6,
  transaction: true,
  reimbursement: 'unknown',
  reason: 'Legacy historical classification',
  amount: null,
  currency: '',
  category: 'health',
  member: 'Kevin',
  documentRole: 'insurer-statement',
  insurer: 'desjardins',
  serviceDate: null,
  billedAmount: null,
  reimbursedAmount: null
};
const received = { ...toInvoice(baseMail, account, 'Kevin', statusClassification, 'rules'), HistoricalCandidate: true };
const processed = {
  ...toInvoice({
    ...baseMail,
    id: 'desjardins-processed',
    subject: 'Your claim has been processed',
    receivedAt: '2025-06-03T15:05:10Z',
    text: 'The explanation of benefits for your claim has now been posted on the Claims history section of your secure site.'
  }, account, 'Kevin', statusClassification, 'rules'),
  HistoricalCandidate: true
};
const realStatement = {
  ...toInvoice({
    ...baseMail,
    id: 'desjardins-real-eob',
    subject: 'Your claim has been processed',
    receivedAt: '2025-06-04T15:05:10Z',
    text: 'Explanation of benefits. Amount paid: CAD $75.00.'
  }, account, 'Kevin', { ...statusClassification, confidence: .99, amount: 75, reimbursedAmount: 75, serviceDate: '2025-06-01' }, 'rules'),
  HistoricalCandidate: true
};

const path = join(process.env.FAMILYHUB_WORKER_DATA, 'invoices.json');
await writeFile(path, JSON.stringify({
  items: [received, processed, realStatement],
  corrections: [],
  decisions: [],
  matchDecisions: [],
  workflowRecords: [],
  reviews: [],
  accounts: {}
}));

await initializeInvoices();
const snapshot = await invoiceSnapshot();
const byId = new Map(snapshot.items.map(item => [item.SourceMessageId, item]));
for (const id of ['desjardins-received', 'desjardins-processed']) {
  const item = byId.get(id);
  assert.equal(item.DocumentType, 'administrative');
  assert.equal(item.DocumentRole, 'other');
  assert.equal(item.Category, 2);
  assert.equal(item.ReimbursementEligibility, 'no');
  assert.equal(item.NeedsReview, false);
}
const genuine = byId.get('desjardins-real-eob');
assert.equal(genuine.DocumentType, 'claim');
assert.equal(genuine.DocumentRole, 'insurer-statement');
assert.equal(genuine.Category, 0);
assert.equal(genuine.ReimbursedAmount, 75);
assert.deepEqual(snapshot.unmatchedReimbursements.map(item => item.DocumentId), [genuine.Id]);

const saved = JSON.parse(await readFile(path, 'utf8'));
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-received').DocumentType, 'administrative');
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-processed').DocumentRole, 'other');
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-real-eob').DocumentRole, 'insurer-statement');
