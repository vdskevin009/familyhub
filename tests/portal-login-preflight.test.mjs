import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'familyhub-preflight-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const auth = await import('../apps/worker/dist/portal-login.js');
test.after(() => rm(directory, { recursive: true, force: true }));
const credentials = { version: 1, insurer: 'desjardins', username: 'synthetic-user', password: 'synthetic-password' };

function fixture(initial = { blocked: false }) {
  let state = structuredClone(initial), clock = 10_000_000, ready = false;
  const events = [], diagnostics = [];
  const options = { invalid: false, errorAt: '', rejection: '', failSave: false, readyError: false };
  let body = '', reads = 0, clicks = 0;
  const page = {
    url: () => 'https://id.desjardins.com/login?state=synthetic-private-token',
    locator: selector => ({
      first() { return this; }, count: async () => 1, isVisible: async () => !selector.startsWith('iframe['), isEditable: async () => true,
      getAttribute: async () => options.invalid ? 'text' : /password/i.test(selector) ? 'password' : 'text',
      innerText: async () => body,
      fill: async () => { assert.equal(state.blocked, true); events.push('fill:' + selector); if (options.errorAt === selector) throw new Error('synthetic-password at a private URL'); },
      click: async () => { assert.equal(state.blocked, true); clicks++; events.push('submit'); if (options.errorAt === 'submit') { const error = new Error('synthetic-private-token'); error.name = 'TimeoutError'; throw error; } body = options.rejection; ready = !body; }
    }),
    waitForTimeout: async amount => { clock += amount; }
  };
  const deps = {
    now: () => clock, read: async () => structuredClone(state),
    save: async (_, value) => { if (options.failSave) throw new Error('synthetic-private-token'); state = structuredClone(value); events.push('saved:' + value.blocked); },
    credentials: async () => { reads++; return credentials; }, submit: auth.submitPortalLogin,
    diagnose: async (_, value) => diagnostics.push(structuredClone(value))
  };
  return { page, deps, options, events, diagnostics, ready: async () => { if (options.readyError) throw new Error('Synthetic post-auth navigation failure'); return ready; }, state: () => state, reads: () => reads, clicks: () => clicks };
}

test('read-only preflight failure never fills fields, latches a stop or changes attemptedAt', async () => {
  const previous = { blocked: false, attemptedAt: new Date(1).toISOString() };
  const f = fixture(previous); f.options.invalid = true;
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), 'layout-changed');
  assert.equal(f.state().blocked, false); assert.equal(f.state().attemptedAt, previous.attemptedAt);
  assert.equal(f.clicks(), 0); assert.ok(f.events.every(event => !event.startsWith('fill:')));
  assert.equal(f.state().firstFailure.outcome, 'preflight'); assert.equal(f.state().firstFailure.phase, 'checking-form');
});

test('corrected preflight can recover on the next request with exactly one guarded transmission', async () => {
  const f = fixture(); f.options.invalid = true;
  await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps);
  f.options.invalid = false;
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), undefined);
  assert.equal(f.clicks(), 1); assert.equal(f.state().blocked, false);
  assert.ok(f.events.indexOf('saved:true') < f.events.indexOf('fill:#UserName'));
  assert.equal(f.diagnostics.at(-1).phase, 'authenticated');
});

test('failure at the first identifier fill stays uncertain; original phase survives blocked reads', async () => {
  const f = fixture(); f.options.errorAt = '#UserName';
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), 'login-incomplete');
  const original = structuredClone(f.state()); const readCount = f.reads();
  assert.equal(original.firstFailure.outcome, 'uncertain'); assert.equal(original.firstFailure.phase, 'filling-username');
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), 'login-incomplete');
  assert.deepEqual(f.state(), original); assert.equal(f.reads(), readCount); assert.equal(f.clicks(), 0);
  assert.equal(f.diagnostics.at(-1).phase, 'retry-blocked');
  assert.deepEqual(f.diagnostics.at(-1).originalFailure, original.firstFailure);
});

test('submit timeout keeps a hard stop and sanitized original evidence across retry', async () => {
  const f = fixture(); f.options.errorAt = 'submit';
  await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps);
  await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps);
  assert.equal(f.state().blocked, true); assert.equal(f.clicks(), 1);
  assert.equal(f.diagnostics.at(-1).originalFailure.phase, 'submitting');
  assert.equal(f.diagnostics.at(-1).originalFailure.errorKind, 'timeout');
  const encoded = JSON.stringify({ state: f.state(), diagnostics: f.diagnostics });
  for (const secret of ['synthetic-password', 'synthetic-user', 'synthetic-private-token', 'https://']) assert.ok(!encoded.includes(secret));
});

test('observed rejection and challenge each retain a specific hard stop without replay', async () => {
  for (const [text, reason, outcome] of [['Invalid password', 'credentials-rejected', 'rejection'], ['Enter verification code', 'human-required', 'human-required']]) {
    const f = fixture(); f.options.rejection = text;
    assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), reason);
    assert.equal(f.state().firstFailure.outcome, outcome);
    assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), reason);
    assert.equal(f.clicks(), 1); assert.equal(f.state().blocked, true);
  }
});

test('legacy unknown stops are not reclassified, migrated, cleared or allowed to read credentials', async () => {
  for (const reason of ['login-incomplete', 'human-required']) {
    const legacy = { blocked: true, reason, attemptedAt: '2026-01-01T00:00:00.000Z' };
    const f = fixture(legacy);
    assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), reason);
    assert.deepEqual(f.state(), legacy); assert.equal(f.reads(), 0); assert.equal(f.events.length, 0);
    assert.equal(f.diagnostics.at(-1).originalFailureUnavailable, true);
    assert.equal(f.diagnostics.at(-1).originalFailure, undefined);
  }
});

test('absence of transmission instrumentation grants no preflight recovery', async () => {
  const f = fixture(); f.deps.submit = async () => { throw new Error('Missing instrumentation is not proof'); };
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), 'login-incomplete');
  assert.equal(f.state().blocked, true); assert.equal(f.state().firstFailure.outcome, 'uncertain');
});

test('failure to persist the attempt guard prevents any field fill or submit', async () => {
  const f = fixture(); f.options.failSave = true;
  await assert.rejects(auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), /^Error: Could not persist the login attempt guard\.$/);
  assert.equal(f.clicks(), 0); assert.equal(f.events.length, 0);
});

test('navigation failing after verified authentication does not create a credential-failure stop', async () => {
  const f = fixture();
  assert.equal(await auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), undefined);
  const verified = structuredClone(f.state()); f.options.readyError = true;
  await assert.rejects(auth.tryPortalLogin(f.page, 'desjardins', f.ready, f.deps), /post-auth navigation failure/);
  assert.deepEqual(f.state(), verified); assert.equal(f.clicks(), 1); assert.equal(f.reads(), 1);
});

test('legacy file bytes stay identical and invalid new failure evidence is fail-closed', async () => {
  const path = join(directory, 'desjardins', 'login-control.json'); await mkdir(join(directory, 'desjardins'), { recursive: true });
  const legacy = '{ "blocked": true, "reason": "login-incomplete", "attemptedAt": "2026-01-01T00:00:00.000Z" }\n';
  await writeFile(path, legacy); const state = await auth.readLoginControl('desjardins');
  assert.equal(auth.loginGate(state), 'login-incomplete'); assert.equal(await readFile(path, 'utf8'), legacy);
  await writeFile(path, JSON.stringify({ blocked: false, firstFailure: { observedAt: '2026-01-01', phase: 'checking-form', reason: 'layout-changed', outcome: 'preflight', rawUrl: 'synthetic-private-token' } }));
  assert.deepEqual(await auth.readLoginControl('desjardins'), { blocked: true, reason: 'credentials-unavailable' });
});
