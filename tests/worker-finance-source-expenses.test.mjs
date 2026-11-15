import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { FinanceLibrary } from '../apps/worker/dist/finance-library.js';
import { SOURCE_EXPENSES_CAPABILITY as capability, SOURCE_EXPENSES_LIMITS } from '../apps/worker/dist/finance-source-expenses-model.js';
import { financeFixture } from './finance-fixture.mjs';
import { expenseSnapshot } from './finance-source-expenses-fixture.mjs';

export function currentExpenseFixture(offsetMs = -1000) {
  const f = expenseSnapshot(), collectedAt = new Date(Date.now() + offsetMs).toISOString();
  f.collectedAt = collectedAt;
  return f;
}
test('paired source expenses API protects privacy, read-only preview, revision, replay, body caps and durable separate storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-source-api-synthetic-')), key = 'synthetic-expenses-pairing-key';
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  await writeFile(join(dir, 'pairing-key.txt'), key);
  const library = new FinanceLibrary(join(dir, 'finances'));
  const original = (await library.import({ bundle: financeFixture(), apply: true, expectedRevision: 'empty' })).state;
  const canonicalPath = join(dir, 'finances', 'ledger.json'), before = await readFile(canonicalPath, 'utf8');
  const headers = { 'x-familyhub-key': key, Origin: 'https://vdskevin009.github.io', 'Content-Type': 'application/json' };
  const url = '/finance/source-expenses'; let child, stopped, logs = '';
  const call = (path = url, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, init);
  const post = body => call(url, { method: 'POST', headers, body: JSON.stringify(body) });
  async function start() {
    child = spawn(process.execPath, ['apps/worker/dist/index.js'], { env: { ...process.env, FAMILYHUB_WORKER_DATA: dir, FAMILYHUB_WORKER_HOST: '127.0.0.1', FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_ALLOWED_ORIGINS: headers.Origin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    stopped = once(child, 'exit'); child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
    for (let i = 0; i < 100; i++) { try { if ((await call('/health', { headers })).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
    throw Error('Synthetic worker startup failed');
  }
  async function stop() { if (child) { child.kill(); await stopped; child = null; } }
  try {
    await start();
    const bindingsPath='/finances/register-bindings';
    assert.equal((await call(bindingsPath)).status,401);
    assert.equal((await call(bindingsPath,{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
    const bindings=await call(bindingsPath,{headers});assert.equal(bindings.status,200);
    assert.deepEqual(await bindings.json(),{capability:'finance-register-bindings-v1',ledgerRevision:original.revision,bindings:{accounts:{},transactions:{}},unavailableArchiveCount:0});
    assert.equal((await call(bindingsPath,{method:'POST',headers,body:'{}'})).status,404);
    assert.equal(await readFile(canonicalPath,'utf8'),before);
    assert((await (await call('/health', { headers })).json()).capabilities.includes(capability));
    for (const method of ['GET', 'POST']) {
      const denied = await call(url, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal(denied.status, 401); assert.doesNotMatch(await denied.text(), /Carte fictive|12345|snapshot/);
      assert.equal((await call(url, { method, headers: { ...headers, Origin: 'https://untrusted.invalid' }, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 403);
    }
    assert.equal((await call(url, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'POST' } })).status, 204);
    const response = await call(url, { headers }); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await response.json(), { capability, state: { revision: 'empty', snapshots: [] } });
    const snapshot = currentExpenseFixture(), input = { capability, expectedRevision: 'empty', snapshot, apply: false };
    const preview = await (await post(input)).json(); assert.equal(preview.applied, false); assert.equal(preview.state, null); assert.equal(preview.snapshot.coverage.sourceAsOf, null);
    assert(!(await readdir(dir)).includes('finance'), 'Read and preview never create the expenses file');
    assert.equal((await post({ ...input, capability: 'unsupported', apply: true })).status, 400);
    assert.equal((await post({ ...input, extraSecret: 'fictional-secret' })).status, 400);
    assert.equal((await post({ ...input, expectedRevision: 'a'.repeat(64), apply: true })).status, 409);
    const invalid = structuredClone(input); invalid.snapshot.accounts[0].canonicalId = 'bank';
    assert.equal((await post(invalid)).status, 400);
    for (const sourceAsOf of [42, {}, undefined]) { const malformed = structuredClone(input); malformed.snapshot.coverage.sourceAsOf = sourceAsOf; const rejected = await post(malformed); assert.equal(rejected.status, 400); assert.doesNotMatch(await rejected.text(), /TypeError|length|stack|undefined/); }
    const future = structuredClone(input); future.snapshot.collectedAt = new Date(Date.now() + 3600_000).toISOString(); assert.equal((await post(future)).status, 400);
    const huge = await call(url, { method: 'POST', headers, body: JSON.stringify({ padding: 'x'.repeat(SOURCE_EXPENSES_LIMITS.bytes + 2_000) }) }); assert.equal(huge.status, 400); assert.doesNotMatch(await huge.text(), /xxxx/);
    const appliedResponse = await post({ ...input, apply: true }); assert.equal(appliedResponse.status, 200);
    const applied = await appliedResponse.json(); assert.equal(applied.applied, true); assert.equal(applied.state.revision, preview.proposedRevision);
    assert.deepEqual(applied.state.snapshots[0], preview.snapshot); assert.equal(applied.alreadyImported, false);
    const bytes = await readFile(join(dir, 'finance', 'source-expenses.json'), 'utf8'); assert.doesNotMatch(bytes, /fictional-item|fictional-card|canonicalId|access_token/);
    assert.equal((await post({ ...input, apply: true })).status, 409, 'A stale revision cannot overwrite newer expenses');
    const replay = await (await post({ ...input, apply: true, expectedRevision: applied.state.revision })).json(); assert.equal(replay.alreadyImported, true); assert.deepEqual(replay.state, applied.state);
    assert.equal(await readFile(join(dir, 'finance', 'source-expenses.json'), 'utf8'), bytes);
    await stop(); await start();
    assert.deepEqual((await (await call(url, { headers })).json()).state, applied.state);
    assert.deepEqual(await (await call('/finances', { headers })).json(), original);
    assert.equal(await readFile(canonicalPath, 'utf8'), before); assert.equal(await readFile(join(dir, 'pairing-key.txt'), 'utf8'), key);
    assert.doesNotMatch(logs, /synthetic-expenses-pairing-key|Carte fictive|12345|fictional-secret/);
    await writeFile(join(dir, 'finance', 'source-expenses.json'), 'corrupt-synthetic');
    assert.equal((await call(url, { headers })).status, 400); assert.equal((await post({ ...input, apply: true })).status, 400);
    assert.equal(await readFile(join(dir, 'finance', 'source-expenses.json'), 'utf8'), 'corrupt-synthetic');
    assert.equal(await readFile(canonicalPath, 'utf8'), before);
  } finally { await stop(); assert(resolve(dir).startsWith(resolve(tmpdir()) + sep)); await rm(dir, { recursive: true, force: true }); }
});
