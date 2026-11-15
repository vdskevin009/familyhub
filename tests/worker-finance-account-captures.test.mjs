import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {FinanceLibrary} from '../apps/worker/dist/finance-library.js';
import {ACCOUNT_CAPTURES_CAPABILITY as capability,ACCOUNT_CAPTURES_LIMITS} from '../apps/worker/dist/finance-account-captures-model.js';
import {financeFixture} from './finance-fixture.mjs';
import {accountCaptureFixture} from './finance-account-captures-fixture.mjs';
import {inventoryFixture} from './finance-source-inventory-fixture.mjs';
test('paired capture API enforces privacy, immutable migration/backfill, revisions, bounds and restart without canonical mutation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'familyhub-capture-api-synthetic-')),key='synthetic-capture-pairing-key';
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  await writeFile(join(dir,'pairing-key.txt'),key);const library=new FinanceLibrary(join(dir,'finances'));
  const original=(await library.import({bundle:financeFixture(),apply:true,expectedRevision:'empty'})).state;
  const canonicalPath=join(dir,'finances','ledger.json'),before=await readFile(canonicalPath,'utf8');
  const headers={'x-familyhub-key':key,Origin:'https://vdskevin009.github.io','Content-Type':'application/json'},url='/finance/account-captures';let child,stopped,logs='';
  const call=(path=url,init={})=>fetch('http://127.0.0.1:'+port+path,init),post=body=>call(url,{method:'POST',headers,body:JSON.stringify(body)});
  async function start(){child=spawn(process.execPath,['apps/worker/dist/index.js'],{env:{...process.env,FAMILYHUB_WORKER_DATA:dir,FAMILYHUB_WORKER_HOST:'127.0.0.1',FAMILYHUB_WORKER_PORT:String(port),FAMILYHUB_ALLOWED_ORIGINS:headers.Origin},stdio:['ignore','pipe','pipe'],windowsHide:true});stopped=once(child,'exit');child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);for(let i=0;i<100;i++){try{if((await call('/health',{headers})).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Synthetic worker startup failed');}
  async function stop(){if(child){child.kill();await stopped;child=null;}}
  try{
    await start();assert((await(await call('/health',{headers})).json()).capabilities.includes(capability));
    for(const method of ['GET','POST']){const denied=await call(url,{method,...(method==='POST'?{body:'{}'}:{})});assert.equal(denied.status,401);assert.doesNotMatch(await denied.text(),/Compte fictif|captures|12000/);assert.equal((await call(url,{method,headers:{...headers,Origin:'https://untrusted.invalid'},...(method==='POST'?{body:'{}'}:{})})).status,403);}
    for(const method of ["GET","POST"]){assert.equal((await call("/finance/account-history",{method,...(method==="POST"?{body:"{}"}:{})})).status,401);assert.equal((await call("/finance/account-history",{method,headers:{...headers,Origin:"https://untrusted.invalid"},...(method==="POST"?{body:"{}"}:{})})).status,403);}
    const historyResponse=await call("/finance/account-history",{headers});assert.equal(historyResponse.headers.get("cache-control"),"no-store");const history=await historyResponse.json();assert.equal(history.capability,"finance-account-history-v1");assert.equal(history.versions.length,1);assert.equal(history.versions[0].collectedAt,null);assert.equal(history.versions[0].sourceAsOf,"2026-10-09");assert(history.versions[0].accounts.every(a=>/^fhi_/.test(a.sourceKey)));
    const read=await call(url,{headers});assert.equal(read.headers.get('cache-control'),'no-store');assert.equal(read.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(await read.json(),{capability,state:{revision:'empty',captures:[]}});
    const snapshot=accountCaptureFixture('2020-05-01T10:00:00.000Z'),input={capability,snapshot,expectedRevision:'empty',apply:false};
    const preview=await(await post(input)).json();assert.equal(preview.applied,false);assert.equal(preview.state,null);assert(!(await readdir(dir)).includes('finance'));
    for(const body of [{...input,capability:'wrong'},{...input,secret:'fictional-secret'},{...input,apply:null}])assert.equal((await post(body)).status,400);
    assert.equal((await post({...input,expectedRevision:'a'.repeat(64),apply:true})).status,409);
    const raw=structuredClone(input);raw.snapshot.accounts[0].item_id='synthetic-raw-secret';assert.equal((await post(raw)).status,400);
    const future=structuredClone(input);future.snapshot.collectedAt=new Date(Date.now()+3600000).toISOString();assert.equal((await post(future)).status,400);
    const huge=await call(url,{method:'POST',headers,body:JSON.stringify({padding:'x'.repeat(ACCOUNT_CAPTURES_LIMITS.bytes+2000)})});assert.equal(huge.status,400);assert.doesNotMatch(await huge.text(),/xxxxx/);
    const appliedResponse=await post({...input,apply:true});assert.equal(appliedResponse.status,200);const first=await appliedResponse.json();assert.equal(first.state.revision,preview.proposedRevision);assert.equal(first.state.captures.length,1);
    const path=join(dir,'finance','account-captures.json'),firstBytes=await readFile(path,'utf8');assert.doesNotMatch(firstBytes,/synthetic-item|synthetic-account|canonicalAccountId|access_token/);
    assert.equal((await post({...input,apply:true})).status,409);const replay=await(await post({...input,apply:true,expectedRevision:first.state.revision})).json();assert(replay.alreadyImported);assert.equal(await readFile(path,'utf8'),firstBytes);
    const older=accountCaptureFixture('2020-04-01T10:00:00.000Z'),second=await(await post({...input,snapshot:older,apply:true,expectedRevision:first.state.revision})).json();assert.equal(second.state.captures.length,2);assert.equal(second.state.captures.at(-1).id,first.capture.id);
    const divergent=structuredClone(snapshot);divergent.accounts[0].name='Divergent';assert.equal((await post({...input,snapshot:divergent,apply:true,expectedRevision:second.state.revision})).status,409);
    const legacy=inventoryFixture();legacy.collectedAt='2020-05-01T10:05:00.000Z';legacy.accounts[0].credit=null;
    let legacyReply=await(await call('/finance/source-inventory',{method:'POST',headers,body:JSON.stringify({capability:'finance-source-inventory-v1',snapshot:legacy,expectedRevision:'empty',apply:true})})).json();assert(legacyReply.applied);
    const legacy2=structuredClone(legacy);legacy2.collectedAt='2020-05-02T10:05:00.000Z';legacyReply=await(await call('/finance/source-inventory',{method:'POST',headers,body:JSON.stringify({capability:'finance-source-inventory-v1',snapshot:legacy2,expectedRevision:legacyReply.state.revision,apply:true})})).json();assert(legacyReply.applied);
    const withLegacy=(await(await call(url,{headers})).json()).state;assert.equal(withLegacy.captures.length,4);assert.equal(withLegacy.captures.filter(c=>c.origin==='legacy-inventory').length,2);
    await stop();await start();assert.deepEqual((await(await call(url,{headers})).json()).state,withLegacy);assert.deepEqual(await(await call('/finances',{headers})).json(),original);assert.equal(await readFile(canonicalPath,'utf8'),before);assert.equal(await readFile(join(dir,'pairing-key.txt'),'utf8'),key);
    assert.doesNotMatch(logs,/synthetic-capture-pairing-key|Compte fictif|12000|fictional-secret|synthetic-raw-secret/);
    await writeFile(path,'corrupt-synthetic');assert.equal((await call(url,{headers})).status,400);assert.equal((await post({...input,apply:true})).status,400);assert.equal(await readFile(path,'utf8'),'corrupt-synthetic');assert.equal(await readFile(canonicalPath,'utf8'),before);
  }finally{await stop();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}
});
