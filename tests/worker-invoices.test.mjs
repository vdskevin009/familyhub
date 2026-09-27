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
