import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collectWithRetry } from '../apps/worker/dist/collection-retry.js';
const dir=await mkdtemp(join(tmpdir(),'familyhub-grouped-')); process.env.FAMILYHUB_WORKER_DATA=dir;
const { parseDesjardinsBackfill } = await import('../apps/worker/dist/desjardins-backfill.js');
import { desjardinsInvoices } from '../apps/worker/dist/desjardins.js';

const amounts = ['101,11', '22,22', '133,33', '74,93'];
const members = ['Jasmine','Jasmine','Kevin','Nathan'];
const dates = ['2025-07-01','2026-04-02','2026-01-03','2025-12-04'];
const captured = () => ({ sourceUrl:'https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Rclmtn/RclmtnTrt/DetailReclamation_ClaimDetails.aspx', capturedAt:new Date().toISOString(), payments:[{
  history:{date:'2026-07-08',method:'Dépôt direct',paid:'331,59 $',category:'Health',hasDetail:true},
  detail:amounts.flatMap((paid,i)=>[{cells:[`${members[i]}, Numéro de réclamation: synthetic-${i}`],colspans:[10]},
    {cells:['Counselling',dates[i],dates[i],'200,00','200,00','80%','40,00',paid,'0,00',''],colspans:Array(10).fill(1)}])
}] });

test('a grouped deposit preserves four distinct service dates/members and exact cent total; no total row is a payment',()=>{
 const input=captured(); input.payments[0].detail.push({cells:['REMBOURSEMENT TOTAL :','331,59 $','',''],colspans:[7,1,1,1]});
 const result=parseDesjardinsBackfill(input);
 assert.equal(result.collection.rows.length,4); assert.equal(result.totalCents,33159);
 assert.deepEqual(result.collection.rows.map(r=>r.member),members); assert.deepEqual(result.collection.rows.map(r=>r.serviceDate),dates);
 assert.ok(result.collection.rows.every(r=>r.statementDate==='2026-07-08'));
 const bad=structuredClone(input); bad.payments[0].detail.pop(); bad.payments[0].detail.pop();
 assert.throws(()=>parseDesjardinsBackfill(bad),/incomplete or inconsistent/);
 assert.throws(()=>parseDesjardinsBackfill({...input,sourceUrl:'https://untrusted.example/'}),/original Desjardins/);
 assert.throws(()=>parseDesjardinsBackfill({...input,capturedAt:'2020-01-01'}),/recent/);
});

test('bounded read retries resume after transient failure, stop at auth/inconsistency, and exhaust without overlap',async()=>{
 let calls=0,active=0; const states=[],waits=[];
 const success={status:'success',collection:{complete:true,warnings:[]}};
 const result=await collectWithRetry(async()=>{assert.equal(active++,0);try{if(++calls===1)throw Error('ETIMEDOUT');return success;}finally{active--; }},async s=>states.push(s),async ms=>waits.push(ms));
 assert.equal(result,success); assert.equal(calls,2); assert.deepEqual(waits,[2000]); assert.equal(states.at(-1).state,'complete');
 calls=0; await collectWithRetry(async()=>{calls++;return {status:'login-required'}},async()=>{},async()=>assert.fail('auth must not retry')); assert.equal(calls,1);
 calls=0; const partial={status:'success',collection:{complete:false,warnings:['Page 1, claim 2: detail navigation failed.']}};
 const end=[]; await collectWithRetry(async()=>{calls++;return partial},async s=>end.push(s),async()=>{}); assert.equal(calls,3);assert.equal(end.at(-1).state,'exhausted');
 calls=0;await collectWithRetry(async()=>{calls++;return {status:'success',collection:{complete:false,warnings:['Claim detail reimbursement does not match the processed-claims list.']}}},async()=>{},async()=>assert.fail('amount conflict must not retry'));assert.equal(calls,1);
});

test('supported recovery backs up once, matches only supported expenses, preserves coverage/manual decisions, and reimport is byte-idempotent',async()=>{

 try {
  const input=captured();const source=parseDesjardinsBackfill(input);
  const sources=desjardinsInvoices(source.collection);
  const expenses=sources.slice(0,2).map((i,n)=>({...i,Id:`expense-${n}`,Fingerprint:`expense-${n}`,DocumentType:'invoice',DocumentRole:'expense',Insurer:null,StructuredSource:undefined,ReimbursedAmount:null,Provider:'Synthetic Clinic'}));
  const others=expenses.map((i,n)=>({...sources[n],Id:`other-${n}`,Fingerprint:`other-${n}`,Insurer:'blue-cross',StructuredSource:'blue-cross-portal',ReimbursedAmount:Number((200-sources[n].ReimbursedAmount).toFixed(2)),Provider:'Blue Cross Counselling'}));
  const protectedItem={...expenses[0],Id:'protected-unrelated',ServiceDate:'2023-01-01',Status:3,LastDecisionId:'manual-test',CorrectedAt:'2023-01-01'};
  const state={items:[...expenses,...others,protectedItem],decisions:[],corrections:[],matchDecisions:[],unmatchedDecisions:[],workflowRecords:[],reviews:[],accounts:{}};
  await writeFile(join(dir,'invoices.json'),JSON.stringify(state));await mkdir(join(dir,'desjardins'));
  const coverage={state:'login-required',authReason:'human-required',lastSuccess:'2026-01-01T00:00:00Z',found:10};await writeFile(join(dir,'desjardins/status.json'),JSON.stringify(coverage));
  const {initializeInvoices,initializeDesjardinsStatus,backfillDesjardinsPayments,invoiceSnapshot,getDesjardinsStatus}=await import('../apps/worker/dist/invoices.js');
  await initializeInvoices();await initializeDesjardinsStatus();
  const original=await readFile(join(dir,'invoices.json'));
  const preview=await backfillDesjardinsPayments(input,false);assert.equal(preview.new,4);assert.deepEqual(await readFile(join(dir,'invoices.json')),original);
  const applied=await backfillDesjardinsPayments(input,true);assert.equal(applied.new,4);assert.equal(applied.totalCents,33159);assert.deepEqual(await readFile(join(dir,applied.backup)),original);
  const snapshot=await invoiceSnapshot();assert.equal(snapshot.items.length,9);
  assert.equal(snapshot.items.find(i=>i.Id==='protected-unrelated').LastDecisionId,'manual-test');
  for(const id of ['expense-0','expense-1']){const c=snapshot.reconciliations.find(c=>c.ExpenseDocumentIds.includes(id));assert.equal(c.ReimbursedAmount,200);assert.equal(c.PotentialRemaining,0);}
  assert.equal(snapshot.unmatchedReimbursements.filter(u=>sources.slice(2).some(i=>i.Id===u.DocumentId)).length,2);
  assert.equal(getDesjardinsStatus().state,'login-required');assert.equal(getDesjardinsStatus().lastSuccess,coverage.lastSuccess);assert.equal(getDesjardinsStatus().found,10);
  const bytes=await readFile(join(dir,'invoices.json'));const repeat=await backfillDesjardinsPayments(input,true);assert.deepEqual([repeat.new,repeat.changed,repeat.unchanged],[0,0,4]);assert.deepEqual(await readFile(join(dir,'invoices.json')),bytes);
  const changed=structuredClone(input);changed.payments[0].detail[1].cells[7]='100,11';await assert.rejects(backfillDesjardinsPayments(changed,true),/incomplete or inconsistent/);assert.deepEqual(await readFile(join(dir,'invoices.json')),bytes);
 } finally {if(resolve(dir).startsWith(resolve(tmpdir())+'\\')||resolve(dir).startsWith(resolve(tmpdir())+'/'))await rm(dir,{recursive:true,force:true});}
});
