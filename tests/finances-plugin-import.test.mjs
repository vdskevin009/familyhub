import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareFinancesPluginImport, pluginAccountKey, pluginTransactionKey } from '../apps/worker/src/finances-plugin-import.ts';
import { FinanceLibrary } from '../apps/worker/src/finance-library.ts';
import { financeFixture } from './finance-fixture.mjs';
function evidence() {
 const row={item_id:'fiction-item',account_id:'fiction-account',transaction_id:'fiction-tx',date:'2030-03-02',amount:123,normalized_amount:-123,iso_currency_code:'CAD',pending:false,merchant_name:'EXAMPLE TRANSFER TO SYNTHETIC DESTINATION'};
 const pages=[{requestCursor:null,result:{items:[row],has_more:false,next_cursor:null,coverage:{dataset:'transactions',availability:'ready',state:'full_history',freshness:'unknown',is_complete_for_query:true,warning_codes:[]}}}];
 return {row,pages};
}
async function fixture(fn) {
 const dir=await mkdtemp(join(tmpdir(),'familyhub-plugin-synthetic-'));
 try { const library=new FinanceLibrary(dir); await library.import({bundle:financeFixture(),apply:true,expectedRevision:'empty'}); await fn(library); }
 finally { await rm(dir,{recursive:true,force:true}); }
}
function plan(state,row) { return {expectedRevision:state.revision,from:'2030-03-01',through:'2030-03-31',retrievedAt:'2030-04-01T12:00:00Z',accounts:{[pluginAccountKey(row.item_id,row.account_id)]:'bank'},resolutions:{[pluginTransactionKey(row)]:{kind:'new'}}}; }
test('private adapter uses sign, exact source reference, retained coverage uncertainty and immutable archive',()=>fixture(async library=>{
 const state=await library.read(),{row,pages}=evidence(); const p=plan(state,row);
 const result=prepareFinancesPluginImport(pages,p,state); assert.equal(result.bundle.bankActivities[0].signedOutflowCents,12300); assert.equal(result.bundle.bankActivities[0].descriptionOriginal,row.merchant_name); assert.equal(result.bundle.pluginEvidence.sourceAsOf,null);
 const before=JSON.stringify(state); const preview=await library.import({bundle:result.bundle,apply:false}); assert.equal(preview.added,1); assert.equal(JSON.stringify(await library.read()),before);
 const applied=await library.import({bundle:result.bundle,apply:true,expectedRevision:state.revision}); assert.equal(applied.added,1);
 const replay=await library.import({bundle:result.bundle,apply:true,expectedRevision:state.revision}); assert.equal(replay.alreadyImported,true); assert.equal(replay.added,0);
 assert.equal((await library.read()).data.transactions.length,state.data.transactions.length+1);
}));
test('stale mapping, missing mapping and incomplete or exported preview fail closed',()=>fixture(async library=>{
 const state=await library.read(),{row,pages}=evidence(),p=plan(state,row);
 assert.throws(()=>prepareFinancesPluginImport(pages,{...p,expectedRevision:'stale'},state));
 assert.throws(()=>prepareFinancesPluginImport(pages,{...p,resolutions:{}},state));
 for(const change of [{items:undefined,file_id:'synthetic-file'},{has_more:true,next_cursor:'next'},{coverage:{...pages[0].result.coverage,is_complete_for_query:false}}]) assert.throws(()=>prepareFinancesPluginImport([{requestCursor:null,result:{...pages[0].result,...change}}],p,state));
}));
test('existing ledger row binding preserves facts and avoids cross-provider duplicates',()=>fixture(async library=>{
 const state=await library.read(),old=state.data.transactions.find(r=>r.accountId==='bank'),{row,pages}=evidence();
 Object.assign(row,{date:old.date,amount:old.outflowCents/100,normalized_amount:-old.outflowCents/100,merchant_name:'DIFFERENT PROVIDER WORDING'});
 const p={...plan(state,row),from:old.date,through:old.date,retrievedAt:'2030-04-01T12:00:00Z'};
 assert.throws(()=>prepareFinancesPluginImport(pages,p,state));
 p.resolutions[pluginTransactionKey(row)]={kind:'existing',ledgerId:old.id};
 const result=prepareFinancesPluginImport(pages,p,state); assert.equal(result.bundle.bankActivities[0].descriptionOriginal,old.description);
 const applied=await library.import({bundle:result.bundle,apply:true,expectedRevision:state.revision}); assert.equal(applied.added,0); assert.equal(applied.state.data.transactions.length,state.data.transactions.length);
}));
test('pending excluded and malformed signs or dates rejected',()=>fixture(async library=>{
 const state=await library.read(),{row,pages}=evidence(),p=plan(state,row); row.pending=true;
 assert.equal(prepareFinancesPluginImport(pages,p,state).pendingCount,1); assert.equal(prepareFinancesPluginImport(pages,p,state).postedCount,0);
 row.normalized_amount=123; assert.throws(()=>prepareFinancesPluginImport(pages,p,state)); row.normalized_amount=-123; row.date='2030-02-30'; assert.throws(()=>prepareFinancesPluginImport(pages,p,state));
}));
test('pagination chain exact and duplicate provider identities rejected',()=>fixture(async library=>{
 const state=await library.read(),{row,pages}=evidence(),p=plan(state,row);
 const first={requestCursor:null,result:{...pages[0].result,has_more:true,next_cursor:'page-2'}};
 const second={requestCursor:'page-2',result:{...pages[0].result,items:[]}};
 assert.equal(prepareFinancesPluginImport([first,second],p,state).postedCount,1);
 assert.throws(()=>prepareFinancesPluginImport([first,{...second,requestCursor:'other'}],p,state));
 assert.throws(()=>prepareFinancesPluginImport([{...pages[0],result:{...pages[0].result,items:[row,row]}}],p,state));
}));
test('next daily import reuses provider identity and rejects changed facts',()=>fixture(async library=>{
 const state=await library.read(),{row,pages}=evidence(),p=plan(state,row);
 const first=prepareFinancesPluginImport(pages,p,state);
 await library.import({bundle:first.bundle,apply:true,expectedRevision:state.revision});
 const current=await library.read();
 const next=prepareFinancesPluginImport(pages,{...p,expectedRevision:current.revision,retrievedAt:'2030-04-02T12:00:00Z'},current);
 const applied=await library.import({bundle:next.bundle,apply:true,expectedRevision:current.revision});
 assert.equal(applied.added,0); assert.equal(applied.state.data.transactions.length,current.data.transactions.length);
 row.amount=124; row.normalized_amount=-124;
 assert.throws(()=>prepareFinancesPluginImport(pages,{...p,expectedRevision:current.revision},current));
}));
import { syncContributionEvidence } from '../apps/worker/src/contribution-sync.ts';
import { ContributionReportStore } from '../apps/worker/src/contribution-report-store.ts';
test('orchestrator verifies real temporary-library writes and recovers lost apply response without replay',()=>fixture(async library=>{
 const state=await library.read(),{row,pages}=evidence(),p=plan(state,row);
 const directory=await mkdtemp(join(tmpdir(),'familyhub-sync-synthetic-'));
 try {
  let writes=0;
  const transport={read:()=>library.read(),preview:bundle=>library.import({bundle,apply:false}),apply:async(bundle,revision)=>{writes++; await library.import({bundle,apply:true,expectedRevision:revision}); throw new Error('Synthetic response lost');}};
  const input={pages,mapping:p,contributionPlan:{from:p.from,through:p.through,currency:'CAD',targetAccountId:'rrsp',personalGoalCents:100000,debitAccounts:['bank'],exactTransferDescriptions:[row.merchant_name]},reportStore:new ContributionReportStore(directory),transport};
  const first=await syncContributionEvidence(input); assert.equal(first.importConfirmed,true); assert.equal(first.recoveredUncertainApply,true); assert.equal(writes,1);
  const again=await syncContributionEvidence(input); assert.equal(writes,1); assert.equal(again.importedEvidenceHash,first.importedEvidenceHash); assert.equal(again.reportReplayed,true);
 } finally { await rm(directory,{recursive:true,force:true}); }
}));
test('unconfirmed apply never replays or writes report',()=>fixture(async library=>{
 const state=await library.read(),{row,pages}=evidence(),p=plan(state,row); let writes=0,saves=0;
 await assert.rejects(()=>syncContributionEvidence({pages,mapping:p,contributionPlan:{},reportStore:{save:async()=>{saves++;}},transport:{read:()=>library.read(),preview:bundle=>library.import({bundle,apply:false}),apply:async()=>{writes++; throw new Error('Synthetic lost response');}}}),/unconfirmed/);
 assert.equal(writes,1); assert.equal(saves,0); assert.equal((await library.read()).revision,state.revision);
}));