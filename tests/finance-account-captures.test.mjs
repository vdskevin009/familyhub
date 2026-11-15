import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {validateFinanceAccountCaptureSnapshot as validate,validateFinanceAccountCapturesState,plaidCurrentNet,summarizeFinanceAccountCapture,ACCOUNT_CAPTURES_LIMITS} from '../apps/worker/src/finance-account-captures-model.ts';
import {FinanceAccountCapturesStore,AccountCapturesConflict} from '../apps/worker/src/finance-account-captures-store.ts';
import {FinanceSourceInventoryStore} from '../apps/worker/src/finance-source-inventory-store.ts';
import {prepareFinanceAccountCapture} from '../apps/worker/src/finance-account-captures-prepare.ts';
import {importFinanceAccountCapture} from '../apps/worker/src/finance-account-captures-api.ts';
import {accountCaptureFixture,captureNow} from './finance-account-captures-fixture.mjs';
import {inventoryFixture} from './finance-source-inventory-fixture.mjs';
const valid=value=>validate(value,captureNow);
async function temporary(fn){const dir=await mkdtemp(join(tmpdir(),'familyhub-capture-synthetic-'));try{await fn(dir);}finally{assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}}
test('Plaid convention preserves raw balances, credit refunds, overdrafts, loans, unknown and exact currency totals',()=>{
  const s=valid(accountCaptureFixture()),cad=summarizeFinanceAccountCapture(s).currencies.find(x=>x.currency==='CAD');
  assert.equal(cad.netAmountCents,-12000+3000+0+10003+10004+10005+10006+10007);assert(cad.complete);assert.equal(cad.includedAccountCount,8);
  const card=s.accounts.find(a=>a.name==='Compte fictif 1');assert.equal(card.balance.amountCents,-3000);assert.equal(card.netBalance.amountCents,3000);
  const account={...card,kind:'depository',balance:{...card.balance,amountCents:-200}};assert.equal(plaidCurrentNet(account).amountCents,-200);
  assert.equal(plaidCurrentNet({...account,kind:'loan'}).amountCents,200);assert.equal(plaidCurrentNet({...account,provider:'unknown'}),null);assert.equal(plaidCurrentNet({...account,kind:'other'}),null);
  const missing=structuredClone(s);missing.accounts[0].balance=null;missing.accounts[0].netBalance=null;const result=summarizeFinanceAccountCapture(valid(missing));assert.equal(result.unknownCurrencyAccountCount,1);assert(result.currencies.every(x=>!x.complete));
  const legacy=structuredClone(s);legacy.accounts.forEach(a=>{a.provider='unknown';a.netBalance=null;});assert(summarizeFinanceAccountCapture(valid(legacy)).currencies.every(x=>x.netAmountCents===null));
});
test('strict capture allowlists, genuine dates, size, counts and derived sign evidence fail closed',()=>{
  for(const change of [s=>s.secret='fictional-secret',s=>s.accounts[0].account_id='raw-id',s=>s.accounts[0].canonicalAccountId='canonical',s=>s.accounts[0].provider='guessed',s=>s.accounts[0].netBalance.amountCents+=1,s=>s.accounts[0].netBalance.basis='guess',s=>s.accounts[0].provider='unknown',s=>s.accounts[0].balance.currency='???',s=>s.accounts[0].balance.amountCents=0.1,s=>s.accounts.push(s.accounts[0]),s=>s.sourceAccountCount=8,s=>s.sourceSha256='not-hash',s=>s.sourceSha256=null,s=>s.collectedAt='2030-02-30T10:00:00.000Z',s=>s.collectedAt='2031-01-01T00:00:00Z',s=>s.accounts[0].balance.sourceAsOf='2030-05-02']){const s=accountCaptureFixture();change(s);assert.throws(()=>valid(s));}
  const zero=accountCaptureFixture();zero.accounts=[];zero.sourceAccountCount=0;assert.throws(()=>valid(zero));
  const futureDue=accountCaptureFixture();futureDue.accounts[0].credit={statementBalance:null,minimumPayment:null,paymentDueOn:'2031-01-01'};assert(valid(futureDue));
});
test('exact all-source preparer includes mapped and unmapped source keys once without canonical inference',()=>{
  const s=accountCaptureFixture(),i=inventoryFixture();i.collectedAt=s.collectedAt;i.accounts=s.accounts.map(({provider,netBalance,...a})=>({...a,reconciliation:'not-reconciled'}));i.predictions=[];i.availability.accounts={status:'available',coverage:'complete',observedCount:9};i.availability.recurring={status:'unavailable',coverage:'unknown',observedCount:0};
  const options={expectedSourceKeys:s.accounts.map(a=>a.sourceKey),providerBySourceKey:Object.fromEntries(s.accounts.map(a=>[a.sourceKey,a.provider])),sourceSha256:s.sourceSha256,manualAccountCount:0};
  assert.equal(prepareFinanceAccountCapture(i,options,captureNow).accounts.length,9);
  assert.throws(()=>prepareFinanceAccountCapture(i,{...options,expectedSourceKeys:options.expectedSourceKeys.slice(2)},captureNow));
  assert.throws(()=>prepareFinanceAccountCapture(i,{...options,providerBySourceKey:{}},captureNow));
  assert.throws(()=>prepareFinanceAccountCapture(i,{...options,manualAccountCount:1},captureNow));
  assert.throws(()=>prepareFinanceAccountCapture(i,{...options,manualAccountCount:undefined},captureNow));
  const newProvider=prepareFinanceAccountCapture(i,{...options,providerBySourceKey:{...options.providerBySourceKey,[options.expectedSourceKeys[0]]:'unknown'}},captureNow);assert.equal(newProvider.accounts.find(a=>a.sourceKey===options.expectedSourceKeys[0]).netBalance,null);assert.equal(summarizeFinanceAccountCapture(newProvider).currencies.find(c=>c.currency==='CAD').complete,false);
  i.availability.accounts={status:'partial',coverage:'partial',observedCount:9};assert.throws(()=>prepareFinanceAccountCapture(i,options,captureNow));
});
test('read and preview do not write; append, historical backfill, replay, revision and explicit correction preserve every version',async()=>temporary(async dir=>{
  const store=new FinanceAccountCapturesStore(dir),s=accountCaptureFixture();assert.deepEqual(await store.read(captureNow),{revision:'empty',captures:[]});
  const preview=await store.preview(s,'empty',captureNow);assert.equal((await readdir(dir)).length,0);
  const first=await store.save(s,'empty',captureNow);assert.equal(first.revision,preview.proposedRevision);const firstRow=JSON.stringify(first.captures[0]);
  const reversed=structuredClone(s);reversed.accounts.reverse();assert((await store.preview(reversed,first.revision,captureNow)).alreadyImported);assert.deepEqual(await store.save(reversed,first.revision,captureNow),first);
  await assert.rejects(store.save(s,'empty',captureNow),AccountCapturesConflict);
  const past=accountCaptureFixture('2030-04-01T10:00:00.000Z');const second=await store.save(past,first.revision,captureNow);assert.equal(second.captures.length,2);assert.equal(JSON.stringify(second.captures.find(c=>c.id===first.captures[0].id)),firstRow);
  const changed=structuredClone(s);changed.accounts[0].balance.amountCents+=100;changed.accounts[0].netBalance=plaidCurrentNet(changed.accounts[0]);await assert.rejects(store.save(changed,second.revision,captureNow),AccountCapturesConflict);
  changed.supersedesCaptureId=first.captures[0].id;const third=await store.save(changed,second.revision,captureNow);assert.equal(third.captures.length,3);assert.equal(JSON.stringify(third.captures.find(c=>c.id===first.captures[0].id)),firstRow);
  const fork=structuredClone(changed);fork.sourceSha256='b'.repeat(64);await assert.rejects(store.save(fork,third.revision,captureNow),AccountCapturesConflict);
  const replay=await store.preview(past,third.revision,captureNow);assert(replay.alreadyImported);assert.equal(replay.proposedRevision,third.revision);
  assert.deepEqual(await new FinanceAccountCapturesStore(dir).read(captureNow),third);
}));
test('legacy projection is partial, has no net convention and is archived without touching original inventory or canonical files',async()=>temporary(async dir=>{
  const captureStore=new FinanceAccountCapturesStore(dir),legacy=new FinanceSourceInventoryStore(dir,(previous,incoming,now,commit)=>captureStore.withLegacyReplacement(previous,incoming,now,commit));
  const source=inventoryFixture();source.collectedAt='2030-05-01T10:04:00.000Z';await legacy.save(source,'empty',captureNow);
  const legacyPath=join(dir,'finance','source-inventory.json'),before=await readFile(legacyPath,'utf8'),initial=await captureStore.read(captureNow);assert.equal(initial.captures.length,1);assert.equal(initial.captures[0].origin,'legacy-inventory');assert.equal(initial.captures[0].snapshot.coverage,'partial');assert.equal(initial.captures[0].snapshot.accounts[0].netBalance,null);
  assert.deepEqual((await readdir(join(dir,'finance'))).sort(),['source-inventory.json']);
  const state=await captureStore.save(accountCaptureFixture(),initial.revision,captureNow);assert.equal(state.captures.length,2);assert.equal(await readFile(legacyPath,'utf8'),before);assert.equal(state.captures.find(c=>c.origin==='source-capture').snapshot.collectedAt,'2030-05-01T10:00:00.000Z');
  const next=structuredClone(source);next.collectedAt='2030-05-02T10:04:00.000Z';await legacy.save(next,(await legacy.read(captureNow)).revision,captureNow);
  const latest=await captureStore.read(captureNow);assert.equal(latest.captures.length,3);assert(latest.captures.some(c=>c.id===initial.captures[0].id));assert(!(await readdir(dir)).includes('finances'));
}));
test('legacy-only successive replacements preserve every original even before the first new capture',async()=>temporary(async dir=>{
  const store=new FinanceAccountCapturesStore(dir),legacy=new FinanceSourceInventoryStore(dir,(previous,incoming,now,commit)=>store.withLegacyReplacement(previous,incoming,now,commit));
  let revision='empty';for(let day=1;day<=3;day++){const s=inventoryFixture();s.collectedAt='2030-05-0'+day+'T10:04:00.000Z';revision=(await legacy.save(s,revision,captureNow)).revision;}
  assert.equal((await store.read(captureNow)).captures.length,3);
}));
test('concurrent writes serialize revisions, clones survive caller mutation, corrupt/oversized files are preserved',async()=>temporary(async dir=>{
  const store=new FinanceAccountCapturesStore(dir),a=accountCaptureFixture(),b=accountCaptureFixture('2030-05-02T10:00:00.000Z');const first=store.save(a,'empty',captureNow);a.accounts=[];const second=store.save(b,'empty',captureNow);const settled=await Promise.allSettled([first,second]);assert.equal(settled[0].status,'fulfilled');assert.equal(settled[1].status,'rejected');assert.equal((await store.read(captureNow)).captures[0].snapshot.accounts.length,9);
  const path=join(dir,'finance','account-captures.json');for(const bytes of ['bad-synthetic','x'.repeat(ACCOUNT_CAPTURES_LIMITS.historyBytes+1)]){await writeFile(path,bytes);await assert.rejects(store.read(captureNow));await assert.rejects(store.save(b,'empty',captureNow));assert.equal(await readFile(path,'utf8'),bytes);}
}));
test('snapshot/state identifiers and correction cycles/tampering cannot be smuggled',async()=>temporary(async dir=>{
  const store=new FinanceAccountCapturesStore(dir),state=await store.save(accountCaptureFixture(),'empty',captureNow),path=join(dir,'finance','account-captures.json');
  const tampered=structuredClone(state);tampered.captures[0].snapshot.accounts[0].name='Edited';await writeFile(path,JSON.stringify(tampered));await assert.rejects(store.read(captureNow));
  const duplicate=structuredClone(state);duplicate.captures.push(duplicate.captures[0]);assert.throws(()=>validateFinanceAccountCapturesState(duplicate,captureNow));
  const cycle=structuredClone(state);cycle.captures[0].snapshot.supersedesCaptureId=cycle.captures[0].id;assert.throws(()=>validateFinanceAccountCapturesState(cycle,captureNow));
}));
test('capture API service requires explicit capability/apply/revision and previews without mutation',async()=>temporary(async dir=>{
  const store=new FinanceAccountCapturesStore(dir),input={capability:'finance-account-captures-v1',snapshot:accountCaptureFixture(),expectedRevision:'empty',apply:false};
  for(const value of [{...input,capability:'old'},{...input,apply:undefined},{...input,expectedRevision:'bad'},{...input,secret:'fictional'}])await assert.rejects(importFinanceAccountCapture(store,value,captureNow));
  const preview=await importFinanceAccountCapture(store,input,captureNow);assert.equal(preview.applied,false);assert.equal(preview.state,null);assert.equal((await readdir(dir)).length,0);
  const applied=await importFinanceAccountCapture(store,{...input,apply:true},captureNow);assert.equal(applied.proposedRevision,preview.proposedRevision);assert.equal(applied.state.captures.length,1);
}));

test('safe arithmetic refuses overflows even for an unvalidated typed caller',()=>{
  const s=accountCaptureFixture();for(const a of s.accounts){a.balance.currency='CAD';a.netBalance.currency='CAD';a.netBalance.amountCents=Number.MAX_SAFE_INTEGER;}
  const result=summarizeFinanceAccountCapture(s).currencies[0];assert.equal(result.netAmountCents,null);assert.equal(result.arithmeticUnavailable,true);assert.equal(result.complete,false);
});

test('retention saturation refuses without deleting any prior version',async()=>temporary(async dir=>{
  const {createHash}=await import('node:crypto');const {mkdir}=await import('node:fs/promises');const {accountCaptureId}=await import('../apps/worker/src/finance-account-captures-store.ts');
  const captures=Array.from({length:ACCOUNT_CAPTURES_LIMITS.captures},(_,i)=>{const snapshot=valid(accountCaptureFixture(new Date(Date.parse('2020-01-01T10:00:00Z')+i*86400000).toISOString()));return {id:accountCaptureId('source-capture',snapshot),origin:'source-capture',snapshot};});
  const state={revision:createHash('sha256').update(JSON.stringify(captures)).digest('hex'),captures};await mkdir(join(dir,'finance'));const path=join(dir,'finance','account-captures.json'),bytes=JSON.stringify(state);await writeFile(path,bytes);
  const store=new FinanceAccountCapturesStore(dir);assert.equal((await store.read(captureNow)).captures.length,ACCOUNT_CAPTURES_LIMITS.captures);await assert.rejects(store.save(accountCaptureFixture(),state.revision,captureNow));assert.equal(await readFile(path,'utf8'),bytes);
  const legacy=new FinanceSourceInventoryStore(dir,(previous,incoming,now,commit)=>store.withLegacyReplacement(previous,incoming,now,commit));await assert.rejects(legacy.save(inventoryFixture(),'empty',captureNow));assert.deepEqual(await legacy.read(captureNow),{revision:'empty',snapshot:null});assert.equal((await store.read(captureNow)).captures.length,ACCOUNT_CAPTURES_LIMITS.captures);
}));

test('GET waits for an in-flight legacy replacement so preserved versions cannot disappear',async()=>temporary(async dir=>{
  const store=new FinanceAccountCapturesStore(dir),legacy=new FinanceSourceInventoryStore(dir);const old=inventoryFixture();old.collectedAt='2030-05-01T12:00:00.000Z';const state=await legacy.save(old,'empty',captureNow);const incoming=structuredClone(old);incoming.collectedAt='2030-05-02T12:00:00.000Z';
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const replace=store.withLegacyReplacement(old,incoming,captureNow,async()=>{entered();await gate;return legacy.save(incoming,state.revision,captureNow);});await started;
  let returned=false;const reading=store.read(captureNow).then(value=>{returned=true;return value;});await new Promise(r=>setTimeout(r,25));assert.equal(returned,false);release();await replace;const result=await reading;assert.equal(result.captures.length,2);assert(result.captures.some(c=>c.snapshot.collectedAt===old.collectedAt));assert(result.captures.some(c=>c.snapshot.collectedAt===incoming.collectedAt));
}));
