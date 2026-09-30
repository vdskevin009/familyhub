import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortalReconnect, portalReconnectStatus } from '../apps/worker/dist/portal-reconnect.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('reconnect is pollable, single-flight, sanitizes private paths and recovers after errors', async () => {
  let finish; let calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  assert.equal(startPortalReconnect('desjardins', async () => { calls++; return gate; }).state, 'running');
  assert.throws(() => startPortalReconnect('bluecross', async () => ({})), /already running/);
  await tick();
  assert.equal(calls, 1);
  assert.equal(portalReconnectStatus('desjardins').state, 'running');
  finish({ status: 'success', applied: false, complete: true, found: 2, snapshotPath: 'private-path', backup: 'private-backup' });
  await tick();
  const done = portalReconnectStatus('desjardins');
  assert.equal(done.state, 'success');
  assert.equal(done.result.applied, false);
  assert.equal(JSON.stringify(done).includes('private-'), false);
  done.result.found = 99;
  assert.equal(portalReconnectStatus('desjardins').result.found, 2);
  startPortalReconnect('bluecross', async () => { throw new Error('secret page content'); });
  await tick();
  assert.equal(portalReconnectStatus('bluecross').state, 'error');
  assert.equal(JSON.stringify(portalReconnectStatus('bluecross')).includes('secret'), false);
  startPortalReconnect('bluecross', async () => ({ status: 'login-required', loginRequired: true }));
  await tick();
  assert.equal(portalReconnectStatus('bluecross').state, 'login-required');
});

test('interactive previews cannot overlap either insurer and do not modify invoices', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-reconnect-'));
  process.env.FAMILYHUB_WORKER_DATA = dir;
  const { initializeInvoices, syncDesjardinsPortal, syncBlueCrossPortal } = await import('../apps/worker/dist/invoices.js');
  try {
    await initializeInvoices(true);
    const before = await readFile(join(dir, 'invoices.json')).catch(() => null);
    for (const [first, second] of [[syncDesjardinsPortal, syncBlueCrossPortal], [syncBlueCrossPortal, syncDesjardinsPortal]]) {
      let finish, entered;
      const gate = new Promise(resolve => { finish = resolve; });
      const ready = new Promise(resolve => { entered = resolve; });
      const pending = first(false, true, async interactive => { assert.equal(interactive, true); entered(); return gate; });
      await ready;
      await assert.rejects(second(false, true, async () => { throw new Error('must not launch'); }), /already running/);
      finish({ status: 'login-required' });
      assert.equal((await pending).status, 'login-required');
    }
    assert.deepEqual(await readFile(join(dir, 'invoices.json')).catch(() => null), before);
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
    await rm(dir, { recursive: true, force: true });
  }
});
