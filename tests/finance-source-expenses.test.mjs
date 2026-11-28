import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validateSourceExpenses,classifySourceExpense,summarizeSourceExpenses} from '../apps/worker/dist/finance-source-expenses-model.js';
import {prepareSourceExpenses} from '../apps/worker/dist/finance-source-expenses-prepare.js';
import {FinanceSourceExpensesStore} from '../apps/worker/dist/finance-source-expenses-store.js';
import {expenseEvidence,expenseSnapshot} from './finance-source-expenses-fixture.mjs';
const now=new Date('2026-11-16T00:00:00Z'),filter={from:'2026-11-01',through:'2026-11-30',currency:'CAD'};
test('source-native categories exclude repayments/funding/income, retain genuine linked fees and insurance expense, separate refunds/pending/uncertainty/currency',()=>{
 const s=validateSourceExpenses(expenseSnapshot(),now),result=summarizeSourceExpenses(s,filter);
 assert.equal(result.grossCents,13500);assert.equal(result.refundCents,2000);assert.equal(result.netCents,11500);assert.equal(result.pendingCount,1);assert.equal(result.ambiguousCount,2);assert.equal(result.excludedCount,4);assert.equal(result.complete,false);
 assert.equal(summarizeSourceExpenses(s,{...filter,currency:'USD'}).netCents,900);
 assert.equal(summarizeSourceExpenses(s,{...filter,accountSourceKey:s.accounts.find(a=>a.name==='Compte source fictif').sourceKey}).hasIncluded,false);
 assert.equal(summarizeSourceExpenses(s,{...filter,from:'2026-12-01',through:'2026-12-31'}).hasIncluded,false);
});
test('classification never guesses from names/signs; low confidence and missing categories are ambiguous',()=>{
 const row=expenseSnapshot().rows[0];assert.equal(classifySourceExpense({...row,description:'TRANSFER CREDIT CARD REFUND',outflowCents:99}),'expense');
 for(const confidence of ['LOW','UNKNOWN',null])assert.equal(classifySourceExpense({...row,category:{...row.category,confidence}}),'ambiguous');
 assert.equal(classifySourceExpense({...row,outflowCents:-100,category:{primary:null,detailed:null,confidence:null}}),'ambiguous');
 assert.equal(classifySourceExpense({...row,category:{primary:'financial',detailed:'new_unsupported',confidence:'HIGH'}}),'ambiguous');
 assert.equal(classifySourceExpense({...row,linkedTransfer:true}),'ambiguous');
 assert.equal(classifySourceExpense({...row,linkedTransfer:true,outflowCents:-100}),'ambiguous');
 assert.equal(classifySourceExpense({...row,linkedTransfer:true,category:{primary:'financial',detailed:'financial_bnpl_payments',confidence:'HIGH'}}),'ambiguous');
});
test('explicit pending identity link removes superseded pending row without name/amount/date matching',()=>{
 const s=expenseSnapshot(),p=s.rows.find(r=>r.pending),posted={...p,sourceKey:'fsi_'+'b'.repeat(64),pending:false,pendingSourceKey:p.sourceKey,outflowCents:4500};s.rows.push(posted);
 const result=summarizeSourceExpenses(validateSourceExpenses(s,now),filter);assert.equal(result.pendingCount,0);assert.equal(result.grossCents,18000);
});
test('strict allowlist rejects raw IDs, invalid/future dates, inconsistent coverage, duplicates and incompatible pending links',()=>{
 for(const mutate of [s=>s.secret='raw',s=>s.rows[0].account_id='raw',s=>s.collectedAt='2030-01-01T00:00:00Z',s=>s.rows[0].date='2026-02-30',s=>s.rows[0].currency='dollars',s=>s.rows.push(s.rows[0]),s=>s.coverage.hasMore=true,s=>s.coverage.sourceAsOf=42,s=>s.coverage.sourceAsOf=undefined,s=>s.coverage.sourceAsOf={},s=>s.rows[0].pendingSourceKey=s.rows[1].sourceKey]){const s=expenseSnapshot();mutate(s);assert.throws(()=>validateSourceExpenses(s,now));}
});
test('adapter hashes all identities, validates scope/sign and safely retains partial pagination/unknown freshness',()=>{
 const e=expenseEvidence(),snapshot=prepareSourceExpenses(e,now);assert.equal(snapshot.rows.length,12);assert.equal(snapshot.coverage.sourceAsOf,null);assert.equal(snapshot.coverage.complete,true);assert.doesNotMatch(JSON.stringify(snapshot),/synthetic-item|synthetic-card|synthetic-counterpart|transaction_id/);
 const partial=structuredClone(e);partial.transactions.pages[0].result.has_more=true;partial.transactions.pages[0].result.next_cursor='next';assert.equal(prepareSourceExpenses(partial,now).coverage.complete,false);
 for(const mutate of [e=>e.transactions.query.pending=false,e=>e.transactions.query.include_transfers=false,e=>e.transactions.pages[0].result.items[0].normalized_amount=100,e=>e.transactions.pages[0].result.items[0].account_id='unselected',e=>e.transactions.pages[0].requestCursor='unknown']){const f=structuredClone(e);mutate(f);assert.throws(()=>prepareSourceExpenses(f,now));}
 const missing=structuredClone(e);delete missing.transactions.pages[0].result.coverage;assert.equal(prepareSourceExpenses(missing,now).coverage.complete,false);
});
test('adapter identical source IDs deduplicate across pages, contradictory rows fail; no cross-capture summing',()=>{
 const e=expenseEvidence(),p=e.transactions.pages[0];p.result.has_more=true;p.result.next_cursor='next';e.transactions.pages.push({requestCursor:'next',result:{...p.result,items:[p.result.items[0]],has_more:false,next_cursor:null}});assert.equal(prepareSourceExpenses(e,now).rows.length,12);
 e.transactions.pages[1].result.items=[{...p.result.items[0],amount:101,normalized_amount:-101}];assert.throws(()=>prepareSourceExpenses(e,now));
});
test('append-only snapshots: preview no files, exact replay, stale revision, earlier/conflicting capture, concurrency, restart, corrupt file preservation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'familyhub-source-expenses-synthetic-'));try{
 const store=new FinanceSourceExpensesStore(dir),first=expenseSnapshot();assert.deepEqual(await store.read(now),{revision:'empty',snapshots:[]});const preview=await store.preview(first,'empty',now);assert.deepEqual(await readdir(dir),[]);
 const saved=await store.save(first,'empty',now);assert.equal(saved.revision,preview.proposedRevision);assert.equal(saved.snapshots.length,1);assert.equal((await store.preview(first,saved.revision,now)).alreadyImported,true);assert.deepEqual(await store.save(first,saved.revision,now),saved);
 await assert.rejects(store.save(first,'empty',now),/has changed/);await assert.rejects(store.save({...first,evidenceSha256:'b'.repeat(64)},saved.revision,now),/conflicting/);
 const second={...first,collectedAt:'2026-11-15T02:00:00.000Z'};const outcomes=await Promise.allSettled([store.save(second,saved.revision,now),store.save({...second,collectedAt:'2026-11-15T03:00:00.000Z'},saved.revision,now)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 const after=await new FinanceSourceExpensesStore(dir).read(now);assert.equal(after.snapshots.length,2);assert.deepEqual(after.snapshots[0],saved.snapshots[0]);assert.equal(summarizeSourceExpenses(after.snapshots.at(-1),filter).netCents,11500);
 assert.equal((await store.preview(first,after.revision,now)).alreadyImported,true);const path=join(dir,'finance','source-expenses.json');await writeFile(path,'corrupt-synthetic');await assert.rejects(store.save(first,after.revision,now),/could not be read/);assert.equal(await readFile(path,'utf8'),'corrupt-synthetic');
 }finally{await rm(dir,{recursive:true,force:true});}
});
