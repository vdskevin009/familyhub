import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconciliationSnapshot } from '../apps/worker/dist/reconciliation.js';

const expense = (patch = {}) => ({
  Id: 'synthetic-expense',
  AccountLabel: 'Synthetic',
  AccountEmail: 'synthetic@example.test',
  SourceMessageId: 'synthetic-expense-message',
  ThreadId: 'synthetic-thread',
  InternetMessageId: '<synthetic-expense@example.test>',
  Subject: 'Synthetic healthcare expense',
  Sender: 'synthetic@example.test',
  Provider: 'Physiotherapy',
  ReceivedAt: '2026-01-10T12:00:00Z',
  Category: 0,
  Status: 0,
  DetectedAmount: 170,
  Currency: 'CAD',
  Confidence: 99,
  Notes: '',
  Attachments: [],
  DocumentType: 'receipt',
  WorkerManaged: true,
  NeedsReview: false,
  ReimbursementEligibility: 'unknown',
  ClassificationSource: 'rules',
  Member: 'Synthetic',
  DocumentRole: 'expense',
  Insurer: null,
  ServiceDate: '2026-01-10',
  BilledAmount: 170,
  ReimbursedAmount: null,
  Healthcare: { OriginalBilledAmount: 170, ServiceDate: '2026-01-10', ServiceType: 'Physiotherapy' },
  ...patch
});

const statement = (id, insurer, provider, paid, patch = {}) => ({
  ...expense(),
  Id: id,
  SourceMessageId: `${id}-message`,
  Subject: `Synthetic ${insurer} statement`,
  Provider: provider,
  DocumentType: 'claim',
  DocumentRole: 'insurer-statement',
  Insurer: insurer,
  BilledAmount: 170,
  DetectedAmount: paid,
  ReimbursedAmount: paid,
  AccountLabel: insurer === 'desjardins' ? 'Local Desjardins import' : 'Synthetic',
  StructuredSource: insurer === 'blue-cross' ? 'blue-cross-portal' : undefined,
  Healthcare: { SubmittedAmount: 170, ServiceDate: '2026-01-10', ServiceType: provider },
  ...patch
});

test('exact cross-insurer completion can resolve conflicting service labels without creating a global alias', () => {
  const root = expense();
  const first = statement('synthetic-desj', 'desjardins', 'Physiotherapy', 34);
  const second = statement('synthetic-blue-cross', 'blue-cross', 'Massage Therapy', 136);

  const result = buildReconciliationSnapshot([root, first, second]);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].ReimbursedAmount, 170);
  assert.equal(result.cases[0].DesjardinsReimbursedAmount, 34);
  assert.equal(result.cases[0].BlueCrossReimbursedAmount, 136);
  assert.equal(result.cases[0].PotentialRemaining, 0);
  assert.equal(result.cases[0].MatchAssignments.length, 2);
  assert.ok(result.cases[0].MatchAssignments.some(match =>
    match.ReimbursementDocumentId === second.Id
    && match.Confidence === 95
    && match.Evidence.some(evidence => /Exact coordinated payments complete expense/.test(evidence))));
});

test('coordinated completion stays conservative on near amounts, missing first insurer, and duplicate expenses', () => {
  const root = expense();
  const first = statement('synthetic-desj', 'desjardins', 'Physiotherapy', 34);
  const second = statement('synthetic-blue-cross', 'blue-cross', 'Massage Therapy', 136);

  const near = { ...second, Id: 'synthetic-blue-cross-near', ReimbursedAmount: 135, DetectedAmount: 135 };
  assert.equal(buildReconciliationSnapshot([root, first, near]).unmatched.some(item => item.DocumentId === near.Id), true);

  assert.equal(buildReconciliationSnapshot([root, second]).unmatched.some(item => item.DocumentId === second.Id), true);

  const duplicate = expense({ Id: 'synthetic-expense-duplicate' });
  const ambiguous = buildReconciliationSnapshot([root, duplicate, first, second]);
  assert.equal(ambiguous.unmatched.some(item => item.DocumentId === second.Id), true);
});
