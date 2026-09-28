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
const predetermination = {
  ...toInvoice({
    ...baseMail,
    id: 'desjardins-predetermination',
    subject: 'Your health or dental care predetermination has been processed',
    receivedAt: '2025-07-04T15:05:13Z',
    text: 'The explanation of benefits for your health or dental care predetermination is now available in the “Claims history” section of your secure site at www.desjardinslifeinsurance.com/planmember.',
    attachments: [{ Id: 'logo', FileName: 'LogoAn.png', MimeType: 'image/png', Size: 100 }]
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
const realPredeterminationStatement = {
  ...toInvoice({
    ...baseMail,
    id: 'desjardins-predetermination-eob',
    subject: 'Your health or dental care predetermination has been processed',
    receivedAt: '2025-07-05T15:05:13Z',
    text: 'Explanation of benefits. Amount paid: CAD $75.00.'
  }, account, 'Kevin', { ...statusClassification, confidence: .99, amount: 75, reimbursedAmount: 75, serviceDate: '2025-07-01' }, 'rules'),
  HistoricalCandidate: true
};

const path = join(process.env.FAMILYHUB_WORKER_DATA, 'invoices.json');
await writeFile(path, JSON.stringify({
  items: [received, processed, predetermination, realStatement, realPredeterminationStatement],
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
for (const id of ['desjardins-received', 'desjardins-processed', 'desjardins-predetermination']) {
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
const genuinePredetermination = byId.get('desjardins-predetermination-eob');
assert.equal(genuinePredetermination.DocumentType, 'claim');
assert.equal(genuinePredetermination.DocumentRole, 'insurer-statement');
assert.equal(genuinePredetermination.ReimbursedAmount, 75);
assert.deepEqual(new Set(snapshot.unmatchedReimbursements.map(item => item.DocumentId)), new Set([genuine.Id, genuinePredetermination.Id]));

const saved = JSON.parse(await readFile(path, 'utf8'));
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-received').DocumentType, 'administrative');
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-processed').DocumentRole, 'other');
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-predetermination').DocumentRole, 'other');
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-real-eob').DocumentRole, 'insurer-statement');
assert.equal(saved.items.find(item => item.SourceMessageId === 'desjardins-predetermination-eob').DocumentRole, 'insurer-statement');
