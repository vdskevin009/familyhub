import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFinanceFeed,financeFeedQueries} from '../apps/worker/src/finances-full-feed.ts';
import {pluginAccountKey,pluginTransactionKey} from '../apps/worker/src/finances-plugin-import.ts';
import {parseFinancePreparation} from '../apps/worker/src/finance-import.ts';
import {financeFixture} from './finance-fixture.mjs';
function fixture() {
 const state={revision:'synthetic',data:parseFinancePreparation(financeFixture()),imports:[],decisions:{}};
 const row={item_id:'fiction',account_id:'fiction-account',transaction_id:'fiction-tx',date:'2030-03-02',amount:3.25,pending:false,iso_currency_code:'CAD',name:'Synthetic purchase'};
 const plan={expectedRevision:state.revision,from:'2030-03-01',through:'2030-03-31',retrievedAt:'2030-04-01T12:00:00Z',accounts:{[pluginAccountKey(row.item_id,row.account_id)]:'bank'},resolutions:{[pluginTransactionKey(row)]:{kind:'new'}}};
 const queries=financeFeedQueries(plan);
 const batch=(kind,items,coverage=true)=>({query:queries[kind],pages:[{requestCursor:null,result:{items,has_more:false,next_cursor:null,...(coverage?{coverage:{dataset:kind,availability:'ready',state:'full_history',freshness:'unknown',is_complete_for_query:true,warning_codes:[]}}:{})}}]});
 const evidence={linkedAccounts:{institutions:[{accounts:[{item_id:row.item_id,account_id:row.account_id,balances:{current:40,iso_currency_code:'CAD',last_updated_datetime:'2030-04-01',last_updated_datetime_source:'record_update'}}]}]},transactions:batch('transactions',[row]),holdings:batch('investment_holdings',[],false),activity:batch('investment_transactions',[],false)};
 return {state,plan,evidence,row,batch};
}
test('broad feed retains unknown investment coverage and dated history without source-date fabrication',()=>{
 const {state,plan,evidence}=fixture(),before=JSON.stringify(state);
 const result=prepareFinanceFeed(evidence,plan,state);
 assert.equal(result.bundle.bankActivities[0].signedOutflowCents,325);
 assert.equal(result.bundle.accounts[0].observedOn,state.data.accounts.find(a=>a.id==='bank').asOf);
 assert.equal(result.bundle.holdingsSnapshots.length,0);
 assert.match(result.bundle.limits.join(' '),/empty result is not zero holdings/);
 assert.equal(JSON.stringify(state),before);
});
test('rejects filtered request, cursor truncation, missing account and duplicate bindings',()=>{
 for(const edit of [
  f=>f.evidence.transactions.query.name='filtered',
  f=>f.evidence.transactions.pages[0].result.has_more=true,
  f=>f.evidence.linkedAccounts.institutions=[],
  f=>f.plan.accounts[pluginAccountKey('other','other')]='bank',
  f=>f.plan.excludedTransactionKeys=['excluded']
 ]) { const f=fixture();edit(f);assert.throws(()=>prepareFinanceFeed(f.evidence,f.plan,f.state)); }
});
test('source reported balance dates accepted; updates are not freshness',()=>{
 const f=fixture(),b=f.evidence.linkedAccounts.institutions[0].accounts[0].balances;
 b.balance_date='2030-03-30'; const r=prepareFinanceFeed(f.evidence,f.plan,f.state);
 assert.equal(r.bundle.accounts[0].observedOn,'2030-03-30');
 assert.equal(r.bundle.accounts[0].observedBalanceCents,4000);
 assert.equal(r.coverage.transactions[0].freshness,'unknown');
});
test('holdings price dates alone and investment settlement dates never manufacture position/trade dates',()=>{
 const f=fixture();
 f.evidence.holdings=f.batch('investment_holdings',[{item_id:'fiction',account_id:'fiction-account',security_id:'fiction-security',iso_currency_code:'CAD',institution_value:50,institution_price_as_of:'2030-03-01',name:'Synthetic position',is_cash_equivalent:false}]);
 f.evidence.activity=f.batch('investment_transactions',[{item_id:'fiction',account_id:'fiction-account',investment_transaction_id:'fiction-trade',iso_currency_code:'CAD',date:'2030-03-03',amount:5,type:'buy',name:'Synthetic trade'}]);
 const r=prepareFinanceFeed(f.evidence,f.plan,f.state);
 assert.equal(r.bundle.holdingsSnapshots.length,0);assert.equal(r.bundle.brokerageActivities.length,0);assert.equal(r.withheld.length,3);
});
test('complete source-dated holdings import but order initiation never becomes execution',()=>{
 const f=fixture();
 f.evidence.holdings=f.batch('investment_holdings',[{item_id:'fiction',account_id:'fiction-account',security_id:'fiction-security',iso_currency_code:'CAD',institution_value:50,name:'Synthetic position',is_cash_equivalent:false}]);
 f.evidence.holdings.pages[0].result.coverage.source_as_of='2030-03-30';
 f.evidence.activity=f.batch('investment_transactions',[{item_id:'fiction',account_id:'fiction-account',investment_transaction_id:'fiction-trade',iso_currency_code:'CAD',date:'2030-03-03',transaction_datetime:'2030-03-02T12:00:00Z',amount:5,type:'buy',name:'Synthetic trade'}]);
 const r=prepareFinanceFeed(f.evidence,f.plan,f.state);
 assert.equal(r.bundle.holdingsSnapshots[0].totalValueCents,5000);
 assert.equal(r.bundle.brokerageActivities.length,0);
 assert.match(r.withheld.join(' '),/execution date/);
});


test('paired preview/apply preserves prior ledger and decisions; uncertain success is read back without replay',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const {FinanceLibrary}=await import('../apps/worker/src/finance-library.ts');
 const {syncFinanceFeed}=await import('../apps/worker/src/finances-full-feed.ts');
 const dir=await mkdtemp(join(tmpdir(),'familyhub-feed-fiction-'));
 try {
  const library=new FinanceLibrary(dir);
  await library.import({bundle:financeFixture(),apply:true,expectedRevision:'empty'});
  const before=await library.read(),f=fixture(); f.plan.expectedRevision=before.revision; let writes=0;
  const result=await syncFinanceFeed({evidence:f.evidence,mapping:f.plan,transport:{
   read:()=>library.read(),preview:bundle=>library.import({bundle,apply:false}),
   apply:async(bundle,expectedRevision)=>{writes++;await library.import({bundle,apply:true,expectedRevision});throw new Error('Synthetic lost reply');}
  }});
  assert.equal(result.importConfirmed,true);assert.equal(result.recoveredUncertainApply,true);assert.equal(writes,1);
  const after=await library.read();assert.equal(after.data.transactions.length,before.data.transactions.length+1);assert.deepEqual(after.decisions,before.decisions);assert.deepEqual(after.data.holdings,before.data.holdings);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('uncertain failed apply never retries or reports success',async()=>{
 const {syncFinanceFeed}=await import('../apps/worker/src/finances-full-feed.ts');
 const f=fixture();let writes=0;
 await assert.rejects(()=>syncFinanceFeed({evidence:f.evidence,mapping:f.plan,transport:{read:async()=>f.state,preview:async()=>({revision:f.state.revision,possibleDuplicates:0}),apply:async()=>{writes++;throw new Error('Synthetic disconnected');}}}),/unconfirmed/);
 assert.equal(writes,1);
});


test('stale reviewed mapping stops before preview or apply',async()=>{const {syncFinanceFeed}=await import('../apps/worker/src/finances-full-feed.ts');const f=fixture();let calls=0;await assert.rejects(()=>syncFinanceFeed({evidence:f.evidence,mapping:{...f.plan,expectedRevision:'older-review'},transport:{read:async()=>f.state,preview:async()=>{calls++;return{}},apply:async()=>{calls++;}}}),/Ledger changed/);assert.equal(calls,0);});

test('equal-time changed balance and malformed source dates fail closed',()=>{
 for(const value of ['2030-02-30','2030-03-02garbage','2030-03-02T25:00:00Z']) {const f=fixture();f.evidence.linkedAccounts.institutions[0].accounts[0].balances.balance_date=value;assert.throws(()=>prepareFinanceFeed(f.evidence,f.plan,f.state));}
 const f=fixture(),old=f.state.data.accounts.find(a=>a.id==='bank');f.evidence.linkedAccounts.institutions[0].accounts[0].balances.balance_date=old.asOf;assert.throws(()=>prepareFinanceFeed(f.evidence,f.plan,f.state));
});
test('original trade and cancellation remain raw evidence without synthetic ledger actions',()=>{
 const f=fixture();const original={item_id:'fiction',account_id:'fiction-account',investment_transaction_id:'fiction-trade',iso_currency_code:'CAD',date:'2030-03-03',transaction_datetime:'2030-03-02T12:00:00Z',amount:5,type:'buy',name:'Synthetic original'};
 f.evidence.activity=f.batch('investment_transactions',[original,{...original,investment_transaction_id:'fiction-cancel',type:'cancel',cancel_transaction_id:'fiction-trade',name:'Synthetic cancel'}]);
 const result=prepareFinanceFeed(f.evidence,f.plan,f.state);assert.equal(result.bundle.brokerageActivities.length,0);assert.equal(result.bundle.pluginFeedEvidence.evidence.activity.pages[0].result.items.length,2);
});
