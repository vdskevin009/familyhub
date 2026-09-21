import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { savePrivate, loadPrivate } from '../apps/worker/dist/private-store.js';
test('Windows DPAPI roundtrip keeps synthetic refresh credentials out of plaintext', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-dpapi-'));
  try {
    const path = join(dir, 'test.dpapi');
    const data = { refreshToken: 'SYNTHETIC-NOT-A-REAL-GOOGLE-TOKEN' };
    await savePrivate(path, data);
    assert.equal((await readFile(path, 'utf8')).includes(data.refreshToken), false);
    assert.deepEqual(await loadPrivate(path), data);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
