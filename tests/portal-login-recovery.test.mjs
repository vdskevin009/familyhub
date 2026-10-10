import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const directory = await mkdtemp(join(tmpdir(), 'familyhub-login-recovery-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const auth = await import('../apps/worker/dist/portal-login.js');
const recovery = await import('../apps/worker/dist/portal-login-recovery.js');
test.after(() => rm(directory, { recursive: true, force: true }));
const attemptedAt = '2026-01-01T00:00:00.000Z';
const request = () => ({ requestId: randomUUID(), expectedAttemptedAt: attemptedAt, acknowledgeUncertainAttempt: true });
const legacy = () => ({ blocked: true, reason: 'login-incomplete', attemptedAt });
const auditFile = (insurer, id) => join(directory, insurer, 'login-recovery', id.toLowerCase() + '.json');

function fixture(insurer = 'desjardins', initial = legacy()) {
  let state = structuredClone(initial), clock = Date.parse(attemptedAt) + 3600000, ready = false, reads = 0;
  const events = [], diagnostics = [];
  const options = { preflight: false, screen: '', failAt: '', saveFailure: false, auditFailure: false, challengeFrame: false, finalAuditFailure: false };
  let body = '';
  const page = { url: () => insurer === 'desjardins' ? 'https://id.desjardins.com/login?private=synthetic-token' : 'https://service.pac.bluecross.ca/member/login',
    locator: selector => ({ first() { return this; }, count: async () => 1, isVisible: async () => selector.startsWith('iframe[') ? options.challengeFrame : true,
      isEditable: async () => true, getAttribute: async () => options.preflight ? 'bad' : /password/i.test(selector) ? 'password' : 'text',
      innerText: async () => body, fill: async () => { assert.equal(state.blocked, true); events.push('fill'); if (options.failAt === 'fill') throw new Error('synthetic-secret'); },
      check: async () => {}, click: async () => { events.push('submit'); if (options.failAt === 'submit') throw new Error('synthetic-secret'); body = options.screen; ready = !body; }
    }), getByRole() { return this.locator('submit'); }, waitForTimeout: async ms => { clock += ms; }
  };
  const deps = { now: () => clock, read: async () => structuredClone(state),
    save: async (_, value) => { if (options.saveFailure) throw new Error('synthetic-secret'); state = structuredClone(value); events.push('guard'); },
    credentials: async () => { reads++; return { version: 1, insurer, password: 'synthetic-secret', username: 'synthetic-user', policy: 'synthetic-policy', certificate: 'synthetic-certificate', role: 'member' }; },
    submit: auth.submitPortalLogin, diagnose: async (_, value) => diagnostics.push(value),
    reserveRecovery: async (...args) => { const update = await recovery.reserveLoginRecovery(...args); return async (...values) => { if (options.auditFailure || options.finalAuditFailure && values[0] === 'authenticated') throw new Error('synthetic-secret'); events.push('audit:' + values[0]); await update(...values); }; }
  };
  return { page, deps, options, events, diagnostics, ready: async () => ready, state: () => state, reads: () => reads,
    screen: text => { body = text; }, setState: value => { state = structuredClone(value); } };
}

test('explicit recovery uses saved credentials once for each insurer without clearing the original stop first', async () => {
  for (const insurer of ['desjardins', 'bluecross']) {
    const f = fixture(insurer), approved = request();
    assert.equal(await auth.tryPortalLogin(f.page, insurer, f.ready, f.deps, approved), undefined);
    assert.equal(f.reads(), 1); assert.equal(f.events.filter(x => x === 'submit').length, 1);
    assert.ok(f.events.indexOf('audit:transmission-starting') < f.events.indexOf('guard'));
    assert.ok(f.events.indexOf('guard') < f.events.indexOf('fill'));
    assert.equal(f.state().blocked, false); assert.equal(f.diagnostics.at(-1).phase, 'authenticated');
    const audit = JSON.parse(await readFile(auditFile(insurer, approved.requestId), 'utf8'));
    assert.deepEqual(audit.originalControl, legacy()); assert.equal(audit.outcome, 'authenticated');
    const encoded = JSON.stringify({ audit, diagnostic: f.diagnostics });
    for (const secret of ['synthetic-secret', 'synthetic-token', 'synthetic-user', 'synthetic-policy', 'synthetic-certificate', 'https://']) assert.equal(encoded.includes(secret), false);
    if (insurer === 'bluecross') assert.equal(f.diagnostics.at(-1).landingHost, 'service.pac.bluecross.ca');
  }
});

test('post-input failures stop ordinary sync and retain exact original evidence in an audit', async () => {
  for (const failAt of ['fill', 'submit']) {
    const f = fixture(), approved = request(); f.options.failAt = failAt;
    assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, approved), 'login-incomplete');
    assert.equal(f.state().blocked, true); assert.notEqual(f.state().attemptedAt, attemptedAt);
    assert.equal(JSON.parse(await readFile(auditFile('desjardins', approved.requestId), 'utf8')).outcome, 'uncertain');
    const readCount = f.reads(), state = structuredClone(f.state());
    assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), 'login-incomplete');
    assert.deepEqual(f.state(), state); assert.equal(f.reads(), readCount);
    assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, approved), 'login-incomplete');
    assert.equal(f.reads(), readCount);
  }
});

test('replaying the same recovery after preflight or interruption is refused before credential loading', async () => {
  const f = fixture(), approved = request(); f.options.preflight = true;
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, approved), 'layout-changed');
  assert.deepEqual(f.state(), legacy()); const readCount = f.reads();
  f.options.preflight = false;
  await assert.rejects(auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, approved), /already been used/);
  assert.equal(f.reads(), readCount); assert.equal(f.events.includes('fill'), false);
  const interrupted = request(); await recovery.reserveLoginRecovery('desjardins', interrupted, legacy(), f.deps.now());
  await assert.rejects(auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, interrupted), /already been used/);
  assert.equal(f.reads(), readCount);
});

test('known rejection, human challenge, corrupt state, cooldown and stale acknowledgement cannot authorize a retry', async () => {
  const firstFailure = { observedAt: attemptedAt, phase: 'submitting', reason: 'credentials-rejected', outcome: 'rejection' };
  for (const initial of [ { ...legacy(), reason: 'human-required' }, { ...legacy(), reason: 'credentials-rejected' },
    { ...legacy(), reason: 'credentials-unavailable' }, { ...legacy(), firstFailure }, { ...legacy(), firstFailure: { ...firstFailure, outcome: 'human-required' } },
    { ...legacy(), attemptedAt: '2026-01-01T00:50:00.000Z' }, { blocked: false, attemptedAt } ]) {
    const f = fixture('desjardins', initial); const approved = { ...request(), expectedAttemptedAt: initial.attemptedAt };
    assert.ok(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, approved)); assert.equal(f.reads(), 0);
    assert.deepEqual(f.state(), initial);
  }
  const f = fixture();
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, { ...request(), expectedAttemptedAt: '2025-12-01T00:00:00.000Z' }), 'login-incomplete');
  assert.equal(f.reads(), 0);
});

test('current portal challenge/rejection refuses transmission; post-submit challenge/refusal persists a stop', async () => {
  for (const [screen, reason, outcome] of [['Enter verification code', 'human-required', 'human-required'], ['Invalid password', 'credentials-rejected', 'rejection']]) {
    for (const beforeSubmit of [true, false]) {
      const f = fixture(), approved = request(); if (beforeSubmit) f.screen(screen); else f.options.screen = screen;
      assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, approved), reason);
      assert.equal(f.state().blocked, true);
      assert.equal(JSON.parse(await readFile(auditFile('desjardins', approved.requestId), 'utf8')).outcome, outcome);
      assert.equal(f.events.filter(x => x === 'submit').length, beforeSubmit ? 0 : 1);
      if (beforeSubmit) assert.equal(f.reads(), 0);
    }
  }
});

test('failed durable audit or attempt guard never fills a field', async () => {
  for (const property of ['auditFailure', 'saveFailure']) {
    const f = fixture(); f.options[property] = true;
    await assert.rejects(auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps, request()), /persist the login attempt guard/);
    assert.equal(f.events.includes('fill'), false); assert.equal(f.events.includes('submit'), false);
  }
});

test('post-submit challenge iframe is classified and post-authentication audit failure does not invent failed credentials', async () => {
  const challenge = fixture(); challenge.options.screen = 'Please continue';
  const submit = challenge.deps.submit;
  challenge.deps.submit = async (...args) => { await submit(...args); challenge.options.challengeFrame = true; };
  assert.equal(await auth.tryPortalLogin(challenge.page, 'desjardins', challenge.ready, challenge.deps, request()), 'human-required');
  assert.equal(challenge.state().firstFailure.outcome, 'human-required');
  const success = fixture(); success.options.finalAuditFailure = true;
  await assert.rejects(auth.tryPortalLogin(success.page, 'desjardins', success.ready, success.deps, request()), /Authentication was verified/);
  assert.equal(success.state().blocked, false); assert.equal(success.events.filter(x => x === 'submit').length, 1);
});

test('recovery sync forwards approval to the actual collector once and never retries a transient error or imports on failure', async () => {
  const invoices = await import('../apps/worker/dist/invoices.js');
  await invoices.initializeInvoices(true);
  for (const [insurer, sync] of [['bluecross', invoices.syncBlueCrossPortal], ['desjardins', invoices.syncDesjardinsPortal]]) {
    const before = await invoices.invoiceSnapshot(); let count = 0; const approved = request();
    await assert.rejects(sync(false, false, async (...args) => {
      count++; assert.equal(args[0], false);
      assert.equal(args[insurer === 'bluecross' ? 1 : 2], approved);
      throw new Error('ETIMEDOUT');
    }, false, approved), /portal collection failed/);
    assert.equal(count, 1);
    assert.deepEqual((await invoices.invoiceSnapshot()).items, before.items);
    assert.equal((insurer === 'bluecross' ? invoices.getBlueCrossStatus() : invoices.getDesjardinsStatus()).retry.maximum, 1);
  }
});

test('acknowledgement parser rejects missing, ambiguous, path-bearing or secret-bearing payloads', () => {
  for (const invalid of [null, {}, { ...request(), acknowledgeUncertainAttempt: false }, { ...request(), requestId: '../escape' },
    { ...request(), expectedAttemptedAt: '2026-01-01' }, { ...request(), password: 'synthetic-secret' }])
    assert.throws(() => recovery.parseLoginRecoveryRequest(invalid), /explicit acknowledgement/);
  const approved = request(); assert.deepEqual(recovery.parseLoginRecoveryRequest(approved), approved);
});
