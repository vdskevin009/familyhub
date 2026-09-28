import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlueCrossExport, blueCrossInvoices } from '../apps/worker/dist/bluecross.js';
import { normalizeMail } from '../apps/worker/dist/gmail-client.js';
import { buildReconciliationSnapshot, recoverMissingDesjardinsExpenses, serviceKey } from '../apps/worker/dist/reconciliation.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const row = (name = 'Jasmine Wing', service = 'Physiotherapy Treatment - 30 Minutes', claimed = 100, paid = 80, statement = 'Sep 03, 2026') => ({ name, service, claimed, paid, statement });
const table = (rows, totalPaid = null) => {
  const claimed = rows.reduce((sum, row) => sum + row.claimed, 0).toFixed(2);
  const paid = rows.reduce((sum, row) => sum + row.paid, 0).toFixed(2);
  return `<table id="grdClaimsGrid"><thead><tr><th>Amount Claimed</th><th>Amount Paid</th></tr></thead><tbody>${rows.map((row, index) => `<tr rowId="${index}"><td>Sep 03, 2026</td><td>${row.name}</td><td>${row.service}</td><td>$${row.claimed.toFixed(2)}</td><td>$${row.paid.toFixed(2)}</td><td>${row.statement}</td><td>Details</td></tr>`).join('')}</tbody><tfoot><tr><td></td><td></td><td><div>Page 1 Total</div><div>Grand Total</div></td><td><div>$${claimed}</div><div>$${claimed}</div></td><td><div>$${paid}</div><div>$${(totalPaid ?? Number(paid)).toFixed(2)}</div></td></tr></tfoot></table>`;
};
const mail = (html, id = 'aabbccdd') => normalizeMail({ id, threadId: 'thread', payload: { headers: [{ name: 'subject', value: 'Blue Cross refund part 1' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(html).toString('base64url') } }] } });
const documents = html => blueCrossInvoices(mail(html), 'test@example.test', 'Test');
const expense = (patch = {}) => ({ ...documents(table([row()]))[1], Id: 'expense', Provider: 'Physiothérapeute', Member: 'Jasmine', DocumentRole: 'expense', DocumentType: 'receipt', StructuredSource: undefined, ClaimedService: undefined, Insurer: null, BilledAmount: 100, DetectedAmount: 100, ReimbursedAmount: null, ...patch });

test('long copied HTML is parsed before the classifier limit; hidden/script data is not persisted', () => {
  const html = 'x'.repeat(16000) + '<script>throw new Error("never run")</script><input value="sensitive-hidden-field">' + table([row()]);
  const normalized = mail(html);
  assert.equal(normalized.text.length, 12000);
  assert.equal(normalized.blueCrossExport.rows.length, 1);
  assert.equal(JSON.stringify(documents(html)).includes('sensitive-hidden-field'), false);
});
test('identical emailed parts have stable row identities and totals never become payments', () => {
  const html = table([row()], 250);
  const first = documents(html); const second = blueCrossInvoices(mail(html, 'eeff0011'), 'test@example.test', 'Test');
  assert.equal(first[1].Id, second[1].Id);
  assert.notEqual(first[0].Id, second[0].Id);
  assert.equal(first[0].DetectedAmount, null); assert.equal(first[0].ReimbursedAmount, null);
  assert.match(first[0].ImportWarning, /Other pages are missing/);
  assert.equal(first[1].ReimbursedAmount, 80);
});
test('reject incomplete, bad subtotal, invalid-date and inconsistent monetary rows', () => {
  for (const html of [table([row()]).replace('$100.00</div>', '$101.00</div>'), table([row()]).replace('Sep 03, 2026</td>', 'Feb 30, 2026</td>'), table([row()]).replace('$80.00</td>', '$180.00</td>'), table([row()]).replace('<td>Details</td>', '')]) assert.throws(() => parseBlueCrossExport(html));
});
test('different processing events stay distinct and need review; unknown names never become account owner', () => {
  const report = parseBlueCrossExport(table([row('Kevin Vanderstraeten', 'Physiotherapy Treatment', 100, 24), row('Kevin Vanderstraeten', 'Physiotherapy Treatment', 100, 0, 'Sep 10, 2026'), row('Someone Else')]));
  assert.equal(report.rows.filter(row => row.needsReview).length, 3);
  assert.equal(new Set(report.rows.map(row => row.identity)).size, 3);
  assert.equal(report.rows[2].member, 'unknown');
});
test('match only exact person/date/service/amount; separate equal-amount dental procedures', () => {
  const claims = documents(table([row('Kevin Vanderstraeten', 'Scaling - Two units', 121, 24.2)]));
  const root = expense({ Id: 'root', Member: 'Kevin', Provider: 'Aplan. de racines', BilledAmount: 121 });
  const scale = expense({ Id: 'scale', Member: 'Kevin', Provider: 'Détartrage', BilledAmount: 121 });
  const result = buildReconciliationSnapshot([root, scale, ...claims]);
  assert.equal(result.cases.find(item => item.DocumentIds[0] === 'root').ReimbursedAmount, 0);
  assert.equal(result.cases.find(item => item.DocumentIds[0] === 'scale').SecondaryReimbursedAmount, 24.2);
  for (const patch of [{ ServiceDate: '2026-09-04' }, { Member: 'Jasmine' }, { Currency: 'USD' }, { BilledAmount: 122 }]) {
    assert.equal(buildReconciliationSnapshot([{ ...scale, ...patch }, ...claims]).unmatched.length, 1);
  }
});
test('coordinated submitted remainder is not the full expense; dependent insurer order is not guessed', () => {
  const claims = documents(table([row('Nathan Vanderstraeten', 'Physio 45 Minutes - In Person - Subsequent Treatment', 145, 100.8)]));
  const balance = expense({ Member: 'Nathan', AccountLabel: 'Local Desjardins import', BilledAmount: 44.2 });
  const desj = { ...balance, Id: 'desj', DocumentRole: 'insurer-statement', DocumentType: 'claim', Insurer: 'desjardins', BilledAmount: null, ReimbursedAmount: 35.36, Notes: 'Submitted 44.20;' };
  const result = buildReconciliationSnapshot([balance, desj, ...claims]).cases[0];
  assert.equal(result.OriginalAmount, 145); assert.equal(result.ReimbursedAmount, 136.16);
  assert.equal(result.PotentialRemaining, 8.84); assert.equal(result.PrimaryInsurer, null);
  assert.equal(result.SecondaryInsurer, null);
  assert.equal(result.PrimaryReimbursedAmount, null); assert.equal(result.SecondaryReimbursedAmount, null);
  assert.equal(result.DesjardinsReimbursedAmount, 35.36); assert.equal(result.BlueCrossReimbursedAmount, 100.8);
  assert.equal(result.Status, 'needs-attention'); assert.equal(result.UnallocatedReimbursedAmount, 136.16);
});
test('social worker is not guessed equivalent to clinical counsellor; excess payments require review', () => {
  assert.equal(serviceKey('Social Worker'), 'social-worker');
  assert.equal(serviceKey('Conseiller clinique - Visite'), 'clinical-counsellor');
  assert.notEqual(serviceKey('Social Worker'), serviceKey('Conseiller clinique - Visite'));
  const claims = documents(table([row('Jasmine Wing', 'Social Worker', 170, 68)]));
  assert.equal(buildReconciliationSnapshot([expense({ Provider: 'Conseiller clinique', BilledAmount: 170 }), ...claims]).unmatched.length, 1);
  const full = documents(table([row()]));
  const desj = { ...full[1], Id: 'desj', Insurer: 'desjardins', StructuredSource: undefined, ReimbursedAmount: 40 };
  const result = buildReconciliationSnapshot([expense(), ...full, desj]).cases[0];
  assert.equal(result.ReimbursedAmount, 120); assert.equal(result.Status, 'needs-attention');
});

test('exact complementary trusted payments match one expense despite conflicting insurer service labels', () => {
  const source = expense({
    Id: 'coordinated-expense', Member: 'Nathan', AccountLabel: 'Local Desjardins import',
    Provider: 'Conseiller clinique - Visite', Subject: 'Clinical visit expense',
    ServiceDate: '2026-03-12', BilledAmount: 170, DetectedAmount: 170, Healthcare: undefined,
    ClaimedService: undefined, Confidence: 99, NeedsReview: false
  });
  const desjardins = {
    ...source, Id: 'coordinated-desjardins', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    Insurer: 'desjardins', Provider: 'Desjardins · Conseiller clinique - Visite',
    BilledAmount: null, DetectedAmount: 34, ReimbursedAmount: 34,
    Notes: 'Submitted 170.00; paid 34.00;'
  };
  const blueCross = {
    ...documents(table([row('Nathan Vanderstraeten', 'Social Worker', 170, 136)]))[1],
    Id: 'coordinated-blue-cross', ServiceDate: source.ServiceDate
  };

  // Put the conflicting row first so the second matching pass has to use the assigned other insurer.
  const matched = buildReconciliationSnapshot([source, blueCross, desjardins]);
  assert.equal(matched.unmatched.length, 0);
  assert.equal(matched.cases.length, 1);
  const result = matched.cases[0];
  assert.deepEqual([result.OriginalAmount, result.DesjardinsReimbursedAmount,
    result.BlueCrossReimbursedAmount, result.PotentialRemaining], [170, 34, 136, 0]);
  assert.equal(result.MatchAssignments.length, 2);
  assert.equal(result.PrimaryInsurer, null);
  assert.equal(result.SecondaryInsurer, null);
  assert.equal(result.PrimaryReimbursedAmount, null);
  assert.equal(result.SecondaryReimbursedAmount, null);
  assert.match(result.MatchAssignments.find(item => item.ReimbursementDocumentId === blueCross.Id).Evidence.join(' '), /conflicting service labels/);

  const shortPayment = buildReconciliationSnapshot([source, desjardins, { ...blueCross, ReimbursedAmount: 135, DetectedAmount: 135 }]);
  assert.deepEqual(shortPayment.unmatched, [{ DocumentId: blueCross.Id, Reason: 'no-expense-match' }]);
  assert.equal(shortPayment.cases[0].ReimbursedAmount, 34);

  const noOtherInsurer = buildReconciliationSnapshot([source, blueCross]);
  assert.deepEqual(noOtherInsurer.unmatched, [{ DocumentId: blueCross.Id, Reason: 'no-expense-match' }]);

  const duplicate = { ...source, Id: 'same-date-same-gross-other-service', Provider: 'Massage therapy' };
  const ambiguous = buildReconciliationSnapshot([source, duplicate, desjardins, blueCross]);
  assert.equal(ambiguous.cases.length, 2);
  assert.deepEqual(ambiguous.unmatched, [{ DocumentId: blueCross.Id, Reason: 'ambiguous-match' }]);

  const ordinaryExpense = { ...source, Id: 'same-gross-matching-service', Provider: 'Social Worker' };
  const ordinary = buildReconciliationSnapshot([source, ordinaryExpense, desjardins, blueCross]);
  assert.equal(ordinary.unmatched.length, 0, 'a valid ordinary match must survive another expense\'s ambiguous fallback');
  assert.equal(ordinary.cases.find(item => item.ExpenseDocumentId === ordinaryExpense.Id).BlueCrossReimbursedAmount, 136);

  for (const blocked of [
    { ...blueCross, NeedsReview: true },
    { ...blueCross, Confidence: 70 },
    { ...blueCross, StructuredSource: undefined },
    { ...blueCross, BilledAmount: 169 },
    { ...blueCross, Member: 'unknown' },
    { ...blueCross, ServiceDate: '2026-03-13' }
  ]) assert.ok(buildReconciliationSnapshot([source, desjardins, blocked]).unmatched.some(item => item.DocumentId === blueCross.Id));
  const rejected = buildReconciliationSnapshot([source, desjardins, blueCross], [
    { reimbursementId: blueCross.Id, expenseId: source.Id, decision: 'rejected', at: '2026-03-13T00:00:00Z' }
  ]);
  assert.deepEqual(rejected.unmatched, [{ DocumentId: blueCross.Id, Reason: 'no-expense-match' }]);
});
test('provider residual and legacy insurer-derived gross expense collapse into one canonical case', () => {
  const receipt = expense({
    Id: 'coast-receipt', Member: 'Kevin', Provider: 'Coast Performance Rehabilitation',
    Subject: 'Your Receipt - Coast Performance Rehabilitation', ServiceDate: '2026-05-28',
    ClaimedService: '20 min Chiropractic Return', BilledAmount: null, DetectedAmount: null, ReimbursedAmount: null,
    Healthcare: {
      Provider: 'Coast Performance Rehabilitation', ServiceType: '20 min Chiropractic Return', ServiceDate: '2026-05-28',
      PatientBalance: 68, AmountNotCovered: 68, ProcessedInsurers: ['desjardins'], InsurerPayments: {},
      FieldSources: { ServiceDate: 'attachment', ServiceType: 'attachment', PatientBalance: 'attachment', AmountNotCovered: 'attachment' },
      FieldStates: { ServiceDate: 'confirmed', ServiceType: 'confirmed', PatientBalance: 'confirmed', AmountNotCovered: 'confirmed' }
    }
  });
  const legacyExpense = {
    ...receipt, Id: 'desj-expense', AccountLabel: 'Local Desjardins import',
    Provider: 'Chiropraticien - visite subséquente', Subject: 'Desjardins claim · Chiropraticien - visite subséquente',
    Healthcare: undefined, ClaimedService: undefined, DocumentRole: 'expense', DocumentType: 'receipt',
    Insurer: null, BilledAmount: 80, DetectedAmount: 80, ReimbursedAmount: null, Notes: 'Submitted 80.00;'
  };
  const statement = {
    ...legacyExpense, Id: 'desj-statement', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    Insurer: 'desjardins', BilledAmount: null, DetectedAmount: 12, ReimbursedAmount: 12,
    Notes: 'Submitted 80.00; paid 12.00;'
  };

  const result = buildReconciliationSnapshot([receipt, legacyExpense, statement]);
  assert.equal(result.cases.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.cases[0].Provider, 'Coast Performance Rehabilitation');
  assert.equal(result.cases[0].OriginalAmount, 80);
  assert.equal(result.cases[0].PrimaryReimbursedAmount, 12);
  assert.equal(result.cases[0].SecondaryReimbursedAmount, 0);
  assert.equal(result.cases[0].PotentialRemaining, 68);
  assert.equal(result.cases[0].Status, 'waiting-secondary');
  assert.deepEqual(new Set(result.cases[0].DocumentIds), new Set(['coast-receipt', 'desj-expense', 'desj-statement']));

  const conflictingReceipt = {
    ...receipt, Id: 'physio-receipt', ClaimedService: 'Physiotherapy Treatment',
    Healthcare: { ...receipt.Healthcare, ServiceType: 'Physiotherapy Treatment' }
  };
  const conflict = buildReconciliationSnapshot([conflictingReceipt, legacyExpense, statement]);
  assert.equal(conflict.cases.length, 2, 'different services on the same date must remain separate');
});

test('recover omitted distinct dental expense once without manufacturing unmatched invoice payments', () => {
  const root = expense({ Member: 'Kevin', Provider: 'Aplan. de racines', BilledAmount: 121 });
  const statement = { ...root, Id: 'scale-statement', Fingerprint: 'scale-fingerprint', Provider: 'Desjardins · Détartrage', DocumentRole: 'insurer-statement', AccountLabel: 'Local Desjardins import', Notes: 'Submitted 121.00;', Insurer: 'desjardins', BilledAmount: null, ReimbursedAmount: 96.8 };
  const bc = documents(table([row('Kevin Vanderstraeten', 'Scaling - Two units', 121, 24.2)]));
  const recovered = recoverMissingDesjardinsExpenses([root, statement], bc);
  assert.equal(recovered.length, 1); assert.equal(recovered[0].BilledAmount, 121);
  assert.equal(recoverMissingDesjardinsExpenses([root, statement, ...recovered], bc).length, 0);
  assert.match(recovered[0].Reasons[0], /not proof of payment/);
});
test('person/date alone or a nearby visit is insufficient evidence, even for a legacy statement', () => {
  const base = documents(table([row()]))[1];
  const noService = { ...base, StructuredSource: undefined, ClaimedService: undefined, Provider: 'Insurer', Subject: 'Statement', BilledAmount: null };
  assert.equal(buildReconciliationSnapshot([expense({ Provider: 'Clinic' }), noService]).unmatched.length, 1);
  const nearby = { ...base, StructuredSource: undefined, AccountLabel: 'Local Desjardins import', ServiceDate: '2026-09-04', Notes: 'Submitted 100.00;' };
  assert.equal(buildReconciliationSnapshot([expense(), nearby]).unmatched.length, 1);
});
test('oversized recognized exports and extreme amounts fail closed', () => {
  assert.throws(() => parseBlueCrossExport('x'.repeat(2000000) + table([row()])));
  assert.throws(() => parseBlueCrossExport(table([row('Jasmine Wing', 'Physio', 1000000000, 80)])));
});
test('real importer workflow previews, backs up, deduplicates and preserves corrections using synthetic Gmail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-bluecross-'));
  try {
    const result = spawnSync(process.execPath, ['tests/fixtures/bluecross-import-runner.mjs'], { cwd: process.cwd(), env: { ...process.env, FAMILYHUB_WORKER_DATA: dir }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
