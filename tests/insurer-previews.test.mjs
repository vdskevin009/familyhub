import test from 'node:test';
import assert from 'node:assert/strict';
import { runPreviews } from '../scripts/insurer-previews.mjs';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

function fake({ busy = false, fail = false, attention = false } = {}) {
  const posts = [];
  let active = false;
  return { posts, request: async (path, body) => {
    if (body) {
      assert.equal(active, false, 'requests must be sequential');
      assert.deepEqual(body, { apply: false });
      active = true;
      await new Promise(resolve => setTimeout(resolve, 5));
      active = false;
      posts.push(path);
      if (fail) throw new Error('sensitive transport details');
      return {};
    }
    if (path === '/invoices') return { busy };
    if (path.endsWith('/reconnect')) return { state: 'idle' };
    return { state: attention && path.startsWith('/bluecross') ? 'login-required' : 'up-to-date', latestResult: { complete: !attention, errors: 0, ambiguous: 0 } };
  } };
}
test('previews run Blue Cross then Desjardins, with no apply', async () => {
  const f = fake();
  assert.equal((await runPreviews(f.request)).success, true);
  assert.deepEqual(f.posts, ['/bluecross/sync', '/desjardins/sync']);
});
test('busy worker prevents both collections', async () => {
  const f = fake({ busy: true });
  assert.equal((await runPreviews(f.request)).success, false);
  assert.deepEqual(f.posts, []);
});
test('uncertain timeout never retries or starts the second insurer; errors are sanitized', async () => {
  const f = fake({ fail: true });
  const result = await runPreviews(f.request);
  assert.deepEqual(f.posts, ['/bluecross/sync']);
  assert.equal(result.success, false);
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});
test('human attention keeps the result failed while allowing the other idle insurer', async () => {
  const f = fake({ attention: true });
  const result = await runPreviews(f.request);
  assert.equal(result.results[0].outcome, 'attention-required');
  assert.equal(result.success, false);
  assert.equal(f.posts.length, 2);
});

test('standalone runner authenticates, saves a safe report and leaves the ledger intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'familyhub-preview-'));
  const ledger = '{"synthetic":"protected"}';
  await writeFile(join(directory, 'pairing-key.txt'), 'synthetic-key');
  await writeFile(join(directory, 'invoices.json'), ledger);
  const posts = [];
  const server = createServer((request, response) => {
    if (request.headers['x-familyhub-key'] !== 'synthetic-key') { response.writeHead(401).end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.method === 'POST') posts.push({ path: request.url, body: JSON.parse(body) });
      const result = request.url === '/health' ? { version: '2.16.1' }
        : request.url === '/invoices' ? { busy: false }
        : request.url.endsWith('/status') ? { state: 'up-to-date', latestResult: { complete: true, errors: 0, ambiguous: 0 } }
        : { state: 'idle' };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result));
    });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { stdout } = await promisify(execFile)(process.execPath, ['scripts/insurer-previews.mjs'], {
      env: { ...process.env, FAMILYHUB_WORKER_DATA: directory, FAMILYHUB_WORKER_PORT: String(server.address().port) }
    });
    const report = JSON.parse(await readFile(join(directory, 'insurer-automation-status.json'), 'utf8'));
    assert.equal(report.success, true);
    assert.equal(stdout.includes('synthetic-key'), false);
    assert.deepEqual(posts, [{ path: '/bluecross/sync', body: { apply: false } }, { path: '/desjardins/sync', body: { apply: false } }]);
    assert.equal(await readFile(join(directory, 'invoices.json'), 'utf8'), ledger);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
