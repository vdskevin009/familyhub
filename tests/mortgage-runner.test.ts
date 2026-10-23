import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MortgageStore } from '../apps/worker/src/mortgage-store.js';
import { MortgageDailyRunner } from '../apps/worker/src/mortgage-runner.js';
import { snapshot, quote } from './mortgage-fixture.js';
import { validateState, emptyMortgage } from '../apps/worker/src/mortgage-model.js';
import { notificationCandidates } from '../apps/worker/src/notification-model.js';

test('existing collection produces private daily report, serializes repeats, preserves baseline and records missing next day', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fh-mortgage-runner-'));
  try {
    const store=new MortgageStore(dir);await store.ingest('snapshot',snapshot());await store.ingest('quote',quote('fixed'));
    const initial=await store.read();const files=await readdir(dir);const bytes=await Promise.all(files.map(f=>readFile(join(dir,f),'utf8')));
    let calls=0;const runner=new MortgageDailyRunner(store,async()=>{calls++;return[];},async()=>[]);
    const now=new Date('2026-10-21T02:00:00Z');
    const [a,b]=await Promise.all([runner.run(now),runner.run(now)]);
    assert.equal(a?.id,b?.id);assert.equal(calls,1);assert.equal(a?.netGain,null);
    assert.equal(a?.signals.some(s=>s.notify),false,'first report silently baselines existing evidence');
    assert.equal((await runner.run(now))?.id,a?.id);assert.equal(calls,1);
    const next=await runner.run(new Date('2026-10-22T02:00:00Z'));
    assert.equal(next?.freshness.rates,'missing');assert.equal(next?.netGain,null);
    assert.equal(next?.signals.some(s=>s.notify),false,'same missing financial facts do not repeat');
    const state=await store.read();assert.equal(state.reports?.length,2);assert.equal(state.baselineSnapshotId,initial.baselineSnapshotId);
    assert.deepEqual(await Promise.all(files.map(f=>readFile(join(dir,f),'utf8'))),bytes);
    const changed={...a!,generatedAt:'2026-10-21T02:01:00Z'};
    await assert.rejects(()=>store.ingest('report',changed),/ID conflict/);
    const candidates=notificationCandidates({mortgage:state.reports},new Date('2026-10-22T02:01:00Z'));
    assert.equal(candidates.candidates.filter(c=>c.pushEligible).length,0);
    assert.equal(candidates.candidates[0]?.target.view,'mortgage');
    const stale=notificationCandidates({mortgage:state.reports},new Date('2026-10-24T02:00:00Z'));
    assert.equal(stale.candidates.length,0,'old report cannot emit a current push');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('unconfigured store does not enroll; due clock uses Vancouver through DST',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fh-mortgage-empty-'));
 try{const runner=new MortgageDailyRunner(new MortgageStore(dir),async()=>{throw Error('must not collect');},async()=>[]);
 assert.equal(await runner.run(),null);assert.equal(runner.due(new Date('2026-10-23T16:29:00Z')),false);assert.equal(runner.due(new Date('2026-10-23T16:30:00Z')),true);assert.equal(runner.due(new Date('2025-11-03T17:29:00Z')),false);assert.equal(runner.due(new Date('2025-11-03T17:30:00Z')),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('private inputs arriving during collection are drained and dated evidence revisions invalidate cache', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fh-mortgage-queue-'));
  try {
    const store=new MortgageStore(dir); await store.ingest('snapshot',snapshot()); await store.ingest('quote',quote());
    let release!:()=>void, announce!:()=>void, calls=0;
    const gate=new Promise<void>(resolve=>release=resolve), started=new Promise<void>(resolve=>announce=resolve);
    const runner=new MortgageDailyRunner(store,async()=>{calls++;announce();await gate;return[];},async()=>[]);
    const initial=runner.run(new Date('2026-10-21T02:00:00Z')); await started;
    await store.ingest('quote',{...quote(),id:'newly-received-old-dated-quote',rate:4.2});
    const requested=runner.run(new Date('2026-10-21T02:01:00Z'),true); release();
    const [first,last]=await Promise.all([initial,requested]);
    assert.equal(first?.id,last?.id); assert.equal(last?.comparisons.length,2);
    assert.equal(calls,1,'same-day private changes reuse the actual collection');
    const state=await store.read(); assert.equal(state.reports?.length,2);
    assert.notEqual(state.reports?.[0].inputFingerprint,state.reports?.[1].inputFingerprint);
    await store.ingest('quote',{...quote(),id:'third-old-dated-quote',rate:4.1});
    const backdated=await runner.run(new Date('2026-10-21T02:02:00Z'));
    assert.equal(backdated?.comparisons.length,3,'receivedDate does not hide newly stored evidence');
    assert.equal(calls,1);
    const count=(await store.read()).reports?.length;
    await runner.run(new Date('2026-10-21T02:03:00Z'),true);
    assert.equal((await store.read()).reports?.length,count,'unchanged forced requests remain idempotent');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('future snapshot does not become current evidence before its actual capture time',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fh-mortgage-future-'));
  try {
    const store=new MortgageStore(dir); const future=snapshot('future','2026-10-21T04:00:00Z');await store.ingest('snapshot',future);
    const runner=new MortgageDailyRunner(store,async()=>[],async()=>[]);
    const before=await runner.run(new Date('2026-10-21T02:00:00Z'));
    assert.equal(before?.snapshotId,null);assert.equal(before?.freshness.rates,'missing');
    const after=await runner.run(new Date('2026-10-21T05:00:00Z'));
    assert.equal(after?.snapshotId,'future');assert.equal(after?.freshness.rates,'current');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('state validation fails closed for malformed or dangling additive evidence',()=>{
  for(const field of ['profiles','terms','reports','settings']) {
    const state=emptyMortgage(); (state as any)[field]=null; assert.throws(()=>validateState(state));
    (state as any)[field]=[{}];assert.throws(()=>validateState(state));
  }
  const state=emptyMortgage(); state.settings=[{id:'same',recordedAt:'2026-10-20T15:00:00Z',minimumNetGain:1000,materialNetGainChange:500,rateImprovementPoints:.1,expiringWithinDays:7,maximumQuoteAgeDays:14}];
  state.settings.push({...state.settings[0]});assert.throws(()=>validateState(state));
});
