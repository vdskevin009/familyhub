import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeInvoices, collectInvoices, classify, invoiceSnapshot, healthReceiptRepairVersion } from '../../apps/worker/dist/invoices.js';
import { toInvoice } from '../../apps/worker/dist/invoice-model.js';

process.env.FAMILYHUB_CODEX_PATH = '/synthetic/no-codex';
const account = 'test@example.test';
const mail = { id: 'clinic-receipt', threadId: 'thread', internetMessageId: '<clinic@example.test>',
  subject: 'Your Receipt - Example Clinic', sender: 'Clinic <notifications@janeapp.com>', receivedAt: '2026-09-17T20:00:00Z',
  text: 'Below is a Receipt for your visit.', labels: [], unsubscribe: false, bulk: false,
  attachments: [{ Id: 'pdf', FileName: 'Example-Invoice-XYZ123.pdf', MimeType: 'application/pdf', Size: 100,
    AnalysisStatus: 'text-extracted' }], attachmentText: 'Invoice #XYZ123 Massage therapy Amount not covered: $38.00' };
// File naming is not evidence of the billed total or insurance payment. Both Jane
// invoice and receipt PDFs still need readable invoice identity and a care service.
for (const name of ['Example-Invoice-XYZ123.pdf', 'Example-Receipt-2026-09-17.pdf']) {
  const result = await classify({ ...mail, attachments: [{ ...mail.attachments[0], FileName: name }] }, account);
  assert.equal(result.source, 'rules');
  assert.equal(result.result.documentRole, 'expense');
  assert.equal(result.result.reimbursement, 'possible');
  assert.equal(result.result.billedAmount, null);
  assert.equal(result.result.reimbursedAmount, null);
}
mail.attachments[0].FileName = 'Example-Receipt-2026-09-17.pdf';
for (const candidate of [
  { ...mail, attachmentText: 'Massage therapy Amount not covered: $38.00' },
  { ...mail, attachmentText: 'Invoice #XYZ123 Amount not covered: $38.00' },
  { ...mail, attachments: [{ ...mail.attachments[0], AnalysisStatus: 'failed' }] },
  { ...mail, subject: 'Appointment reminder' },
]) {
  assert.notEqual((await classify(candidate, account)).result.documentRole, 'expense');
}
const old = toInvoice(mail, account, 'Test', { kind: 'other', confidence: .95, transaction: false,
  reimbursement: 'unknown', reason: 'Prior mistake', amount: null, currency: '', category: 'other', member: 'unknown',
  documentRole: 'other', insurer: null, serviceDate: null, billedAmount: null, reimbursedAmount: null }, 'codex');
assert.equal((await classify(mail, account)).result.category, 'health');
const path = join(process.env.FAMILYHUB_WORKER_DATA, 'invoices.json');
await writeFile(path, JSON.stringify({ items: [old], corrections: [], decisions: [], reviews: [],
  accounts: { [account]: { through: Math.floor(Date.now() / 1000) } } }));
await initializeInvoices();
let searched = 0;
const deps = { credentials: async () => ({ accounts: [{ email: account, label: 'Test' }] }), accessToken: async () => 'synthetic',
  classify: async () => classify(mail, account), reviewer: async () => ({ explanation: 'synthetic' }),
  gmail: async (_token, request) => {
    if (request.startsWith('messages?')) {
      const q = new URL(request, 'https://example.test/').searchParams.get('q');
      if (q.includes('subject:"Your Receipt"')) { searched++; return { messages: [{ id: mail.id }] }; }
      return { messages: [] };
    }
    if (request === `messages/${mail.id}?format=full`) return { id: mail.id, threadId: mail.threadId,
      internalDate: String(Date.parse(mail.receivedAt)), payload: { headers: [
        { name: 'Subject', value: mail.subject }, { name: 'From', value: mail.sender }
      ], mimeType: 'text/plain', body: { data: Buffer.from(mail.text).toString('base64url') },
      parts: [{ mimeType: 'text/plain', filename: mail.attachments[0].FileName, body: { attachmentId: 'pdf', size: 100 } }] } };
    if (request.endsWith('/attachments/pdf')) return { data: Buffer.from(mail.attachmentText).toString('base64url') };
    throw new Error(`Unexpected Gmail call: ${request}`);
  } };
await collectInvoices(deps);
let snapshot = await invoiceSnapshot();
assert.equal(searched, 1);
assert.equal(snapshot.items.length, 1);
assert.equal(snapshot.items[0].Category, 0);
assert.equal(snapshot.items[0].DocumentRole, 'expense');
assert.equal(snapshot.items[0].NeedsReview, true);
assert.equal(snapshot.reconciliations.length, 1);
assert.equal(snapshot.progress[account].healthReceiptRepairVersion, healthReceiptRepairVersion);
await collectInvoices(deps);
snapshot = await invoiceSnapshot();
assert.equal(searched, 1);
assert.equal(snapshot.items.length, 1);
console.log('Previously missed clinic receipt recovered as one reviewable expense.');

// A current receipt already fetched after completed history is retried in place
// by the normal daily run; it must not require another historical scan.
await writeFile(path, JSON.stringify({ items: [{ ...old, ClassificationSource: 'unavailable', Confidence: 0 }],
  corrections: [], decisions: [{ id: 'preserved-decision' }], reviews: [],
  accounts: { [account]: { through: Math.floor(Date.now() / 1000), invoiceHistoryVersion: 1,
    healthReceiptRepairVersion } } }));
await initializeInvoices(true);
const priorSearches = searched;
await collectInvoices(deps);
snapshot = await invoiceSnapshot();
assert.equal(searched, priorSearches, 'no new history traversal');
assert.equal(snapshot.items.length, 1);
assert.equal(snapshot.items[0].Id, old.Id);
assert.equal(snapshot.items[0].SourceMessageId, mail.id);
assert.equal(snapshot.items[0].DocumentType, 'receipt');
assert.equal(snapshot.items[0].DocumentRole, 'expense');
assert.equal(snapshot.items[0].ClassificationSource, 'rules');
assert.equal(snapshot.items[0].NeedsReview, true);
assert.equal(snapshot.items[0].BilledAmount, null, 'residual is not original total');
assert.equal(snapshot.items[0].ReimbursedAmount, null, 'unknown insurance stays unknown');
assert.equal(snapshot.reconciliations.length, 1);
assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).decisions, [{ id: 'preserved-decision' }]);
await collectInvoices(deps);
assert.equal((await invoiceSnapshot()).items.length, 1, 'daily rerun cannot duplicate the receipt');
console.log('Current receipt recovered through bounded daily retry without a historical rescan.');
