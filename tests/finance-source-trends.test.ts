import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceSpendingTrend } from '../apps/web/src/finance-source-trends.ts';
import { expenseSnapshot } from './finance-source-expenses-fixture.mjs';
const fixture = () => expenseSnapshot();
test('same source classification: refunds netted; pending, income, transfers and ambiguity excluded', () => {
 const s=fixture(),before=JSON.stringify(s),t=sourceSpendingTrend(s,'2026-11');
 assert.equal(t.actualCents,11500);assert.equal(t.summary.pendingCount,1);assert.equal(t.summary.ambiguousCount,2);assert.equal(t.partial,true);assert.equal(t.to,'2026-11-14');assert.equal(t.baselineCents,null);assert.equal(JSON.stringify(s),before);
});
test('no assumed zero, currency conversion, cross-account mapping or out-of-scope month', () => {
 const s=fixture();assert.equal(sourceSpendingTrend(s,'2026-11','','USD').actualCents,900);
 assert.equal(sourceSpendingTrend(s,'2026-11',s.accounts[1].sourceKey).actualCents,null);
 assert.equal(sourceSpendingTrend(s,'2026-11','canonical-or-suffix').actualCents,null);
 for(const m of ['2026-09','2026-10','2026-12'])assert.equal(sourceSpendingTrend(s,m).actualCents,null);
});
const comparable = () => { const s=fixture();s.rows=s.rows.filter(r=>r.description.endsWith('purchase'));s.rows.push({...s.rows[0],sourceKey:'fsi_'+'b'.repeat(64),date:'2026-10-10',outflowCents:5000},{...s.rows[0],sourceKey:'fsi_'+'c'.repeat(64),date:'2026-10-20',outflowCents:8000});return s; };
test('partial target compares matching days within one capture and same scope',()=>{const t=sourceSpendingTrend(comparable(),'2026-11');assert.equal(t.baselineCents,5000);assert.deepEqual(t.referenceMonths,['2026-10']);assert.equal(t.daily.at(-1)?.baselineCents,5000);assert.equal(t.daily.length,14);});
test('unattested coverage, missing start or ambiguous target prevents reference',()=>{for(const change of [(s:any)=>s.coverage.complete=false,(s:any)=>s.query.from='2026-11-05',(s:any)=>s.rows.push({...s.rows[0],sourceKey:'fsi_'+'d'.repeat(64),category:{primary:null,detailed:null,confidence:null}})]){const s=comparable();change(s);assert.equal(sourceSpendingTrend(s,'2026-11').baselineCents,null);}});
test('incomplete prior month never enters reference',()=>{const s=comparable();s.query.from='2026-10-05';assert.equal(sourceSpendingTrend(s,'2026-11').baselineCents,null);});
test('a separate newer capture does not modify or sum earlier capture observations',()=>{const s=comparable(),t=sourceSpendingTrend(s,'2026-11'),newer=structuredClone(s);newer.rows[0].outflowCents=25000;assert.equal(sourceSpendingTrend(newer,'2026-11').actualCents,25000);assert.equal(t.actualCents,10000);});
test('refund-only periods retain negative amounts and zero net with evidence stays zero',()=>{const s=comparable();s.rows[0].outflowCents=-2000;assert.equal(sourceSpendingTrend(s,'2026-11').actualCents,-2000);s.rows.push({...s.rows[0],sourceKey:'fsi_'+'d'.repeat(64),outflowCents:2000});assert.equal(sourceSpendingTrend(s,'2026-11').actualCents,0);});
test('posted pending identity suppresses predecessor exactly as expense summary',()=>{const s=comparable();s.rows.push({...s.rows[0],sourceKey:'fsi_'+'e'.repeat(64),pending:true});s.rows[0].pendingSourceKey='fsi_'+'e'.repeat(64);const t=sourceSpendingTrend(s,'2026-11');assert.equal(t.actualCents,10000);assert.equal(t.summary.pendingCount,0);});
test('monthly summary and cumulative curve agree for month-length differences',()=>{const s=comparable();s.query={...s.query,from:'2026-01-01',through:'2026-02-28'};s.rows=[{...s.rows[0],date:'2026-01-31',outflowCents:5000},{...s.rows[1],date:'2026-02-15',outflowCents:9000}];const t=sourceSpendingTrend(s,'2026-02');assert.equal(t.baselineCents,5000);assert.equal(t.daily.length,31);assert.equal(t.daily.at(-1)?.actualCents,null);assert.equal(t.daily.at(-1)?.baselineCents,5000);});
test('invalid months fail rather than producing fabricated date ranges',()=>{assert.throws(()=>sourceSpendingTrend(fixture(),'2026-13'));});
