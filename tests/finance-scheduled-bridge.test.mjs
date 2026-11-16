import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beginScheduledFinance,assertScheduledAdmission,finalizeScheduledFinance,journalScheduledIntent,abandonUnstartedReservation} from '../apps/worker/src/finance-scheduled-bridge.ts';
import {dailyFinanceDigest,financeStages} from '../apps/worker/src/finance-daily-gate.ts';
async function setup(){const directory=await mkdtemp(join(tmpdir(),'bridge-synthetic-'));const scope={schema:1,periods:[{from:'2025-01-01',through:'2025-12-31'}],subjects:Object.fromEntries(financeStages.map(s=>[s,[s]]))};let now=new Date('2025-01-10T16:00:00Z');let loads=0;const input=()=>({directory,scope,now});const b=()=>beginScheduledFinance(input());const load=async()=>{loads++;return {verifyReceiptReadOnly:async()=>true,verifyOutcomeReadOnly:async()=>true}};const finish=(a,r,l=load)=>finalizeScheduledFinance({directory,scope,clock:()=>now},a,r,l);return {directory,scope,input,b,finish,loads:()=>loads,time:t=>now=new Date(t),report:a=>({writeOutcome:'confirmed',receipts:financeStages.map(stage=>{const payload={schema:1,stage,attemptId:a.attempt.id,localDate:a.attempt.localDate,scopeDigest:a.scopeDigest,status:'confirmed',confirmedSubjectIds:[stage],evidenceDigests:['a'.repeat(64)],withheldCount:0,uncertainWrite:false,sourceFreshness:'unknown',sourceAsOf:null};return {payload,digest:dailyFinanceDigest(payload)}})})}}
test('two phase completes; response-loss replay and subsequent begin load no verifier',async()=>{const h=await setup(),b=await h.b(),r=h.report(b.admission);assert.equal(b.action,'collect');assert.equal((await h.finish(b.admission,r)).complete,true);assert.equal((await h.finish(b.admission,r,async()=>{throw Error('must not load')})).reason,'already-finalized-local');assert.equal((await h.b()).reason,'already-complete');assert.equal(h.loads(),1)});
test('cross-process lease blocks overlap; token tamper never removes rightful lease',async()=>{const h=await setup(),b=await h.b();assert.equal((await h.b()).reason,'locked-review-if-stale');const a={...b.admission,expiresAt:'2099-01-01T00:00:00Z'};await assert.rejects(h.finish(a,h.report(a)),/token mismatch/);await assertScheduledAdmission(h.input(),b.admission,'collect');assert.equal(h.loads(),0)});
test('expired crash lock is not stolen; operator-established cleanup admits recovery only',async()=>{const h=await setup(),b=await h.b();h.time('2025-01-10T17:00:00Z');await assert.rejects(h.finish(b.admission,h.report(b.admission)),/expired/);assert.equal(h.loads(),0);assert.equal((await h.b()).reason,'locked-review-if-stale');await unlink(join(h.directory,'finance-feed/daily-gate/lease.lock'));const recovery=await h.b();assert.equal(recovery.action,'recover');assert.equal(recovery.admission.attempt.id,b.admission.attempt.id);await assert.rejects(assertScheduledAdmission(h.input(),recovery.admission,'collect'),/readback only/);assert.equal((await h.finish(recovery.admission,h.report(recovery.admission))).complete,true)});
test('partial confirmed frees lease but does not retry before hour',async()=>{const h=await setup(),b=await h.b(),r=h.report(b.admission);r.receipts.pop();assert.equal((await h.finish(b.admission,r)).complete,false);assert.equal((await h.b()).reason,'retry-not-due');h.time('2025-01-10T17:00:00Z');assert.equal((await h.b()).action,'collect')});
test('uncertain outcome retains pending and lease; false independent proof cannot complete',async()=>{for(const uncertain of [true,false]){const h=await setup(),b=await h.b(),r=h.report(b.admission);if(uncertain)r.writeOutcome='uncertain';await assert.rejects(h.finish(b.admission,r,async()=>({verifyReceiptReadOnly:async()=>true,verifyOutcomeReadOnly:async()=>false})));assert.equal((await h.b()).reason,'locked-review-if-stale');assert.ok(JSON.parse(await readFile(join(h.directory,'finance-feed/daily-gate/state.json'))).pending)}});
test('window closure and changed scope block before loading verifier',async()=>{for(const drift of [true,false]){const h=await setup(),b=await h.b();if(drift)h.scope.subjects.accounts.push('new');else h.time('2025-01-11T05:00:00Z');await assert.rejects(h.finish(b.admission,h.report(b.admission)));assert.equal(h.loads(),0)}});
test('finalizer overlap does not duplicate verifier callbacks',async()=>{const h=await setup(),b=await h.b(),r=h.report(b.admission);let release;const wait=new Promise(resolve=>release=resolve);let entered;const started=new Promise(resolve=>entered=resolve);const first=h.finish(b.admission,r,async()=>{entered();await wait;return {verifyReceiptReadOnly:async()=>true,verifyOutcomeReadOnly:async()=>true}});await started;await assert.rejects(h.finish(b.admission,r),/EEXIST/);release();assert.equal((await first).complete,true)});

test('private intent is immutable, replay-safe and forbidden under recovery admission',async()=>{const h=await setup(),b=await h.b(),intent={operationId:'synthetic',kind:'private-intake',payloadDigest:'b'.repeat(64),expectedRevision:'synthetic-rev',readbackLocator:'synthetic-private-record'};const a=await journalScheduledIntent(h.input(),b.admission,intent);assert.deepEqual(await journalScheduledIntent(h.input(),b.admission,intent),a);await assert.rejects(journalScheduledIntent(h.input(),b.admission,{...intent,payloadDigest:'c'.repeat(64)}),/conflict/);h.time('2025-01-10T17:00:00Z');await unlink(join(h.directory,'finance-feed/daily-gate/lease.lock'));const r=await h.b();await assert.rejects(journalScheduledIntent(h.input(),r.admission,intent),/readback only/)});

test('artifact persisted before state commit accepts exact bytes but rejects conflicting content',async()=>{for(const conflict of [false,true]){const h=await setup(),b=await h.b(),report=h.report(b.admission);const artifact={schema:1,attempt:b.admission.attempt,report,verifiedAt:h.input().now.toISOString(),complete:true};const path=join(h.directory,'finance-feed/daily-gate','verified-'+dailyFinanceDigest(artifact)+'.json');const bytes=conflict?'conflicting immutable evidence':JSON.stringify(artifact);await writeFile(path,bytes);if(conflict){await assert.rejects(h.finish(b.admission,report));assert.equal(await readFile(path,'utf8'),bytes);assert.ok(JSON.parse(await readFile(join(h.directory,'finance-feed/daily-gate/state.json'))).pending)}else assert.equal((await h.finish(b.admission,report)).complete,true)}});


test('unstarted reservation can be abandoned without claiming success; next hour can collect',async()=>{
 const h=await setup(),b=await h.b();assert.equal(b.admission.reservationProtocol,'preoperation-v1');assert.equal(b.admission.schema,2);
 const result=await abandonUnstartedReservation(h.input(),b.admission);assert.equal(result.complete,false);
 const state=JSON.parse(await readFile(join(h.directory,'finance-feed/daily-gate/state.json')));
 assert.equal(state.pending,undefined);assert.equal(state.days[b.admission.admittedDay].status,'partial');
 assert.equal((await h.b()).reason,'retry-not-due');
 await assert.rejects(assertScheduledAdmission(h.input(),b.admission,'collect'));
 h.time('2025-01-10T17:00:00Z');assert.equal((await h.b()).action,'collect');
});
test('every source or readback guard seals reservation even without an API response',async()=>{
 for(const operation of ['collect','readback']){const h=await setup(),b=await h.b();
 await assertScheduledAdmission(h.input(),b.admission,operation);
 await assert.rejects(abandonUnstartedReservation(h.input(),b.admission),/may have started/);
 assert.equal((await h.b()).reason,'locked-review-if-stale');}
});
test('old, expired, altered and recovery admissions cannot be abandoned',async()=>{
 for(const kind of ['old','expired','altered','recover']){const h=await setup(),b=await h.b();let a=b.admission;
 if(kind==='old'){a={...a};delete a.reservationProtocol}
 if(kind==='expired')h.time('2025-01-10T17:00:00Z');
 if(kind==='altered')a={...a,expiresAt:'2099-01-01T00:00:00Z'};
 if(kind==='recover')a={...a,action:'recover'};
 await assert.rejects(abandonUnstartedReservation(h.input(),a));
 assert.ok(JSON.parse(await readFile(join(h.directory,'finance-feed/daily-gate/state.json'))).pending);
 assert.equal((await h.b()).reason,'locked-review-if-stale');}
});
test('reservation cancellation and first-operation guard cannot both succeed concurrently',async()=>{
 for(let i=0;i<15;i++){const h=await setup(),b=await h.b();
 const r=await Promise.allSettled([abandonUnstartedReservation(h.input(),b.admission),assertScheduledAdmission(h.input(),b.admission,'collect')]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);}
});
test('phase lock and finalizer block cancellation without removing other owners locks',async()=>{
 for(const phase of [true,false]){const h=await setup(),b=await h.b();
 const file=join(h.directory,'finance-feed/daily-gate',phase?'phase-'+dailyFinanceDigest(b.admission.token)+'.lock':'finalize.lock');
 await writeFile(file,'other owner');await assert.rejects(abandonUnstartedReservation(h.input(),b.admission));
 assert.equal(await readFile(file,'utf8'),'other owner');}
});
test('scope drift, immutable proof conflict and lost cancellation response remain fail closed',async()=>{
 for(const kind of ['scope','proof','replay']){const h=await setup(),b=await h.b();
 if(kind==='scope')h.scope.subjects.collection.push('extra');
 if(kind==='proof')await writeFile(join(h.directory,'finance-feed/daily-gate','abandoned-'+dailyFinanceDigest(b.admission.token)+'.json'),'conflict');
 if(kind==='replay')await abandonUnstartedReservation(h.input(),b.admission);
 await assert.rejects(abandonUnstartedReservation(h.input(),b.admission));}
});


test('new reservation version is rejected by the original schema-1 validator',async()=>{
 const h=await setup(),b=await h.b();
 // Original validator begins with this schema check, before returning authorization.
 const oldValidator=(a)=>{if(a.schema!==1)throw Error('Invalid scheduled admission.');};
 assert.throws(()=>oldValidator(b.admission),/Invalid/);
});

test('reviewed inference policy hash binds admission and every operation; legacy admission cannot adopt policy',async()=>{
 const {mkdir}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const h=await setup();await mkdir(join(h.directory,'contributions'));const file=join(h.directory,'contributions/inference-policy.json'),bytes=JSON.stringify({schema:1,rules:[]});await writeFile(file,bytes);
 await assert.rejects(h.b(),/policy/);h.scope.inferencePolicySha256=createHash('sha256').update(bytes).digest('hex');const b=await h.b();assert.equal(b.action,'collect');await assertScheduledAdmission(h.input(),b.admission,'collect');
 await writeFile(file,bytes+' ');await assert.rejects(assertScheduledAdmission(h.input(),b.admission,'collect'),/policy/);await assert.rejects(assertScheduledAdmission(h.input(),b.admission,'readback'),/policy/);await assert.rejects(h.finish(b.admission,h.report(b.admission)),/policy/);assert.equal(h.loads(),0);
});
