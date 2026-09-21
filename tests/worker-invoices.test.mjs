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
