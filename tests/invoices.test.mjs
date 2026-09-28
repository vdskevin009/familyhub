import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidence, fingerprint, recordId, toInvoice, applyCorrection, repairHealthcareAmounts, validateClassification } from '../apps/worker/dist/invoice-model.js';
import { buildReconciliationSnapshot, buildReconciliations } from '../apps/worker/dist/reconciliation.js';
import { automaticWorkflowStatus } from '../apps/worker/dist/reimbursement-workflow.js';
import { normalizeMail, withAttachmentText } from '../apps/worker/dist/gmail-client.js';

const mail = { id: 'receipt-1', threadId: 'thread', internetMessageId: '<test@example.test>', subject: 'Your receipt', sender: 'Airline <billing@example.test>', receivedAt: '2026-09-20T12:00:00Z', text: 'Receipt #ABC123. Total paid CAD 150.00', labels: [], unsubscribe: false, bulk: false, attachments: [] };
const classification = { kind: 'receipt', confidence: .96, transaction: true, reimbursement: 'unknown', reason: 'Payment confirmed', amount: 150, currency: 'CAD', category: 'travel', member: 'Kevin', documentRole: 'expense', insurer: null, serviceDate: '2026-09-19', billedAmount: 150, reimbursedAmount: null };

function assertExclusive(snapshot) {
  const assigned = new Set(snapshot.cases.flatMap(item => (item.MatchAssignments || []).map(match => match.ReimbursementDocumentId)));
  for (const item of snapshot.unmatched) assert.equal(assigned.has(item.DocumentId), false,
    'an active reimbursement assignment cannot also appear in Unmatched');
}

test('automatic Combined Benefits closure uses trusted named assignments without guessing their order', () => {
  const base = {
    Member: 'Nathan', PrimaryInsurer: null, SecondaryInsurer: null, Status: 'needs-attention', Action: 'review-amount',
    PotentialRemaining: 24, HasUnresolvedReimbursementEvidence: false,
    MatchAssignments: [
      { Insurer: 'desjardins', Verification: 'auto' },
      { Insurer: 'blue-cross', Verification: 'confirmed-manually' }
    ]
  };
  assert.equal(automaticWorkflowStatus(base), 'closed');
  assert.equal(automaticWorkflowStatus({ ...base, Member: 'Kevin', PrimaryInsurer: 'Desjardins', SecondaryInsurer: 'Blue Cross' }), 'closed');
  assert.equal(automaticWorkflowStatus({ ...base, MatchAssignments: base.MatchAssignments.slice(0, 1) }), 'open');
  assert.equal(automaticWorkflowStatus({ ...base, MatchAssignments: [base.MatchAssignments[0], { ...base.MatchAssignments[1], Verification: 'review-recommended' }] }), 'open');
  assert.equal(automaticWorkflowStatus({ ...base, HasUnresolvedReimbursementEvidence: true }), 'open');
});

test('final Unmatched projection excludes every active assignment across auto, review, confirmation and rejection', () => {
  const expense = { Id: 'synthetic-expense', Category: 0, Status: 0, DocumentRole: 'expense', DocumentType: 'invoice',
    Member: 'Jasmine', Provider: 'Sample Physiotherapy', ServiceDate: '2026-04-06', BilledAmount: 200,
    DetectedAmount: 200, ReimbursedAmount: null, Currency: 'CAD', Confidence: 60, NeedsReview: true,
    Healthcare: { ServiceDate: '2026-04-06', ServiceType: 'Physiotherapy', OriginalBilledAmount: 200,
      InsurerPayments: { 'blue-cross': 120 }, FieldStates: { 'InsurerPayments.blue-cross': 'confirmed' },
      FieldSources: { 'InsurerPayments.blue-cross': 'attachment' } } };
  const statement = { ...expense, Id: 'synthetic-statement', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    Provider: 'Blue Cross · Physiotherapy', Insurer: 'blue-cross', BilledAmount: 200, DetectedAmount: 120,
    ReimbursedAmount: 120, Confidence: 99, NeedsReview: false,
    Healthcare: { ServiceDate: '2026-04-06', ServiceType: 'Physiotherapy', SubmittedAmount: 200 } };
  const auto = buildReconciliationSnapshot([expense, statement]);
  assertExclusive(auto);
  assert.equal(auto.unmatched.length, 0);
  assert.equal(auto.cases[0].MatchAssignments[0].Verification, 'auto');

  const review = buildReconciliationSnapshot([expense, { ...statement, NeedsReview: true }]);
  assertExclusive(review);
  assert.equal(review.unmatched.length, 0);
  assert.equal(review.cases[0].MatchAssignments[0].Verification, 'review-recommended');

  const decision = { reimbursementId: statement.Id, expenseId: expense.Id, at: '2026-04-07T00:00:00Z' };
  const confirmed = buildReconciliationSnapshot([expense, statement], [{ ...decision, decision: 'confirmed' }]);
  assertExclusive(confirmed);
  assert.equal(confirmed.cases[0].MatchAssignments[0].Verification, 'confirmed-manually');
  const rejected = buildReconciliationSnapshot([expense, statement], [{ ...decision, decision: 'rejected' }]);
  assertExclusive(rejected);
  assert.equal(rejected.cases[0].MatchAssignments.length, 0);
  assert.deepEqual(rejected.unmatched, [{ DocumentId: statement.Id, Reason: 'no-expense-match' }]);

  const ambiguous = buildReconciliationSnapshot([expense, { ...expense, Id: 'another-expense' }, statement]);
  assertExclusive(ambiguous);
  assert.deepEqual(ambiguous.unmatched, [{ DocumentId: statement.Id, Reason: 'ambiguous-match' }]);
  const noMatch = buildReconciliationSnapshot([expense, { ...statement, ServiceDate: '2026-04-08', Healthcare: { ...statement.Healthcare, ServiceDate: '2026-04-08' } }]);
  assertExclusive(noMatch);
  assert.deepEqual(noMatch.unmatched, [{ DocumentId: statement.Id, Reason: 'no-expense-match' }]);
});

test('forwarded invoice copies form one expense; only the corroborated insurer payment is linked', () => {
  const receipt = { Id: 'original-receipt', Category: 0, Status: 0, DocumentRole: 'expense', DocumentType: 'invoice',
    Member: 'Kevin', Provider: 'Sample Massage Clinic', Subject: 'Synthetic massage invoice', AccountLabel: 'mailbox',
    ServiceDate: '2026-04-09', BilledAmount: 180,
    DetectedAmount: 180, ReimbursedAmount: null, Currency: 'CAD', Confidence: 60, NeedsReview: true,
    Healthcare: { ServiceDate: '2026-04-09', ServiceType: 'Massage therapy', InvoiceNumber: 'SYNTHETIC-123',
      OriginalBilledAmount: 180, PatientBalance: 60, InsurerPayments: { 'blue-cross': 120 },
      FieldStates: { 'InsurerPayments.blue-cross': 'confirmed' }, FieldSources: { 'InsurerPayments.blue-cross': 'attachment' } } };
  const forwarded = { ...receipt, Id: 'forwarded-receipt' };
  const paid = { ...receipt, Id: 'paid-statement', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    Insurer: 'blue-cross', StructuredSource: 'blue-cross-portal', Provider: 'Blue Cross · Massage therapy', BilledAmount: 180,
    ReimbursedAmount: 120, DetectedAmount: 120, Confidence: 99,
    Healthcare: { ServiceDate: '2026-04-09', ServiceType: 'Massage therapy', SubmittedAmount: 180 } };
  const zero = { ...paid, Id: 'separate-zero-processing', ReimbursedAmount: 0, DetectedAmount: 0, NeedsReview: true };
  const snapshot = buildReconciliationSnapshot([receipt, forwarded, zero, paid]);
  assertExclusive(snapshot);
  assert.equal(snapshot.cases.length, 1);
  assert.deepEqual(new Set(snapshot.cases[0].ExpenseDocumentIds), new Set([receipt.Id, forwarded.Id]));
  assert.equal(snapshot.cases[0].OriginalAmount, 180);
  assert.equal(snapshot.cases[0].ReimbursedAmount, 120);
  assert.equal(snapshot.cases[0].PotentialRemaining, 60);
  assert.deepEqual(snapshot.cases[0].MatchAssignments.map(x => x.ReimbursementDocumentId), [paid.Id]);
  assert.deepEqual(snapshot.unmatched, [{ DocumentId: zero.Id, Reason: 'needs-review' }]);

  const conflictingCopy = { ...forwarded, Healthcare: { ...forwarded.Healthcare,
    InsurerPayments: { 'blue-cross': 100 } } };
  const conflicted = buildReconciliationSnapshot([receipt, conflictingCopy, paid]);
  assertExclusive(conflicted);
  assert.equal(conflicted.cases.length, 1);
  assert.deepEqual(conflicted.unmatched, [{ DocumentId: paid.Id, Reason: 'needs-review' }]);
});

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
  const statement = toInvoice({ ...mail, id: 'eob-1', subject: 'Desjardins statement: Airline', sender: 'Desjardins', receivedAt: '2026-09-22T12:00:00Z' }, 'kevin@example.test', 'Kevin', { ...classification, kind: 'claim', category: 'health', documentRole: 'insurer-statement', insurer: 'desjardins', amount: 100, billedAmount: null, reimbursedAmount: 100 }, 'codex');
  const result = buildReconciliations([expense, statement]);
  assert.equal(result[0].PotentialRemaining, 142); assert.equal(result[0].NextInsurer, 'Blue Cross');
  assert.equal(result[0].PrimaryReimbursedAmount, 100); assert.equal(result[0].SecondaryReimbursedAmount, 0);
  assert.equal(result[0].Status, 'waiting-secondary');
  assert.match(result[0].Summary, /pas garanti/);
});
test('reconciliation leaves an ambiguous insurer statement unmatched instead of guessing', () => {
  const first = toInvoice({ ...mail, id: 'expense-a', subject: 'Clinic receipt A' }, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', amount: 200, billedAmount: 200 }, 'codex');
  const second = toInvoice({ ...mail, id: 'expense-b', subject: 'Clinic receipt B' }, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', amount: 180, billedAmount: 180 }, 'codex');
  const statement = toInvoice({ ...mail, id: 'ambiguous-eob', subject: 'Desjardins statement: Airline', sender: 'Desjardins' }, 'kevin@example.test', 'Kevin', { ...classification, kind: 'claim', category: 'health', documentRole: 'insurer-statement', insurer: 'desjardins', amount: 80, billedAmount: null, reimbursedAmount: 80 }, 'codex');
  const result = buildReconciliationSnapshot([first, second, statement]);
  assert.equal(result.cases[0].ReimbursedAmount, 0);
  assert.equal(result.cases[1].ReimbursedAmount, 0);
  assert.deepEqual(result.unmatched, [{ DocumentId: statement.Id, Reason: 'ambiguous-match' }]);
});
test('same-day expenses are not collapsed just because one provider is a patient name', () => {
  const first = toInvoice({ ...mail, id: 'september-15-a', subject: 'Massage receipt', text: 'Massage paid CAD 95.00' }, 'kevin@example.test', 'Kevin',
    { ...classification, category: 'health', serviceDate: '2026-09-15', amount: 95, billedAmount: 95 }, 'codex');
  const second = toInvoice({ ...mail, id: 'september-15-b', subject: 'Physio receipt', text: 'Physio paid CAD 140.00' }, 'kevin@example.test', 'Kevin',
    { ...classification, category: 'health', serviceDate: '2026-09-15', amount: 140, billedAmount: 140 }, 'codex');
  first.Provider = 'Kevin Vanderstraeten';
  second.Provider = 'North Shore Physio';
  const cases = buildReconciliationSnapshot([first, second]).cases;
  assert.equal(cases.length, 2);
  assert.deepEqual(new Set(cases.flatMap(item => item.DocumentIds)), new Set([first.Id, second.Id]));
});
test('fully reimbursed expenses expose primary and secondary totals separately', () => {
  const expense = toInvoice({ ...mail, id: 'expense-full' }, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', amount: 200, billedAmount: 200 }, 'codex');
  const primary = toInvoice({ ...mail, id: 'primary-eob', subject: 'Desjardins statement' }, 'kevin@example.test', 'Kevin', { ...classification, kind: 'claim', category: 'health', documentRole: 'insurer-statement', insurer: 'desjardins', amount: 120, billedAmount: null, reimbursedAmount: 120 }, 'codex');
  const secondary = toInvoice({ ...mail, id: 'secondary-eob', subject: 'Blue Cross statement' }, 'kevin@example.test', 'Kevin', { ...classification, kind: 'claim', category: 'health', documentRole: 'insurer-statement', insurer: 'blue-cross', amount: 80, billedAmount: null, reimbursedAmount: 80 }, 'codex');
  const result = buildReconciliations([expense, primary, secondary])[0];
  assert.equal(result.PrimaryReimbursedAmount, 120);
  assert.equal(result.SecondaryReimbursedAmount, 80);
  assert.equal(result.PotentialRemaining, 0);
  assert.equal(result.Status, 'fully-reimbursed');
});

test('QubeCore/Jane direct-insurance receipt keeps gross expense, primary payment and patient balance separate', () => {
  const source = { ...mail, id: 'qubecore-direct-receipt', subject: 'Your Receipt - QubeCore Sports & Rehab',
    sender: 'QubeCore Sports & Rehab <notifications@janeapp.com>', receivedAt: '2026-09-17T21:32:00Z',
    text: 'Invoice #138636-P01. Service date: 2026-09-17. SEPTEMBER 17, 2026 - 1:15PM, RMT - FOLLOW UP MASSAGE (60 MINUTES) $142.86 $7.14 $150.00\nDESJARDINS INSURANCE (TELUS eClaims) #060824356 / 869198 Massage therapy Amount not covered: $38.00 -$106.67 -$5.33 -$112.00\nSUBTOTAL $36.19\nGST $1.81\nTOTAL $38.00',
    attachmentText: '' };
  const receipt = toInvoice(source, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', member: 'Kevin',
    documentRole: 'expense', amount: 36.19, billedAmount: 36.19, serviceDate: '2026-09-17', reason: 'receipt' }, 'codex');
  assert.equal(receipt.BilledAmount, 150);
  assert.equal(receipt.DetectedAmount, 150);
  assert.equal(receipt.Healthcare?.InsurerPayments?.desjardins, 112);
  assert.equal(receipt.Healthcare?.PatientBalance, 38);
  const result = buildReconciliationSnapshot([receipt]).cases[0];
  assert.equal(result.OriginalAmount, 150);
  assert.equal(result.PrimaryReimbursedAmount, 112);
  assert.equal(result.SecondaryReimbursedAmount, 0);
  assert.equal(result.PotentialRemaining, 38);
  assert.equal(result.Status, 'waiting-secondary');

  const oldIndexed = { ...receipt, BilledAmount: 36.19, DetectedAmount: 36.19,
    Healthcare: { ...receipt.Healthcare, OriginalBilledAmount: 36.19, InsurerPayments: {}, ProcessedInsurers: ['desjardins'] },
    ReimbursementEligibility: 'unknown', ClassificationSource: 'codex', CorrectedAt: '2026-09-18T00:00:00Z' };
  const repaired = repairHealthcareAmounts(oldIndexed, source);
  assert.equal(repaired.BilledAmount, 150);
  assert.equal(repaired.DetectedAmount, 150);
  assert.equal(repaired.Healthcare?.InsurerPayments?.desjardins, 112);
  assert.equal(repaired.ReimbursementEligibility, oldIndexed.ReimbursementEligibility);
  assert.equal(repaired.ClassificationSource, oldIndexed.ClassificationSource);
  assert.equal(repaired.CorrectedAt, oldIndexed.CorrectedAt);
});

test('matched partial insurer evidence is derived from assignments and never remains unmatched', () => {
  const source = { ...mail, id: 'qubecore-partial-match', subject: 'Your Receipt - QubeCore Sports & Rehab',
    sender: 'QubeCore Sports & Rehab <notifications@janeapp.com>', receivedAt: '2026-09-17T21:32:00Z',
    text: 'Invoice #138636-P01. Service date: 2026-09-17. SEPTEMBER 17, 2026 - 1:15PM, RMT - FOLLOW UP MASSAGE (60 MINUTES) $142.86 $7.14 $150.00\nDESJARDINS INSURANCE (TELUS eClaims) Massage therapy Amount not covered: $38.00 -$112.00\nTOTAL $38.00',
    attachmentText: '' };
  const expense = toInvoice(source, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', member: 'Kevin',
    documentRole: 'expense', amount: 150, billedAmount: 150, serviceDate: '2026-09-17', reason: 'receipt' }, 'codex');
  assert.equal(expense.Healthcare?.InsurerPayments?.desjardins, 112);

  // This mirrors the troublesome non-structured insurer row: its generic BilledAmount is the
  // partial paid amount, not an explicit submitted/gross amount.
  const statement = { ...expense, Id: 'desjardins-partial-112', AccountLabel: 'Desjardins email',
    Provider: 'Desjardins · Massothérapeute - visite subséquente', Subject: 'Desjardins claim · Massage therapy',
    DocumentType: 'claim', DocumentRole: 'insurer-statement', Insurer: 'desjardins',
    BilledAmount: 112, DetectedAmount: 112, ReimbursedAmount: 112, NeedsReview: false, Confidence: 99,
    Healthcare: { ServiceDate: '2026-09-17', ServiceType: 'Massage therapy', InsurerPayments: { desjardins: 112 } } };

  const first = buildReconciliationSnapshot([expense, statement]);
  assert.equal(first.unmatched.length, 0);
  assert.equal(first.cases.length, 1);
  assert.deepEqual(
    [first.cases[0].OriginalAmount, first.cases[0].PrimaryReimbursedAmount, first.cases[0].SecondaryReimbursedAmount, first.cases[0].PotentialRemaining],
    [150, 112, 0, 38]
  );
  assert.equal(first.cases[0].ReimbursedAmount, 112, 'embedded receipt payment and matching statement are the same payment, not additive');
  assert.ok(first.cases[0].DocumentIds.includes(statement.Id));

  const repeated = buildReconciliationSnapshot([expense, statement]);
  assert.deepEqual(repeated, first, 'rebuilding the snapshot is deterministic');

  const removed = buildReconciliationSnapshot([statement]);
  assert.deepEqual(removed.unmatched, [{ DocumentId: statement.Id, Reason: 'no-expense-match' }]);
  const restored = buildReconciliationSnapshot([expense, statement]);
  assert.equal(restored.unmatched.length, 0);
});

test('an 85%-confidence reviewed expense can reconcile only through exact deterministic insurer corroboration', () => {
  const source = { ...mail, id: 'qubecore-reviewed-expense', subject: 'Your Receipt - QubeCore Sports & Rehab',
    sender: 'QubeCore Sports & Rehab <notifications@janeapp.com>', receivedAt: '2026-09-17T21:32:00Z',
    text: 'Invoice #138636-P01. Service date: 2026-09-17. SEPTEMBER 17, 2026 - 1:15PM, RMT - FOLLOW UP MASSAGE (60 MINUTES) $142.86 $7.14 $150.00\nDESJARDINS INSURANCE (TELUS eClaims) Massage therapy Amount not covered: $38.00 -$112.00\nTOTAL $38.00',
    attachmentText: '' };
  const extracted = toInvoice(source, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', member: 'Kevin',
    documentRole: 'expense', amount: 150, billedAmount: 150, serviceDate: '2026-09-17', reason: 'attachment fallback' }, 'codex');
  const expense = { ...extracted, NeedsReview: true, Confidence: 85 };
  assert.equal(expense.Healthcare?.InsurerPayments?.desjardins, 112);

  const statement = { ...expense, Id: 'desjardins-reviewed-112', AccountLabel: 'Desjardins email',
    Provider: 'Desjardins · Massothérapeute - visite subséquente', Subject: 'Desjardins claim · Massage therapy',
    DocumentType: 'claim', DocumentRole: 'insurer-statement', Insurer: 'desjardins',
    BilledAmount: 112, DetectedAmount: 112, ReimbursedAmount: 112, NeedsReview: false, Confidence: 99,
    Healthcare: { ServiceDate: '2026-09-17', ServiceType: 'Massage therapy', InsurerPayments: { desjardins: 112 } } };

  const snapshot = buildReconciliationSnapshot([expense, statement]);
  assert.equal(snapshot.unmatched.length, 0);
  assert.deepEqual(
    [snapshot.cases[0].OriginalAmount, snapshot.cases[0].PrimaryReimbursedAmount, snapshot.cases[0].SecondaryReimbursedAmount, snapshot.cases[0].PotentialRemaining],
    [150, 112, 0, 38]
  );
  assert.equal(snapshot.cases[0].Status, 'waiting-secondary');
  assert.equal(snapshot.cases[0].Action, 'submit-secondary');
  assert.equal(expense.NeedsReview, true, 'source review metadata is preserved rather than rewritten');
  assert.equal(expense.Confidence, 85);

  const noExactReceiptPayment = { ...expense, Healthcare: { ...expense.Healthcare, InsurerPayments: {} } };
  const blocked = buildReconciliationSnapshot([noExactReceiptPayment, statement]);
  assert.deepEqual(blocked.unmatched, [{ DocumentId: statement.Id, Reason: 'no-expense-match' }]);
  assert.equal(blocked.cases[0].Status, 'needs-attention');

  const expenseWithService = { ...expense, Healthcare: { ...expense.Healthcare, ServiceType: 'Massage therapy' } };
  const conflictingService = { ...statement, Id: 'desjardins-reviewed-conflict',
    Provider: 'Desjardins · Physiotherapy', Healthcare: { ...statement.Healthcare, ServiceType: 'Physiotherapy' } };
  assert.deepEqual(buildReconciliationSnapshot([expenseWithService, conflictingService]).unmatched,
    [{ DocumentId: conflictingService.Id, Reason: 'no-expense-match' }]);

  const reviewedStatement = { ...statement, Id: 'desjardins-needs-review', NeedsReview: true };
  const reviewedSnapshot = buildReconciliationSnapshot([expense, reviewedStatement]);
  assert.equal(reviewedSnapshot.unmatched.length, 0, 'source review alone does not erase a singular supported match');
  assert.equal(reviewedSnapshot.cases[0].MatchAssignments[0].Verification, 'review-recommended');
});

test('singular lower-confidence matches stay matched and expose match confidence for confirmation', () => {
  const expense = toInvoice({ ...mail, id: 'review-match-expense', subject: 'Clinic receipt', sender: 'Sample Clinic',
    text: 'Physiotherapy total CAD 100.00' }, 'kevin@example.test', 'Kevin',
    { ...classification, category: 'health', member: 'Kevin', documentRole: 'expense', amount: 100, billedAmount: 100,
      serviceDate: '2026-09-10', reason: 'review source', healthcare: { ServiceType: 'Physiotherapy', OriginalBilledAmount: 100 } }, 'codex');
  expense.NeedsReview = true;
  expense.Confidence = 85;
  const statement = { ...expense, Id: 'review-match-statement', Subject: 'Desjardins physiotherapy claim',
    Provider: 'Desjardins · Physiotherapy', DocumentType: 'claim', DocumentRole: 'insurer-statement',
    Insurer: 'desjardins', BilledAmount: 50, DetectedAmount: 50, ReimbursedAmount: 50,
    NeedsReview: false, Confidence: 99, Healthcare: { ServiceDate: '2026-09-10', ServiceType: 'Physiotherapy' } };

  const snapshot = buildReconciliationSnapshot([expense, statement]);
  assert.equal(snapshot.unmatched.length, 0);
  assert.equal(snapshot.cases[0].MatchAssignments.length, 1);
  assert.equal(snapshot.cases[0].MatchAssignments[0].ReimbursementDocumentId, statement.Id);
  assert.equal(snapshot.cases[0].MatchAssignments[0].Verification, 'review-recommended');
  assert.ok(snapshot.cases[0].MatchAssignments[0].Confidence < 90);
  assert.equal(snapshot.cases[0].MatchConfidence, snapshot.cases[0].MatchAssignments[0].Confidence);
});

test('manual match confirmation is authoritative and rejection prevents the same pair from returning', () => {
  const expense = toInvoice({ ...mail, id: 'decision-expense', subject: 'Clinic receipt', sender: 'Sample Clinic',
    text: 'Physiotherapy total CAD 100.00' }, 'kevin@example.test', 'Kevin',
    { ...classification, category: 'health', member: 'Kevin', documentRole: 'expense', amount: 100, billedAmount: 100,
      serviceDate: '2026-09-11', reason: 'review source', healthcare: { ServiceType: 'Physiotherapy', OriginalBilledAmount: 100 } }, 'codex');
  expense.NeedsReview = true; expense.Confidence = 85;
  const statement = { ...expense, Id: 'decision-statement', Subject: 'Desjardins physiotherapy claim',
    Provider: 'Desjardins · Physiotherapy', DocumentType: 'claim', DocumentRole: 'insurer-statement',
    Insurer: 'desjardins', BilledAmount: 50, DetectedAmount: 50, ReimbursedAmount: 50,
    NeedsReview: false, Confidence: 99, Healthcare: { ServiceDate: '2026-09-11', ServiceType: 'Physiotherapy' } };
  const initial = buildReconciliationSnapshot([expense, statement]);
  const confidence = initial.cases[0].MatchAssignments[0].Confidence;

  const confirmed = buildReconciliationSnapshot([expense, { ...statement, Healthcare: { ServiceDate: '2026-09-11', ServiceType: 'Chiropractic' } }],
    [{ reimbursementId: statement.Id, expenseId: expense.Id, decision: 'confirmed', at: '2026-09-27T12:00:00Z', confidence }]);
  assert.equal(confirmed.unmatched.length, 0);
  assert.equal(confirmed.cases[0].MatchAssignments[0].Verification, 'confirmed-manually');
  assert.equal(confirmed.cases[0].MatchAssignments[0].Confidence, confidence);
  assert.equal(confirmed.cases[0].MatchAssignments[0].ConfirmedAt, '2026-09-27T12:00:00Z');

  const rejected = buildReconciliationSnapshot([expense, statement],
    [{ reimbursementId: statement.Id, expenseId: expense.Id, decision: 'rejected', at: '2026-09-27T12:05:00Z', confidence }]);
  assert.deepEqual(rejected.unmatched, [{ DocumentId: statement.Id, Reason: 'no-expense-match' }]);
  assert.equal(rejected.cases[0].MatchAssignments.length, 0);
});

test('a partial paid amount does not need to equal the expense total to match', () => {
  const expense = toInvoice({ ...mail, id: 'partial-expense', subject: 'Massage clinic receipt', text: 'Massage therapy. Total paid CAD 150.00' },
    'kevin@example.test', 'Kevin', { ...classification, category: 'health', member: 'Kevin', documentRole: 'expense',
      amount: 150, billedAmount: 150, serviceDate: '2026-09-17', reason: 'receipt',
      healthcare: { ServiceType: 'Massage therapy', OriginalBilledAmount: 150 } }, 'codex');
  const statement = { ...expense, Id: 'partial-statement', Provider: 'Desjardins · Massage therapy', Subject: 'Desjardins claim',
    DocumentType: 'claim', DocumentRole: 'insurer-statement', Insurer: 'desjardins', BilledAmount: 112,
    DetectedAmount: 112, ReimbursedAmount: 112, NeedsReview: false, Confidence: 99,
    Healthcare: { ServiceDate: '2026-09-17', ServiceType: 'Massage therapy' } };
  const snapshot = buildReconciliationSnapshot([expense, statement]);
  assert.equal(snapshot.unmatched.length, 0);
  assert.equal(snapshot.cases[0].PrimaryReimbursedAmount, 112);
  assert.equal(snapshot.cases[0].PotentialRemaining, 38);
});

test('QubeCore residual-only receipt keeps gross expense and Desjardins payment unknown until reconciliation', () => {
  const source = { ...mail, id: 'qubecore-residual-only', subject: 'Your Receipt - QubeCore Sports & Rehab',
    sender: 'QubeCore Sports & Rehab <notifications@janeapp.com>', receivedAt: '2026-08-20T21:15:00Z',
    text: 'Kevin, thanks for your payment of $38.00. Invoice #136916-P01. Service date: 2026-08-20. August 20, 2026 - 1:15pm, RMT - Follow Up Massage (60 Min) $36.19. DESJARDINS INSURANCE (TELUS eClaims) Massage therapy Amount not covered: $38.00. Subtotal $36.19 GST $1.81 Payer Total $38.00',
    attachmentText: '' };
  const receipt = toInvoice(source, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', member: 'Kevin',
    documentRole: 'expense', amount: 38, billedAmount: 36.19, serviceDate: '2026-08-20', reason: 'receipt' }, 'codex');

  assert.equal(receipt.BilledAmount, null);
  assert.equal(receipt.DetectedAmount, null);
  assert.equal(receipt.Healthcare?.PatientBalance, 38);
  assert.equal(receipt.Healthcare?.InsurerPayments?.desjardins, undefined);
  assert.ok(receipt.Healthcare?.ProcessedInsurers?.includes('desjardins'));

  const receiptOnly = buildReconciliationSnapshot([receipt]).cases[0];
  assert.equal(receiptOnly.OriginalAmount, null);
  assert.equal(receiptOnly.PrimaryReimbursedAmount, null);
  assert.equal(receiptOnly.SecondaryReimbursedAmount, 0);
  assert.equal(receiptOnly.PotentialRemaining, 38);
  assert.equal(receiptOnly.Status, 'waiting-secondary');

  const stale = { ...receipt, BilledAmount: 36.19, DetectedAmount: 36.19,
    Healthcare: { ...receipt.Healthcare, OriginalBilledAmount: 36.19, InsurerPayments: {}, ProcessedInsurers: ['desjardins'] } };
  const repaired = repairHealthcareAmounts(stale, source);
  assert.equal(repaired.BilledAmount, null);
  assert.equal(repaired.DetectedAmount, null);
  assert.equal(repaired.Healthcare?.PatientBalance, 38);
  assert.equal(repaired.Healthcare?.OriginalBilledAmount, null);
});

test('QubeCore direct-insurance receipt becomes one canonical residual case', () => {
  const receipt = toInvoice({ ...mail, id: 'qubecore-receipt', subject: 'Your Receipt - QubeCore Sports & Rehab', sender: 'QubeCore Sports & Rehab', text: 'Invoice #136916-P01. Service date: 2026-08-20. Amount not covered: $38.00. DESJARDINS INSURANCE (TELUS eClaims). Visa Kevin Vanderstraeten payment of $38.00', attachmentText: 'Amount not covered: $38.00\nDESJARDINS INSURANCE (TELUS eClaims)\nInvoice #136916-P01' }, 'kevin@example.test', 'Kevin', { ...classification, category: 'health', member: 'Kevin', documentRole: 'expense', amount: 38, billedAmount: 38, serviceDate: '2026-08-20', reason: 'receipt' }, 'codex');
  const desjardins = { ...receipt, Id: 'desjardins-qubecore', AccountLabel: 'Local Desjardins import', Provider: 'Desjardins · Massage Therapy', Subject: 'Desjardins claim · Massage Therapy', DocumentType: 'claim', DocumentRole: 'insurer-statement', Insurer: 'desjardins', BilledAmount: 150, ReimbursedAmount: 112, DetectedAmount: 112, Healthcare: { ServiceDate: '2026-08-20', OriginalBilledAmount: 150, SubmittedAmount: 150, InsurerPayments: { desjardins: 112 }, FieldSources: { OriginalBilledAmount: 'structured', SubmittedAmount: 'structured' }, FieldStates: { OriginalBilledAmount: 'confirmed' } }, Notes: 'Submitted 150.00; paid 112.00;' };
  const beforeStatement = buildReconciliationSnapshot([receipt]).cases[0];
  assert.equal(beforeStatement.OriginalAmount, null);
  assert.equal(beforeStatement.PrimaryReimbursedAmount, null);
  assert.equal(beforeStatement.PotentialRemaining, 38);

  const result = buildReconciliationSnapshot([receipt, desjardins]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].Provider, 'QubeCore Sports & Rehab');
  assert.equal(result.cases[0].OriginalAmount, 150);
  assert.equal(result.cases[0].PrimaryReimbursedAmount, 112);
  assert.equal(result.cases[0].PotentialRemaining, 38);
  assert.equal(result.cases[0].Status, 'waiting-secondary');
  assert.equal(result.cases[0].Evidence.PatientBalance.value, 38);
});
test('MIME normalization keeps source attachment identity, reads plain text, and does not treat attachment bytes as text', () => {
  const normalized = normalizeMail({ id: 'x', threadId: 't', internalDate: '1790000000000', payload: { headers: [{ name: 'Subject', value: 'Receipt' }], parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from('Paid CAD 15').toString('base64url') } },
    { mimeType: 'application/pdf', filename: 'receipt.pdf', body: { attachmentId: 'att-1', size: 100 } }
  ] } });
  assert.equal(normalized.text, 'Paid CAD 15'); assert.equal(normalized.attachments[0].Id, 'att-1');
});

test('the PC collector reads supported text attachment content transiently and records extraction metadata', async () => {
  const normalized = normalizeMail({ id: 'text-attachment', threadId: 't', payload: { headers: [{ name: 'Subject', value: 'Statement' }], parts: [
    { mimeType: 'text/csv', filename: 'statement.csv', body: { attachmentId: 'att-text', size: 42 } }
  ] } });
  const enriched = await withAttachmentText(normalized, 'synthetic', async (_token, path) => {
    assert.equal(path, 'messages/text-attachment/attachments/att-text');
    return { data: Buffer.from('provider,total\nClinic,142.00').toString('base64url') };
  });
  assert.match(enriched.attachmentText, /Clinic,142\.00/);
  assert.equal(enriched.attachments[0].AnalysisStatus, 'text-extracted');
  assert.ok(enriched.attachments[0].ExtractedCharacters > 0);
});

test('mail attention remains separate from reimbursement eligibility', () => {
  const item = toInvoice(mail, 'a@example.test', 'Test', {
    ...classification, kind: 'administrative', transaction: false, reimbursement: 'no', amount: null,
    attention: 'critical', attentionReason: 'Confirm this security activity.'
  }, 'codex');
  assert.equal(item.AttentionLevel, 'critical');
  assert.equal(item.ReimbursementEligibility, 'unknown');
  assert.match(item.AttentionReason, /security/);
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

test('a past clinic receipt is recovered after the Gmail watermark and appears once', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-receipt-repair-'));
  try {
    const result = spawnSync(process.execPath, ['tests/fixtures/receipt-repair-runner.mjs'], { cwd: process.cwd(), env: { ...process.env, FAMILYHUB_WORKER_DATA: dir }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('June history resumes failures and retains reversible expense ignore decisions', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-history-ignore-'));
  try {
    const result = spawnSync(process.execPath, ['tests/fixtures/history-ignore-runner.mjs'], { cwd: process.cwd(), env: { ...process.env, FAMILYHUB_WORKER_DATA: dir }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('startup removes legacy Desjardins status notifications from Claims without downgrading a genuine EOB', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-desjardins-status-'));
  try {
    const result = spawnSync(process.execPath, ['tests/fixtures/desjardins-status-normalization-runner.mjs'], {
      cwd: process.cwd(), env: { ...process.env, FAMILYHUB_WORKER_DATA: dir }, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('historical intake retains medical receipts with unknown coverage and no invented amounts', async () => {
  const { classifyHistorical } = await import('../apps/worker/dist/invoices.js');
  const result = await classifyHistorical({ ...mail, subject: 'Your Receipt - Example Clinic', sender: 'Example Clinic',
    text: 'Kinesiology visit. Invoice #SYNTHETIC-2.', attachmentText: '' }, 'test@example.test');
  assert.equal(result.source, 'rules');
  assert.equal(result.result.category, 'health');
  assert.equal(result.result.documentRole, 'expense');
  assert.equal(result.result.reimbursement, 'unknown');
  assert.equal(result.result.billedAmount, null);
  assert.equal(toInvoice(mail, 'test@example.test', 'Test', result.result, result.source).NeedsReview, true);
});

test('Desjardins claim-status notifications stay out of reimbursements while real EOB evidence remains a statement', async () => {
  const { classify, classifyHistorical } = await import('../apps/worker/dist/invoices.js');
  const base = {
    ...mail,
    sender: 'Desjardins Insurance <eob@dsf.ca>',
    attachmentText: '',
    attachments: [],
    labels: []
  };
  for (const source of [
    {
      subject: 'Your claim has been received',
      text: 'Thank you for sending your claim online. Once processed, your explanation of benefits will be posted in Claims history.'
    },
    {
      subject: 'Your claim has been processed',
      text: 'The explanation of benefits for your claim has now been posted on the Claims history section of your secure site.'
    },
    {
      subject: 'Your health or dental care predetermination has been processed',
      text: 'The explanation of benefits for your health or dental care predetermination is now available in the “Claims history” section of your secure site at www.desjardinslifeinsurance.com/planmember.',
      attachments: [{ Id: 'logo', FileName: 'LogoAn.png', MimeType: 'image/png', Size: 100 }]
    }
  ]) {
    const classified = await classifyHistorical({ ...base, ...source }, 'test@example.test');
    assert.equal(classified.result.kind, 'administrative');
    assert.equal(classified.result.transaction, false);
    assert.equal(classified.result.category, 'other');
    assert.equal(classified.result.documentRole, 'other');
    assert.equal(classified.result.insurer, null);
    const item = toInvoice({ ...base, ...source }, 'test@example.test', 'Kevin', classified.result, classified.source);
    const snapshot = buildReconciliationSnapshot([item]);
    assert.equal(snapshot.cases.length, 0);
    assert.equal(snapshot.unmatched.length, 0);
  }

  const actual = await classifyHistorical({
    ...base,
    subject: 'Your claim has been processed',
    text: 'Explanation of benefits. Amount paid: CAD $75.00.'
  }, 'test@example.test');
  assert.equal(actual.result.kind, 'claim');
  assert.equal(actual.result.category, 'health');
  assert.equal(actual.result.documentRole, 'insurer-statement');
  assert.equal(actual.result.insurer, 'desjardins');

  const attached = await classifyHistorical({
    ...base,
    subject: 'Your claim has been processed',
    text: 'Your claim was processed. See the attached document.',
    attachments: [{ Id: 'attachment-eob', FileName: 'EOB-2025-06-04.pdf', MimeType: 'application/pdf', Size: 100 }]
  }, 'test@example.test');
  assert.equal(attached.result.documentRole, 'insurer-statement');
  assert.equal(attached.result.insurer, 'desjardins');

  const predeterminationEob = await classifyHistorical({
    ...base,
    subject: 'Your health or dental care predetermination has been processed',
    text: 'Explanation of benefits. Amount paid: CAD $75.00.'
  }, 'test@example.test');
  assert.equal(predeterminationEob.result.documentRole, 'insurer-statement');
  assert.equal(predeterminationEob.result.insurer, 'desjardins');

  const currentPredetermination = await classify({
    ...base,
    subject: 'Your health or dental care predetermination has been processed',
    text: 'The explanation of benefits for your predetermination is now available in Claims history.',
    attachments: [{ Id: 'logo', FileName: 'LogoAn.png', MimeType: 'image/png', Size: 100 }]
  }, 'test@example.test');
  assert.equal(currentPredetermination.result.kind, 'administrative');
  assert.equal(currentPredetermination.result.documentRole, 'other');
});

test('Gmail retries only transient rate errors without exposing response contents', async () => {
  const { gmail } = await import('../apps/worker/dist/gmail-client.js');
  let calls = 0; const pauses = [];
  const result = await gmail('synthetic', 'messages', { pause: async ms => { pauses.push(ms); }, fetch: async () => {
    calls++;
    return calls === 1 ? new Response(JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded', message: 'synthetic-private-value' }] } }), { status: 403 })
      : new Response(JSON.stringify({ messages: [] }), { status: 200 });
  } });
  assert.deepEqual(result, { messages: [] }); assert.equal(calls, 2); assert.ok(pauses.some(ms => ms >= 2000));
  calls = 0;
  await assert.rejects(() => gmail('synthetic', 'messages', { pause: async () => {}, fetch: async () => {
    calls++; return new Response(JSON.stringify({ error: { errors: [{ reason: 'domainPolicy', message: 'synthetic-private-value' }] } }), { status: 403 });
  } }), error => error.message.includes('domainPolicy') && !error.message.includes('synthetic-private-value'));
  assert.equal(calls, 1);
});

test('scheduled private Codex resolves the installed native CLI without a PATH override', async () => {
  const { privateCodexBinary } = await import('../apps/worker/dist/private-codex.js');
  const { existsSync } = await import('node:fs');
  const { isAbsolute } = await import('node:path');
  const old = process.env.FAMILYHUB_CODEX_PATH;
  delete process.env.FAMILYHUB_CODEX_PATH;
  try { const binary = privateCodexBinary(); assert.ok(isAbsolute(binary)); assert.ok(existsSync(binary)); }
  finally { if (old !== undefined) process.env.FAMILYHUB_CODEX_PATH = old; }
});
