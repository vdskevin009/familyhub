import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {readFinanceAccountHistory} from '../apps/worker/src/finance-account-history.ts';
import {validateFinanceAccountHistory} from '../apps/worker/src/finance-account-history-model.ts';
import {financeFixture} from './finance-fixture.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
async function temporary(fn){const dir=await mkdtemp(join(tmpdir(),'familyhub-account-history-synthetic-'));try{await fn(dir);}finally{assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}}
async function archive(dir,value){await mkdir(join(dir,'sources'),{recursive:true});const raw=JSON.stringify(value),hash=digest(raw);await writeFile(join(dir,'sources',hash+'.json'),raw);return {hash};}
test('historical version comes from one hash-verified dated archive, retaining signed values and excluding holdings and capture timestamps',async()=>temporary(async dir=>{
  const f=financeFixture();f.accounts[1].observedBalanceCents=-5000;const imported=await archive(dir,f),original=await readFile(join(dir,'sources',imported.hash+'.json'),'utf8');
  const history=await readFinanceAccountHistory(dir,[imported]);assert.equal(history.versions.length,1);const v=history.versions[0];assert.equal(v.sourceAsOf,'2026-10-09');assert.equal(v.collectedAt,null);assert.equal(v.convention,'recorded-signed-unverified');assert.equal(v.coverage,'complete-recorded-scope');assert.equal(v.sourceSha256,imported.hash);assert.equal(v.accounts.length,4);assert.equal(v.accounts.find(a=>a.kind==='credit-card').balanceCents,-5000);assert(v.accounts.every(a=>/^fhi_/.test(a.sourceKey)));assert.equal(v.accounts.find(a=>a.kind==='credit-card').canonicalAccountId,'card');assert.equal(v.accounts.reduce((sum,a)=>sum+a.balanceCents,0),1495000);
  assert.doesNotMatch(JSON.stringify(history),/identityEvidence|sourceRowId|matchingFingerprint|C:\/synthetic|holdingsSnapshots|observedOn|accountId/);
  await writeFile(join(dir,'ledger.json'),JSON.stringify({accounts:[{balanceCents:999999999}]}));assert.deepEqual(await readFinanceAccountHistory(dir,[imported]),history);assert.equal(await readFile(join(dir,'sources',imported.hash+'.json'),'utf8'),original);
}));
test('archive versions never union dates, mix scopes, promote observedOn fallback, or repeat account snapshots from observation-only intake',async()=>temporary(async dir=>{
  const f=financeFixture();f.accounts[0].observedOn='2026-10-08';delete f.accounts[1].observedOn;f.accounts[2].observedBalanceCents=null;
  const first=await archive(dir,f),result=await readFinanceAccountHistory(dir,[first]);assert.equal(result.versions.length,2);assert(result.versions.every(v=>v.coverage==='partial-recorded-scope'));assert.equal(result.versions.reduce((n,v)=>n+v.accounts.length,0),3);assert.equal(result.versions[1].accounts.find(a=>a.kind==='brokerage').balanceCents,null);
  const observations=structuredClone(f);observations.importMode='balance-observations-only';assert.deepEqual(await readFinanceAccountHistory(dir,[await archive(dir,observations)]),{capability:'finance-account-history-v1',versions:[],unavailableArchiveCount:0});
  const partial=financeFixture();partial.pluginEvidence={schema:'synthetic'};assert.equal((await readFinanceAccountHistory(dir,[await archive(dir,partial)])).versions[0].coverage,'partial-recorded-scope');
}));
test('identical dated account projections deduplicate without combining sources or losing first immutable provenance',async()=>temporary(async dir=>{
  const a=financeFixture(),first=await archive(dir,a),b=structuredClone(a);b.syntheticArchiveNote='different transaction-only archive';const second=await archive(dir,b);
  const result=await readFinanceAccountHistory(dir,[first,second,first]);assert.equal(result.versions.length,1);assert.equal(result.versions[0].sourceSha256,first.hash);
}));
test('missing/corrupt/hash-mismatch/invalid-date/duplicate identity archives expose only availability counts',async()=>temporary(async dir=>{
  const good=await archive(dir,financeFixture()),missing={hash:'f'.repeat(64)},corrupt={hash:'e'.repeat(64)};await writeFile(join(dir,'sources',corrupt.hash+'.json'),'private-synthetic-corrupt');
  const badDate=financeFixture();badDate.accounts[0].observedOn='2026-02-30';const dup=financeFixture();dup.accounts[0].identityFingerprint='same';dup.accounts[1].identityFingerprint='same';
  const brokenRaw='{not JSON}',broken={hash:digest(brokenRaw)};await writeFile(join(dir,'sources',broken.hash+'.json'),brokenRaw);
  const result=await readFinanceAccountHistory(dir,[good,missing,corrupt,await archive(dir,badDate),await archive(dir,dup),broken,{hash:'../../outside'}]);assert.equal(result.versions.length,1);assert.equal(result.unavailableArchiveCount,6);assert.doesNotMatch(JSON.stringify(result),/outside|private-synthetic|sources|C:\\/);
  const noValid=await readFinanceAccountHistory(dir,[missing]);assert.equal(noValid.versions.length,0);assert.equal(noValid.unavailableArchiveCount,1);
}));
test('sources directory junction cannot escape the expected archive directory',async()=>temporary(async dir=>{
  const external=join(dir,'outside'),finance=join(dir,'finances');await mkdir(external);await mkdir(finance);const f=financeFixture(),raw=JSON.stringify(f),hash=digest(raw);await writeFile(join(external,hash+'.json'),raw);await symlink(external,join(finance,'sources'),'junction');
  const result=await readFinanceAccountHistory(finance,[{hash}]);assert.equal(result.versions.length,0);assert.equal(result.unavailableArchiveCount,1);assert.equal(await readFile(join(external,hash+'.json'),'utf8'),raw);
}));
test('strict response model excludes raw source metadata, unknown values and forged received times',async()=>temporary(async dir=>{
  const history=await readFinanceAccountHistory(dir,[await archive(dir,financeFixture())]);for(const change of [h=>h.secret='x',h=>h.versions[0].collectedAt='2026-10-09T00:00:00Z',h=>h.versions[0].accounts[0].account_id='private',h=>h.versions[0].accounts[0].balanceCents=1.5,h=>h.versions[0].sourceSha256='bad',h=>h.versions[0].sourceAsOf='2026-02-30']){const h=structuredClone(history);change(h);assert.throws(()=>validateFinanceAccountHistory(h));}
}));

test('genuine source timestamps keep precision/timezone and do not discard day-dated peers',async()=>temporary(async dir=>{
  const f=financeFixture();f.accounts[0].observedOn='2026-10-09T11:23:45-04:00';const result=await readFinanceAccountHistory(dir,[await archive(dir,f)]);assert.equal(result.unavailableArchiveCount,0);assert.equal(result.versions.length,2);assert(result.versions.some(v=>v.sourceAsOf==='2026-10-09T11:23:45-04:00'&&v.accounts.length===1));assert(result.versions.some(v=>v.sourceAsOf==='2026-10-09'&&v.accounts.length===3));assert(result.versions.every(v=>v.collectedAt===null&&v.coverage==='partial-recorded-scope'));
}));

test('historical source precision preserves six and nine fractional digits supported by the original adapter',async()=>temporary(async dir=>{
  const f=financeFixture();f.accounts[0].observedOn='2026-10-09T11:23:45.123456Z';f.accounts[1].observedOn='2026-10-09T11:23:45.123456789-04:00';const result=await readFinanceAccountHistory(dir,[await archive(dir,f)]);assert.equal(result.unavailableArchiveCount,0);assert(result.versions.some(v=>v.sourceAsOf===f.accounts[0].observedOn));assert(result.versions.some(v=>v.sourceAsOf===f.accounts[1].observedOn));assert.equal(result.versions.length,3);
}));
