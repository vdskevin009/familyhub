import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionProgress } from '../apps/worker/src/contribution-progress.ts';
const plan = { from: '2030-03-01', through: '2031-03-01', currency: 'CAD', targetAccountId: 'synthetic-retirement', personalGoalCents: 100000, debitAccounts: ['synthetic-debit'], exactTransferDescriptions: ['VERIFIED TRANSFER TO SYNTHETIC RETIREMENT'] };
function row(extra = {}) { return { id: 'synthetic-row', accountId: 'synthetic-debit', date: '2030-05-01', description: plan.exactTransferDescriptions[0], currency: 'CAD', outflowCents: 1000, status: 'posted', occurrence: 1, fingerprint: 'synthetic-fingerprint', sources: [{name: 'Synthetic fixture'}], hints: [], ...extra }; }
function state(rows = [row()]) { return { schema: 1, revision: 'fixture-revision', importedAt: '2030-06-01T12:00:00Z', decisions: {}, decisionHistory: [], imports: [], data: { scope: {from: plan.from, to: '2030-06-01'}, collectedOn: '2030-06-01', accounts: [ {id: 'synthetic-debit', currency: 'CAD'}, {id: 'synthetic-retirement', currency: 'CAD'} ], transactions: rows, activities: [], pendingCount: 0, holdings: [], performance: [], gics: [], feeReports: [], coverage: [{accountId: 'synthetic-debit', earliest: plan.from, latest: '2030-06-01', warning: null}], limits: [] } }; }
const report = s => contributionProgress(s, plan, '2030-06-01');
test('exact evidenced transfers contribute only to observed progress', () => { const r = report(state()); assert.equal(r.observedTransferCents, 1000); assert.equal(r.remainingAgainstObservedCents, 99000); assert.equal(r.confirmedContributionCents, null); assert.equal(r.taxContributionRoomCents, null); assert.equal(r.status, 'partial'); assert.equal(r.sourceAsOf, null); assert.equal(r.sourceFreshness, 'unknown'); });
test('generic and cadence-similar descriptions do not become contributions', () => { assert.equal(report(state([row({description:'GENERIC BROKER TRANSFER'})])).observedTransferCents, 0); });
test('opposite legs, purchases and unconfigured accounts are not counted', () => { const s = state([row(), row({id:'credit',accountId:'synthetic-retirement',outflowCents:-1000}), row({id:'other',accountId:'other'})]); s.data.activities.push({id:'purchase',netCashCents:1000}); assert.equal(report(s).observedTransferCents,1000); });
test('duplicate candidates exclude every ambiguous member', () => { const r = report(state([row(),row({id:'second'})])); assert.equal(r.observedTransferCents,0); assert.equal(r.excluded.length,2); });
test('real repeated occurrences stay separate', () => { assert.equal(report(state([row(),row({id:'second',occurrence:2})])).observedTransferCents,2000); });
test('pending, wrong currency, negative, missing evidence excluded', () => { const rows = [row({id:'pending',status:'pending'}),row({id:'currency',currency:'USD'}),row({id:'negative',outflowCents:-100}),row({id:'missing',sources:[]})]; const r=report(state(rows)); assert.equal(r.observedTransferCents,0); assert.equal(r.excluded.length,4); });
test('manual authority and immutable inputs preserved', () => { const s=state(); s.decisions['synthetic-row']={nature:'duplicate'}; const before=JSON.stringify(s); assert.equal(report(s).observedTransferCents,0); assert.equal(JSON.stringify(s),before); });
test('calendar boundaries and future data fail closed', () => { assert.equal(report(state([row({date:'2030-02-28'}),row({id:'future',date:'2031-03-02'})])).observedTransferCents,0); assert.throws(()=>contributionProgress(state(),{...plan,from:'2030-02-30'},'2030-06-01')); const s=state(); s.data.collectedOn='2030-06-02'; assert.throws(()=>report(s)); });
test('fresh retrieval never erases source staleness and coverage limits', () => { const s=state(); s.data.collectedOn='2030-05-31'; s.data.coverage[0].warning='Missing source days'; const r=report(s); assert.equal(r.status,'partial'); assert.ok(r.warnings.includes('source-not-current')); assert.ok(r.warnings.includes('coverage-incomplete')); });
test('replay deterministic and empty data not a verified zero', () => { assert.deepEqual(report(state()),report(state())); const s=state(); s.data=null; assert.equal(report(s).status,'partial'); assert.ok(report(s).warnings.includes('source-unavailable')); });
test('generic transfers retained separately without amount attribution', () => { const r=contributionProgress(state([row({description:'GENERIC BROKER TRANSFER'})]), {...plan,unassignedTransferDescriptions:['GENERIC BROKER TRANSFER']},'2030-06-01'); assert.equal(r.observedTransferCents,0); assert.equal(r.unassigned.length,1); });

import { ContributionReportStore } from '../apps/worker/src/contribution-report-store.ts';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('private report persists, reads back, deduplicates after restart and preserves history', async () => {
  const dir=await mkdtemp(join(tmpdir(),'familyhub-contribution-synthetic-'));
  try {
    const s=state(); const before=JSON.stringify(s);
    const first=await new ContributionReportStore(dir).save(s,plan,'2030-06-01');
    assert.equal(first.replayed,false);
    const bytes=await readFile(join(dir,first.id+'.json'),'utf8');
    const second=await new ContributionReportStore(dir).save(s,plan,'2030-06-01');
    assert.equal(second.replayed,true); assert.equal(second.id,first.id);
    assert.equal(JSON.stringify(s),before);
    const next=await new ContributionReportStore(dir).save(s,plan,'2030-06-02');
    assert.notEqual(next.id,first.id); assert.equal(next.report.status,'partial');
    assert.equal(await readFile(join(dir,first.id+'.json'),'utf8'),bytes);
    assert.equal((await readdir(dir)).length,2);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('concurrent delivery publishes one complete immutable report', async () => {
  const dir=await mkdtemp(join(tmpdir(),'familyhub-contribution-synthetic-'));
  try {
    const results=await Promise.all(Array.from({length:5},()=>new ContributionReportStore(dir).save(state(),plan,'2030-06-01')));
    assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.equal((await readdir(dir)).length,1);
  } finally { await rm(dir,{recursive:true,force:true}); }
});