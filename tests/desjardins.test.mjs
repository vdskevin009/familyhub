import assert from 'node:assert/strict';
import test from 'node:test';
import { desjardinsIdentity, desjardinsInvoices, planDesjardinsUpsert } from '../apps/worker/dist/desjardins.js';
import { parseDesjardinsDetail, parseDesjardinsPages } from '../apps/worker/dist/desjardins-collector.js';

const row = (patch = {}) => ({ member: 'Kevin', serviceDate: '2026-09-10', service: 'Physiotherapy',
  submitted: 100, paid: 80, statementDate: '2026-09-12', identity: desjardinsIdentity('claim-1', null, 1),
  sourceClaimId: 'claim-1', needsReview: false, ...patch });
const collection = (rows = [row()], patch = {}) => ({ collectedAt: '2026-09-29T12:00:00.000Z',
  collectorVersion: 1, pageCount: 1, rows, warnings: [], complete: true, ...patch });

test('Desjardins portal facts become insurer evidence without inventing a provider or payment', () => {
  const [paid, pending] = desjardinsInvoices(collection([row(), row({ identity: 'pending', paid: null })]));
  assert.equal(paid.Insurer, 'desjardins');
  assert.equal(paid.StructuredSource, 'desjardins-portal');
  assert.equal(paid.BilledAmount, 100);
  assert.equal(paid.ReimbursedAmount, 80);
  assert.equal(pending.ReimbursedAmount, null);
  assert.equal(pending.PortalClaimStatus, 'pended');
  assert.equal(pending.NeedsReview, true);
});

test('a known historical Excel statement is counted once and never overwritten', () => {
  const legacy = { ...desjardinsInvoices(collection())[0], Id: 'excel-claim', Fingerprint: 'excel-fingerprint',
    StructuredSource: undefined, AccountLabel: 'Local Desjardins import', BilledAmount: null,
    ClaimedService: undefined, Notes: 'Submitted 100.00; legacy evidence', CorrectedAt: '2026-01-01T00:00:00Z' };
  const plan = planDesjardinsUpsert([legacy], collection());
  assert.deepEqual([plan.found, plan.new, plan.unchanged, plan.changed, plan.ambiguous], [1, 0, 1, 0, 0]);
  assert.deepEqual(plan.items, []);
  assert.equal(legacy.Id, 'excel-claim');
});

test('new portal rows are additive and an identical second run is idempotent', () => {
  const first = planDesjardinsUpsert([], collection());
  assert.deepEqual([first.new, first.unchanged, first.ambiguous], [1, 0, 0]);
  const second = planDesjardinsUpsert(first.items, collection());
  assert.deepEqual([second.new, second.changed, second.unchanged, second.ambiguous], [0, 0, 1, 0]);
  assert.deepEqual(second.items, []);
});

test('stable portal ID permits a deterministic change while retaining a manual status', () => {
  const current = { ...desjardinsInvoices(collection())[0], Status: 3, LastDecisionId: 'manual-choice' };
  const changed = planDesjardinsUpsert([current], collection([row({ paid: 75 })]));
  assert.deepEqual([changed.new, changed.changed, changed.ambiguous], [0, 1, 0]);
  assert.equal(changed.items[0].Status, 3);
  assert.equal(changed.items[0].LastDecisionId, 'manual-choice');
});

test('conflicting service, repeated ID, unknown member and unknown payment stay out of apply', () => {
  const old = desjardinsInvoices(collection())[0];
  assert.equal(planDesjardinsUpsert([old], collection([row({ identity: 'other', service: 'Massage' })])).ambiguous, 1);
  const repeated = planDesjardinsUpsert([], collection([row(), row()]));
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.ambiguous, 1);
  assert.equal(planDesjardinsUpsert([], collection([row({ member: 'unknown' })])).ambiguous, 1);
  assert.equal(planDesjardinsUpsert([], collection([row({ paid: null })])).ambiguous, 1);
});

const history = { date: '2024‑02‑03', method: 'Payment to provider', paid: '60,00 $', category: 'Health', hasDetail: true };
const detail = [
  { cells: ['Kevin, Numéro de réclamation: 123456789'], colspans: [9] },
  { cells: ['PHYSIOTHÉRAPIE - VISITE', '2024‑02‑03', '2024‑02‑03', '75,00', '75,00', '80%', '15,00', '60,00', 'TEST1'], colspans: Array(9).fill(1) },
  { cells: ['Your claim was processed.'], colspans: [9] },
  { cells: ['TOTAL REIMBURSEMENT', '60,00 $', ''], colspans: [7, 1, 1] }
];
test('French processed-claim detail parses a service line without treating the patient or total as a new claim', () => {
  const result = parseDesjardinsDetail(history, detail);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].member, 'Kevin');
  assert.equal(result.rows[0].serviceDate, '2024-02-03');
  assert.equal(result.rows[0].submitted, 75);
  assert.equal(result.rows[0].paid, 60);
  assert.equal(result.rows[0].statementDate, '2024-02-03');
  assert.notEqual(desjardinsIdentity('123456789', null, 1), desjardinsIdentity('123456789', null, 2));
});

test('detail/list mismatch, missing lines and repeated pages block a complete preview', () => {
  assert.match(parseDesjardinsDetail({ ...history, paid: '59,00 $' }, detail).warnings.join(' '), /does not match/);
  const page = { histories: [history], details: [detail], hasNext: false };
  assert.equal(parseDesjardinsPages([page]).complete, true);
  assert.equal(parseDesjardinsPages([page, page]).complete, false);
  assert.equal(parseDesjardinsPages([{ ...page, details: [] }]).complete, false);
});
