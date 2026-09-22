import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidence, fingerprint, recordId, toInvoice, applyCorrection, validateClassification } from '../apps/worker/dist/invoice-model.js';
import { buildReconciliations } from '../apps/worker/dist/reconciliation.js';
import { normalizeMail } from '../apps/worker/dist/gmail-client.js';

const mail = { id: 'receipt-1', threadId: 'thread', internetMessageId: '<test@example.test>', subject: 'Your receipt', sender: 'Airline <billing@example.test>', receivedAt: '2026-09-20T12:00:00Z', text: 'Receipt #ABC123. Total paid CAD 150.00', labels: [], unsubscribe: false, bulk: false, attachments: [] };
const classification = { kind: 'receipt', confidence: .96, transaction: true, reimbursement: 'unknown', reason: 'Payment confirmed', amount: 150, currency: 'CAD', category: 'travel', member: 'Kevin', documentRole: 'expense', insurer: null, serviceDate: '2026-09-19', billedAmount: 150, reimbursedAmount: null };

test('WestJet-style sales language with a price and insurance words is marketing', () => {
  assert.equal(evidence({ ...mail, subject: 'WestJet offers', text: 'Save up to 40% off. Book now! $150 insurance benefits. Invoice help.', labels: ['CATEGORY_PROMOTIONS'], unsubscribe: true }).marketing, true);
});
test('a real receipt remains a candidate even with an unsubscribe footer and promotion label', () => {
  const result = evidence({ ...mail, text: mail.text + ' Unsubscribe. Book now!', labels: ['CATEGORY_PROMOTIONS'], unsubscribe: true });
  assert.equal(result.transaction, true); assert.equal(result.marketing, false);
});
test('low confidence marketing and ambiguous receipts go to review, never automatic claims', () => {
  for (const kind of ['marketing', 'receipt', 'invoice']) {
    const item = toInvoice(mail, 'a@example.test', 'Test', { ...classification, kind, confidence: .5 }, 'codex');
    assert.equal(item.Status, 0); assert.equal(item.NeedsReview, true);
  }
  assert.equal(toInvoice(mail, 'a@example.test', 'Test', classification, 'codex').Status, 0);
  assert.equal(toInvoice({ ...mail, text: '$150 travel', subject: 'Offer' }, 'a@example.test', 'Test', classification, 'codex').NeedsReview, true);
});
test('confidence gate, unavailable AI, and eligibility remain separate', () => {
  const item = toInvoice(mail, 'a@example.test', 'Test', classification, 'codex');
  assert.equal(item.NeedsReview, false); assert.equal(item.ReimbursementEligibility, 'unknown');
  assert.equal(toInvoice(mail, 'a@example.test', 'Test', classification, 'unavailable').NeedsReview, true);
});
test('high-confidence administrative notices do not require manual review', () => {
  const administrative = { ...classification, kind: 'administrative', confidence: .95, transaction: false, reimbursement: 'no', amount: null, currency: '', category: 'other' };
  const item = toInvoice({ ...mail, subject: 'Your statement is available', text: 'A new account statement is available.' }, 'a@example.test', 'Test', administrative, 'codex');
  assert.equal(item.NeedsReview, false); assert.equal(item.Status, 0); assert.equal(item.DocumentType, 'administrative');
  assert.equal(toInvoice({ ...mail, subject: 'Your statement is available', text: 'A new account statement is available.' }, 'a@example.test', 'Test', administrative, 'unavailable').NeedsReview, true);
});
test('manual correction is reversible and does not mark a claim submitted', () => {
  const item = toInvoice(mail, 'a@example.test', 'Test', classification, 'codex');
  const ignored = applyCorrection(item, 'marketing');
  assert.equal(ignored.Status, 4); assert.equal(ignored.ClassificationSource, 'manual');
  assert.equal(applyCorrection(ignored, 'invoice').Status, 0);
  assert.throws(() => applyCorrection(item, 'made-up'));
});
test('merchant marketing corrections cannot match its differently titled receipts; accounts deduplicate separately', () => {
  assert.notEqual(fingerprint(mail), fingerprint({ ...mail, subject: 'Weekly special offers' }));
  assert.equal(recordId('A@example.test', '1'), recordId('a@example.test', '1'));
  assert.notEqual(recordId('a@example.test', '1'), recordId('b@example.test', '1'));
});
test('reject malformed AI amounts, currency and confidence', () => {
  for (const patch of [{ confidence: 99 }, { amount: -1 }, { amount: '150' }, { currency: '$' }, { transaction: 'true' }, { category: 'anything' }]) {
    assert.throws(() => validateClassification({ ...classification, ...patch }));
  }
  assert.equal(validateClassification(classification).amount, 150);
});
test('reconciliation follows the two-insurer order and never presents a remaining balance as guaranteed', () => {
  const expense = toInvoice(mail, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', amount: 242, billedAmount: 242 }, 'codex');
  const statement = toInvoice({ ...mail, id: 'eob-1', subject: 'Desjardins statement', sender: 'Desjardins', receivedAt: '2026-09-22T12:00:00Z' }, 'kevin@example.test', 'Kevin', { ...classification, kind: 'claim', category: 'health', documentRole: 'insurer-statement', insurer: 'desjardins', amount: 100, billedAmount: null, reimbursedAmount: 100 }, 'codex');
  const result = buildReconciliations([expense, statement]);
  assert.equal(result[0].PotentialRemaining, 142); assert.equal(result[0].NextInsurer, 'Blue Cross');
  assert.match(result[0].Summary, /pas garanti/);
});
test('MIME normalization keeps source attachment identity, reads plain text, and does not treat attachment bytes as text', () => {
  const normalized = normalizeMail({ id: 'x', threadId: 't', internalDate: '1790000000000', payload: { headers: [{ name: 'Subject', value: 'Receipt' }], parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from('Paid CAD 15').toString('base64url') } },
    { mimeType: 'application/pdf', filename: 'receipt.pdf', body: { attachmentId: 'att-1', size: 100 } }
  ] } });
  assert.equal(normalized.text, 'Paid CAD 15'); assert.equal(normalized.attachments[0].Id, 'att-1');
});

test('collection resumes an interrupted page, deduplicates, preserves manual corrections, and reports per-account failures', async () => {
  // Use a separate process to set the data directory before module import; no real Google/Codex/credentials are used.
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-collection-'));
  try {
    const result = spawnSync(process.execPath, ['tests/fixtures/collection-runner.mjs'], { cwd: process.cwd(), env: { ...process.env, FAMILYHUB_WORKER_DATA: dir }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const saved = JSON.parse(await readFile(join(dir, 'invoices.json'), 'utf8'));
    assert.equal(saved.items.length, 2); assert.equal(saved.items[0].DocumentType, 'marketing');
    assert.equal(saved.accounts['test@example.test'].window, undefined);
    assert.ok(saved.accounts['test@example.test'].through);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
