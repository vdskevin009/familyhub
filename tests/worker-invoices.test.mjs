import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

test('invoice endpoints require pairing/origin checks and report unconfigured Gmail honestly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-api-'));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  await writeFile(join(dir, 'pairing-key.txt'), 'synthetic-test-key');
  const child = spawn(process.execPath, ['apps/worker/dist/index.js'], { env: { ...process.env, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: dir, FAMILYHUB_WORKER_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
  const done = once(child, 'exit');
  const call = (path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, init);
  const headers = { 'x-familyhub-key': 'synthetic-test-key', Origin: 'https://vdskevin009.github.io' };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await call('/health', { headers })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    assert.equal((await call('/invoices')).status, 401);
    assert.equal((await call('/invoices', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    const response = await call('/invoices', { headers });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const state = await response.json(); assert.equal(state.setupRequired, true); assert.deepEqual(state.items, []);
    assert.equal((await call('/invoices/collect', { method: 'POST', headers })).status, 409);
    assert.equal((await call('/invoices/missing/attachments/path', { headers })).status, 400);
    assert.equal((await call('/invoices/missing/correction', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"kind":"marketing"}' })).status, 400);
    assert.equal(logs.includes('synthetic-test-key'), false, 'Pairing key must not be logged');
  } finally { child.kill(); await done; await rm(dir, { recursive: true, force: true }); }
});


test('manual match confirmation and rejection persist across worker restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-match-decision-'));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  await writeFile(join(dir, 'pairing-key.txt'), 'synthetic-match-key');
  const common = {
    AccountLabel: 'Test', AccountEmail: 'test@example.test', ThreadId: 'thread', InternetMessageId: '<test@example.test>',
    Sender: 'Example', ReceivedAt: '2026-09-11T12:00:00Z', Category: 0, Status: 0, Currency: 'CAD',
    Notes: '', Attachments: [], WorkerManaged: true, ReimbursementEligibility: 'possible',
    ClassificationSource: 'rules', AmountSource: 'email-text', HasUnsubscribe: false,
    AttentionLevel: 'none', AttentionReason: '', Fingerprint: 'synthetic', Reasons: ['Synthetic']
  };
  const expense = { ...common, Id: 'expense-1', SourceMessageId: 'expense-message', Subject: 'Clinic receipt',
    Provider: 'Sample Clinic', Member: 'Kevin', DocumentRole: 'expense', DocumentType: 'receipt',
    ServiceDate: '2026-09-11', BilledAmount: 100, DetectedAmount: 100, ReimbursedAmount: null,
    Insurer: null, Confidence: 85, NeedsReview: true, Healthcare: { ServiceType: 'Physiotherapy', OriginalBilledAmount: 100 } };
  const statement = { ...common, Id: 'statement-1', SourceMessageId: 'statement-message', Subject: 'Desjardins physiotherapy claim',
    Provider: 'Desjardins · Physiotherapy', Member: 'Kevin', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    ServiceDate: '2026-09-11', BilledAmount: 50, DetectedAmount: 50, ReimbursedAmount: 50,
    Insurer: 'desjardins', Confidence: 99, NeedsReview: false, Healthcare: { ServiceDate: '2026-09-11', ServiceType: 'Physiotherapy' } };
  await writeFile(join(dir, 'invoices.json'), JSON.stringify({ items: [expense, statement], corrections: [], decisions: [], matchDecisions: [], reviews: [], accounts: {} }));

  const headers = { 'x-familyhub-key': 'synthetic-match-key', Origin: 'https://vdskevin009.github.io' };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['apps/worker/dist/index.js'], { env: { ...process.env, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: dir, FAMILYHUB_WORKER_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { headers })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('worker did not start');
  };
  const stop = async () => {
    if (!child) return;
    const done = once(child, 'exit'); child.kill(); await done; child = undefined;
  };
  const snapshot = async () => (await fetch(`http://127.0.0.1:${port}/invoices`, { headers })).json();

  try {
    await start();
    let state = await snapshot();
    assert.equal(state.unmatchedReimbursements.length, 0);
    assert.equal(state.reconciliations[0].MatchAssignments[0].Verification, 'review-recommended');

    let response = await fetch(`http://127.0.0.1:${port}/invoices/matches/decision`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ reimbursementId: 'statement-1', expenseId: 'expense-1', decision: 'confirmed' })
    });
    assert.equal(response.status, 200);
    state = await snapshot();
    assert.equal(state.reconciliations[0].MatchAssignments[0].Verification, 'confirmed-manually');

    await stop(); await start();
    state = await snapshot();
    assert.equal(state.reconciliations[0].MatchAssignments[0].Verification, 'confirmed-manually', 'confirmation survives restart');

    response = await fetch(`http://127.0.0.1:${port}/invoices/matches/decision`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ reimbursementId: 'statement-1', expenseId: 'expense-1', decision: 'rejected' })
    });
    assert.equal(response.status, 200);
    state = await snapshot();
    assert.deepEqual(state.unmatchedReimbursements, [{ DocumentId: 'statement-1', Reason: 'no-expense-match' }]);

    await stop(); await start();
    state = await snapshot();
    assert.deepEqual(state.unmatchedReimbursements, [{ DocumentId: 'statement-1', Reason: 'no-expense-match' }], 'rejection survives restart');
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});


test('reimbursement workflow overrides persist, audit, ignore and reset to automatic', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-workflow-decision-'));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  await writeFile(join(dir, 'pairing-key.txt'), 'synthetic-workflow-key');
  const common = {
    AccountLabel: 'Test', AccountEmail: 'test@example.test', ThreadId: 'thread', InternetMessageId: '<workflow@example.test>',
    Sender: 'Example', ReceivedAt: '2026-09-12T12:00:00Z', Category: 0, Status: 0, Currency: 'CAD',
    Notes: '', Attachments: [], WorkerManaged: true, ReimbursementEligibility: 'possible',
    ClassificationSource: 'rules', AmountSource: 'email-text', HasUnsubscribe: false,
    AttentionLevel: 'none', AttentionReason: '', Fingerprint: 'workflow-synthetic', Reasons: ['Synthetic']
  };
  const expense = { ...common, Id: 'workflow-expense', SourceMessageId: 'workflow-expense-message', Subject: 'Clinic receipt',
    Provider: 'Sample Clinic', Member: 'Kevin', DocumentRole: 'expense', DocumentType: 'receipt',
    ServiceDate: '2026-09-12', BilledAmount: 100, DetectedAmount: 100, ReimbursedAmount: null,
    Insurer: null, Confidence: 99, NeedsReview: false, Healthcare: { ServiceType: 'Physiotherapy', OriginalBilledAmount: 100 } };
  const primary = { ...common, Id: 'workflow-primary', SourceMessageId: 'workflow-primary-message', Subject: 'Desjardins claim',
    Provider: 'Desjardins · Physiotherapy', Member: 'Kevin', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    ServiceDate: '2026-09-12', BilledAmount: 100, DetectedAmount: 60, ReimbursedAmount: 60,
    Insurer: 'desjardins', Confidence: 99, NeedsReview: false, Healthcare: { ServiceDate: '2026-09-12', ServiceType: 'Physiotherapy', SubmittedAmount: 100 } };
  const secondary = { ...common, Id: 'workflow-secondary', SourceMessageId: 'workflow-secondary-message', Subject: 'Blue Cross claim',
    Provider: 'Blue Cross · Physiotherapy', Member: 'Kevin', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    ServiceDate: '2026-09-12', BilledAmount: 100, DetectedAmount: 20, ReimbursedAmount: 20,
    Insurer: 'blue-cross', Confidence: 99, NeedsReview: false, Healthcare: { ServiceDate: '2026-09-12', ServiceType: 'Physiotherapy', SubmittedAmount: 100 } };
  const at = '2026-09-12T15:00:00.000Z';
  await writeFile(join(dir, 'invoices.json'), JSON.stringify({
    items: [expense, primary, secondary], corrections: [], decisions: [], reviews: [], accounts: {},
    matchDecisions: [
      { reimbursementId: 'workflow-primary', expenseId: 'workflow-expense', decision: 'confirmed', at, confidence: 99 },
      { reimbursementId: 'workflow-secondary', expenseId: 'workflow-expense', decision: 'confirmed', at, confidence: 99 }
    ]
  }));

  const headers = { 'x-familyhub-key': 'synthetic-workflow-key', Origin: 'https://vdskevin009.github.io' };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['apps/worker/dist/index.js'], { env: { ...process.env, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: dir, FAMILYHUB_WORKER_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { headers })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('worker did not start');
  };
  const stop = async () => {
    if (!child) return;
    const done = once(child, 'exit'); child.kill(); await done; child = undefined;
  };
  const snapshot = async () => (await fetch(`http://127.0.0.1:${port}/invoices`, { headers })).json();
  const setWorkflow = (status) => fetch(`http://127.0.0.1:${port}/invoices/workflow/status`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ expenseId: 'workflow-expense', status })
  });

  try {
    await start();
    let state = await snapshot();
    assert.equal(state.reconciliations.length, 1);
    assert.equal(state.reconciliations[0].PotentialRemaining, 20);
    assert.equal(state.reconciliations[0].WorkflowStatus, 'closed', 'both trusted insurer matches close automatically despite remaining balance');
    assert.equal(state.reconciliations[0].WorkflowOrigin, 'automatic');

    assert.equal((await setWorkflow('open')).status, 200);
    state = await snapshot();
    assert.equal(state.reconciliations[0].WorkflowStatus, 'open');
    assert.equal(state.reconciliations[0].WorkflowOrigin, 'manual');
    assert.ok(state.reconciliations[0].WorkflowChangedAt);
    assert.ok(state.reconciliations[0].WorkflowHistory.some(entry => entry.Status === 'open' && entry.Origin === 'manual'));

    await stop(); await start();
    state = await snapshot();
    assert.equal(state.reconciliations[0].WorkflowStatus, 'open', 'manual override survives restart');
    assert.equal(state.reconciliations[0].WorkflowOrigin, 'manual');

    assert.equal((await setWorkflow('ignore')).status, 200);
    state = await snapshot();
    assert.equal(state.reconciliations.length, 0);
    assert.equal(state.ignoredExpenses.length, 1);
    assert.equal(state.ignoredExpenses[0].WorkflowStatus, 'ignore');
    assert.equal(state.ignoredExpenses[0].WorkflowOrigin, 'manual');

    assert.equal((await setWorkflow('automatic')).status, 200);
    state = await snapshot();
    assert.equal(state.ignoredExpenses.length, 0);
    assert.equal(state.reconciliations.length, 1);
    assert.equal(state.reconciliations[0].WorkflowStatus, 'closed');
    assert.equal(state.reconciliations[0].WorkflowOrigin, 'automatic');
    assert.ok(state.reconciliations[0].WorkflowHistory.some(entry => entry.Reason === 'reset-to-automatic'));
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});


test('manual unmatched matching and ignore/restore persist for Nathan same-day ambiguous reimbursements', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-unmatched-manual-'));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  await writeFile(join(dir, 'pairing-key.txt'), 'synthetic-unmatched-key');

  const common = {
    AccountLabel: 'Test', AccountEmail: 'test@example.test', ThreadId: 'thread', InternetMessageId: '<unmatched@example.test>',
    Sender: 'Example', ReceivedAt: '2026-02-07T12:00:00Z', Category: 0, Status: 0, Currency: 'CAD',
    Notes: '', Attachments: [], WorkerManaged: true, ReimbursementEligibility: 'possible',
    ClassificationSource: 'rules', AmountSource: 'email-text', HasUnsubscribe: false,
    AttentionLevel: 'none', AttentionReason: '', Fingerprint: 'unmatched-synthetic', Reasons: ['Synthetic']
  };
  const expense = (id, date, provider, invoiceNumber) => ({
    ...common, Id: id, SourceMessageId: id + '-message', Subject: provider + ' receipt',
    Provider: provider, Member: 'Nathan', DocumentRole: 'expense', DocumentType: 'receipt',
    ServiceDate: date, BilledAmount: 100, DetectedAmount: 100, ReimbursedAmount: null,
    Insurer: null, Confidence: 99, NeedsReview: false,
    Healthcare: { InvoiceNumber: invoiceNumber, ServiceDate: date, ServiceType: 'Chiropractic', OriginalBilledAmount: 100, Provider: provider }
  });
  const statement = (id, date, amount) => ({
    ...common, Id: id, SourceMessageId: id + '-message', Subject: 'Desjardins chiropractic claim',
    Provider: 'Desjardins · Chiropractic', Member: 'Nathan', DocumentRole: 'insurer-statement', DocumentType: 'claim',
    ServiceDate: date, BilledAmount: 100, DetectedAmount: amount, ReimbursedAmount: amount,
    Insurer: 'desjardins', Confidence: 99, NeedsReview: false,
    Healthcare: { ServiceDate: date, ServiceType: 'Chiropractic', SubmittedAmount: 100 }
  });

  const items = [
    expense('feb-expense-a', '2026-02-06', 'North Shore Chiro A', 'FEB-A'),
    expense('feb-expense-b', '2026-02-06', 'North Shore Chiro B', 'FEB-B'),
    expense('dec-expense-a', '2025-12-12', 'North Shore Chiro A', 'DEC-A'),
    expense('dec-expense-b', '2025-12-12', 'North Shore Chiro B', 'DEC-B'),
    statement('feb-statement-1', '2026-02-06', 30),
    statement('feb-statement-2', '2026-02-06', 20),
    statement('feb-statement-3', '2026-02-06', 10),
    statement('dec-statement-1', '2025-12-12', 35),
    statement('dec-statement-2', '2025-12-12', 25),
    statement('dec-statement-3', '2025-12-12', 15)
  ];
  await writeFile(join(dir, 'invoices.json'), JSON.stringify({
    items, corrections: [], decisions: [], matchDecisions: [], unmatchedDecisions: [], workflowRecords: [], reviews: [], accounts: {}
  }));

  const headers = { 'x-familyhub-key': 'synthetic-unmatched-key', Origin: 'https://vdskevin009.github.io' };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['apps/worker/dist/index.js'], { env: { ...process.env, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: dir, FAMILYHUB_WORKER_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { headers })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('worker did not start');
  };
  const stop = async () => {
    if (!child) return;
    const done = once(child, 'exit'); child.kill(); await done; child = undefined;
  };
  const snapshot = async () => (await fetch(`http://127.0.0.1:${port}/invoices`, { headers })).json();

  try {
    await start();
    let state = await snapshot();
    assert.equal(state.unmatchedReimbursements.length, 6);
    assert.equal(state.unmatchedReimbursements.filter(item => item.Reason === 'ambiguous-match').length, 6);
    assert.equal(state.unmatchedReimbursements.filter(item => item.DocumentId.startsWith('feb-')).length, 3);
    assert.equal(state.unmatchedReimbursements.filter(item => item.DocumentId.startsWith('dec-')).length, 3);

    let response = await fetch(`http://127.0.0.1:${port}/invoices/matches/manual`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ reimbursementId: 'feb-statement-1', expenseId: 'feb-expense-a' })
    });
    assert.equal(response.status, 200);
    state = await snapshot();
    assert.equal(state.unmatchedReimbursements.length, 5);
    const matchedCase = state.reconciliations.find(item => item.ExpenseDocumentId === 'feb-expense-a');
    assert.ok(matchedCase);
    assert.equal(matchedCase.MatchAssignments.some(item => item.ReimbursementDocumentId === 'feb-statement-1' && item.Verification === 'confirmed-manually'), true);
    assert.equal(matchedCase.ReimbursedAmount, 30);
    assert.equal(matchedCase.PotentialRemaining, 70);

    response = await fetch(`http://127.0.0.1:${port}/invoices/matches/manual`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ reimbursementId: 'feb-statement-1', expenseId: 'feb-expense-b' })
    });
    assert.equal(response.status, 400, 'one reimbursement cannot be manually assigned twice');

    response = await fetch(`http://127.0.0.1:${port}/invoices/unmatched/ignore`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ reimbursementId: 'feb-statement-2', ignored: true })
    });
    assert.equal(response.status, 200);
    state = await snapshot();
    assert.equal(state.unmatchedReimbursements.some(item => item.DocumentId === 'feb-statement-2'), false);
    assert.equal(state.ignoredUnmatchedReimbursements.length, 1);
    assert.equal(state.ignoredUnmatchedReimbursements[0].DocumentId, 'feb-statement-2');
    assert.ok(state.ignoredUnmatchedReimbursements[0].IgnoredAt);
    assert.ok(state.items.some(item => item.Id === 'feb-statement-2'), 'ignored reimbursement source evidence remains in snapshot');

    await stop(); await start();
    state = await snapshot();
    assert.equal(state.reconciliations.find(item => item.ExpenseDocumentId === 'feb-expense-a').MatchAssignments[0].Verification, 'confirmed-manually', 'manual assignment survives restart');
    assert.equal(state.ignoredUnmatchedReimbursements[0].DocumentId, 'feb-statement-2', 'ignored unmatched decision survives restart');
    assert.equal(state.unmatchedReimbursements.some(item => item.DocumentId === 'feb-statement-2'), false);

    response = await fetch(`http://127.0.0.1:${port}/invoices/unmatched/ignore`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ reimbursementId: 'feb-statement-2', ignored: false })
    });
    assert.equal(response.status, 200);
    state = await snapshot();
    assert.equal(state.ignoredUnmatchedReimbursements.length, 0);
    assert.equal(state.unmatchedReimbursements.some(item => item.DocumentId === 'feb-statement-2'), true, 'restore returns reimbursement to active review');
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
