import assert from 'node:assert/strict';
import test from 'node:test';
import { desjardinsIdentity, desjardinsInvoices, planDesjardinsUpsert } from '../apps/worker/dist/desjardins.js';
import { confirmDesjardinsRepeat, desjardinsAliasFingerprint, desjardinsAuthCookies, desjardinsNameCandidates, parseDesjardinsDetail, parseDesjardinsPages } from '../apps/worker/dist/desjardins-collector.js';

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

test('a unique long legacy label abbreviation can be counted without changing its source', () => {
  const service = 'Physiotherapy long visit';
  const old = { ...desjardinsInvoices(collection([row({ service })]))[0], Id: 'legacy-row',
    StructuredSource: undefined, BilledAmount: null, Notes: 'Submitted 100.00; historical report' };
  const incoming = row({ service: `${service} follow-up` });
  const plan = planDesjardinsUpsert([old], collection([incoming]));
  assert.deepEqual([plan.new, plan.unchanged, plan.ambiguous], [0, 1, 0]);
  assert.deepEqual(plan.items, []);
  assert.equal(old.Id, 'legacy-row');
  assert.equal(planDesjardinsUpsert([{ ...old, CorrectedAt: '2026-01-01' }], collection([incoming])).ambiguous, 1);
  assert.equal(planDesjardinsUpsert([old], collection([incoming, row({ identity: 'second', service: `${service} another` })])).ambiguous, 2);
  const generic = { ...old, ClaimedService: 'Massage' };
  assert.equal(planDesjardinsUpsert([generic], collection([row({ service: 'Massage follow-up' })])).ambiguous, 1);
});

test('new portal rows are additive and an identical second run is idempotent', () => {
  const first = planDesjardinsUpsert([], collection());
  assert.deepEqual([first.new, first.unchanged, first.ambiguous], [1, 0, 0]);
  const second = planDesjardinsUpsert(first.items, collection());
  assert.deepEqual([second.new, second.changed, second.unchanged, second.ambiguous], [0, 0, 1, 0]);
  assert.deepEqual(second.items, []);
});

test('stable portal ID refuses changed facts on a record with a manual status', () => {
  const current = { ...desjardinsInvoices(collection())[0], Status: 3, LastDecisionId: 'manual-choice' };
  const changed = planDesjardinsUpsert([current], collection([row({ paid: 75 })]));
  assert.deepEqual([changed.new, changed.changed, changed.ambiguous], [0, 0, 1]);
  assert.deepEqual(changed.items, []);
  assert.equal(current.Status, 3);
  assert.equal(current.ReimbursedAmount, 80);
  assert.equal(current.LastDecisionId, 'manual-choice');
});

test('conflicting service, repeated ID, unknown member and unknown payment stay out of apply', () => {
  const old = desjardinsInvoices(collection())[0];
  assert.equal(planDesjardinsUpsert([old], collection([row({ identity: 'other', service: 'Massage' })])).ambiguous, 1);
  const repeated = planDesjardinsUpsert([], collection([row(), row()]));
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.ambiguous, 2);
  assert.equal(planDesjardinsUpsert([], collection([row(), row({ identity: 'distinct-claim', sourceClaimId: 'claim-2' })])).ambiguous, 2);
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

test('candidate generation keeps plausible three-word orders without inventing a surname', () => {
  const candidates = desjardinsNameCandidates('SMITH JANE MIDDLE', word => word === 'SMITH');
  assert.ok(candidates.includes('JANE SMITH'));
  assert.ok(candidates.includes('JANE MIDDLE'));
  assert.ok(candidates.includes('SMITH MIDDLE'));
  assert.ok(!desjardinsNameCandidates('OTHER JANE MIDDLE', word => word === 'SMITH').includes('JANE'));
});

test('only a privately confirmed exact beneficiary alias can resolve an unfamiliar portal name', () => {
  const unfamiliar = detail.map(entry => ({ ...entry, cells: [...entry.cells] }));
  unfamiliar[0].cells[0] = 'PSEUDONYM EXTRA JAS, Numéro de réclamation: 123456789';
  assert.match(parseDesjardinsDetail(history, unfamiliar).warnings.join(' '), /not recognized/);
  const aliases = { [desjardinsAliasFingerprint('PSEUDONYM EXTRA JAS')]: 'Jasmine' };
  const confirmed = parseDesjardinsDetail(history, unfamiliar, aliases);
  assert.deepEqual(confirmed.warnings, []);
  assert.equal(confirmed.rows[0].member, 'Jasmine');
  assert.match(parseDesjardinsDetail(history, detail,
    { [desjardinsAliasFingerprint('Kevin')]: 'Jasmine' }).warnings.join(' '), /not recognized/);
});

test('detail/list mismatch, missing lines and repeated pages block a complete preview', () => {
  assert.match(parseDesjardinsDetail({ ...history, paid: '59,00 $' }, detail).warnings.join(' '), /does not match/);
  const page = { histories: [history], details: [detail], hasNext: false };
  assert.equal(parseDesjardinsPages([page]).complete, true);
  assert.equal(parseDesjardinsPages([page, page]).complete, false);
  assert.equal(parseDesjardinsPages([{ ...page, details: [] }]).complete, false);
});

test('two autonomous passes in one login must agree before apply', () => {
  const page = { histories: [history], details: [detail], hasNext: false };
  const first = parseDesjardinsPages([page]);
  const second = parseDesjardinsPages([page]);
  assert.equal(confirmDesjardinsRepeat(first, second).complete, true);
  assert.equal(confirmDesjardinsRepeat(first, { ...second, rows: [] }).complete, false);
  assert.equal(confirmDesjardinsRepeat({ ...first, warnings: ['Missing row'], complete: false }, second).complete, false);
});

test('private auth storage excludes cookies for unrelated sites', () => {
  const cookies = [{ domain: '.agea-gbim.dsf-dfs.com' }, { domain: 'www.agea-gbim.dsf-dfs.com' },
    { domain: 'id.desjardins.com' }, { domain: '.dsf-dfs.com' }, { domain: 'unrelated.example' }];
  assert.deepEqual(desjardinsAuthCookies(cookies), cookies.slice(0, 4));
});

test('health and dental grid variants keep the claimed and reimbursed columns aligned', () => {
  const group = span => ({ cells: ['Kevin, Numéro de réclamation: 987654321'], colspans: [span] });
  const seven = [group(7), { cells: ['Service Z', '2024‑02‑03', '2024‑02‑03', '30,00', '80%', '6,00', '24,00'], colspans: Array(7).fill(1) }];
  const eight = [group(8), { cells: ['Service A', '2024‑02‑03', '2024‑02‑03', '25,00', '25,00', '80%', '5,00', '20,00'], colspans: Array(8).fill(1) }];
  const ten = [group(10), { cells: ['Service B', '2024‑02‑03', '2024‑02‑03', '50,00', '50,00', '80%', '10,00', '40,00', '5,00', 'CODE'], colspans: Array(10).fill(1) }];
  const eleven = [group(11), { cells: ['Service C', '12345', '2024‑02‑03', '2024‑02‑03', '75,00', '75,00', '80%', '15,00', '60,00', '5,00', 'CODE'], colspans: Array(11).fill(1) }];
  for (const [rows, paid, submitted, service] of [[seven, 24, 30, 'Service Z'], [eight, 20, 25, 'Service A'], [ten, 40, 50, 'Service B'], [eleven, 60, 75, 'Service C']]) {
    const parsed = parseDesjardinsDetail({ ...history, paid: `${paid},00 $` }, rows);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.rows[0].paid, paid);
    assert.equal(parsed.rows[0].submitted, submitted);
    assert.equal(parsed.rows[0].service, service);
  }
  const unclear = [group(11), { cells: ['Service A', 'Service B', '2024‑02‑03', '2024‑02‑03', '75,00', '75,00', '80%', '15,00', '60,00', '5,00', 'CODE'], colspans: Array(11).fill(1) }];
  assert.match(parseDesjardinsDetail({ ...history, paid: '60,00 $' }, unclear).warnings.join(' '), /incomplete or inconsistent/);
});

// Public synthetic counterparts exercise locale drift without live claim data.
test('English labelled claim and decimal amounts preserve the same service identity', () => {
  const english = detail.map(entry => ({ ...entry, cells: entry.cells.map(cell =>
    cell.replace('Numéro de réclamation', 'Claim number').replace(/(\d+),(\d{2})/g, '$1.$2')) }));
  const result = parseDesjardinsDetail({ ...history, paid: '60.00 $' }, english);
  assert.deepEqual(result, parseDesjardinsDetail(history, detail));
  for (const malformed of ['60.0', '6,0.00', '60,0', '60.00.00', '60,00,00'])
    assert.ok(parseDesjardinsDetail({ ...history, paid: malformed }, english).warnings.length);
  const mismatch = parseDesjardinsDetail({ ...history, paid: '61.00 $' }, english);
  assert.ok(mismatch.warnings.some(warning => warning.includes('does not match')));
});
