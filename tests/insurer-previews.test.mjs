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

test('scheduled collection reports saved new payments and pending changes separately', async () => {
  const { runPreviews } = await import('../scripts/insurer-previews.mjs');
  const request = async path => path === '/invoices' ? { busy: false } : path.endsWith('/reconnect') ? { state: 'idle' } : path.endsWith('/status') ? {
    state: 'up-to-date', latestResult: { complete: true, errors: 0, ambiguous: 0, autoImported: 1, pendingNew: 0, pendingChanged: 0 }
  } : {};
  const report = await runPreviews(request);
  assert.equal(report.success, true);
  assert.deepEqual(report.results.map(x => [x.outcome, x.savedNew, x.pending]), [['payments-saved', 1, 0], ['payments-saved', 1, 0]]);
  const pending = await runPreviews(async path => path === '/invoices' ? { busy: false } : path.endsWith('/reconnect') ? { state: 'idle' } : path.endsWith('/status') ? {
    state: 'idle', latestResult: { complete: true, errors: 0, ambiguous: 0, autoImported: 1, pendingNew: 0, pendingChanged: 1 }
  } : {});
  assert.equal(pending.success, false); assert.equal(pending.results[0].outcome, 'attention-required');
});

const { workerJsonRequest } = await import('../scripts/worker-json-request.mjs');
test('slow response headers remain within the explicit collection deadline and preserve the request',async()=>{let received;const server=createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{received={method:req.method,path:req.url,key:req.headers['x-familyhub-key'],body:JSON.parse(raw)};setTimeout(()=>res.end(JSON.stringify({complete:true})),60);});});try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));assert.deepEqual(await workerJsonRequest(server.address().port,'synthetic-key','/desjardins/sync',{apply:false},1000),{complete:true});assert.deepEqual(received,{method:'POST',path:'/desjardins/sync',key:'synthetic-key',body:{apply:false}});}finally{await new Promise(resolve=>server.close(resolve));}});
test('the explicit transport deadline stops an uncertain POST without replay or a second insurer',async()=>{const posts=[];const server=createServer((req,res)=>{req.resume();req.on('end',()=>{if(req.method==='POST'){posts.push(req.url);setTimeout(()=>res.end('{}'),250);return;}const value=req.url==='/invoices'?{busy:false}:{state:'idle'};res.end(JSON.stringify(value));});});try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const report=await runPreviews((path,body)=>workerJsonRequest(server.address().port,'synthetic-key',path,body,body?40:1000));assert.deepEqual(posts,['/bluecross/sync']);assert.equal(report.success,false);assert.equal(report.results[0].outcome,'request-failed-no-retry');assert.equal(JSON.stringify(report).includes('synthetic-key'),false);}finally{await new Promise(resolve=>server.close(resolve));}});
