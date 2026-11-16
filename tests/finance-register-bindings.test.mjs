import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { FinanceLibrary } from '../apps/worker/src/finance-library.ts';
import { readFinanceRegisterBindings } from '../apps/worker/src/finance-register-bindings.ts';
import { prepareFinancesPluginImport, pluginAccountKey, pluginTransactionKey } from '../apps/worker/src/finances-plugin-import.ts';
import { sourceExpenseKey } from '../apps/worker/src/finance-source-expenses-store.ts';
import { financeFixture } from './finance-fixture.mjs';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'familyhub-bindings-synthetic-'));
  try {
    const library = new FinanceLibrary(dir);
    const state = (await library.import({bundle:financeFixture(),apply:true,expectedRevision:'empty'})).state;
    const old = state.data.transactions.find(t => t.id === 'groceries');
    const row = {item_id:'synthetic-item',account_id:'synthetic-account',transaction_id:'synthetic-row',date:old.date,amount:old.outflowCents/100,iso_currency_code:old.currency,pending:false,merchant_name:'Different fictional source description'};
    const pages = [{requestCursor:null,result:{items:[row],has_more:false,next_cursor:null,coverage:{dataset:'transactions',availability:'ready',state:'full_history',is_complete_for_query:true,warning_codes:[]}}}];
    const plan = {expectedRevision:state.revision,from:old.date,through:old.date,retrievedAt:'2030-04-01T12:00:00Z',accounts:{[pluginAccountKey(row.item_id,row.account_id)]:old.accountId},resolutions:{[pluginTransactionKey(row)]:{kind:'existing',ledgerId:old.id}}};
    const prepared = prepareFinancesPluginImport(pages,plan,state);
    const applied = (await library.import({bundle:prepared.bundle,apply:true,expectedRevision:state.revision})).state;
    await run({dir,library,state:applied,row,old});
  } finally { assert(resolve(dir).startsWith(resolve(tmpdir())+sep)); await rm(dir,{recursive:true,force:true}); }
}
test('verified immutable archive supplies exact identities without writing or exposing provider IDs',()=>fixture(async ({dir,state,row,old})=>{
  const before=await readFile(join(dir,'ledger.json'),'utf8');
  const proof=await readFinanceRegisterBindings(dir,state);
  assert.equal(proof.ledgerRevision,state.revision);
  assert.equal(proof.unavailableArchiveCount,0);
  assert.equal(proof.bindings.accounts[sourceExpenseKey('account',row.item_id,row.account_id)],old.accountId);
  assert.equal(proof.bindings.transactions[sourceExpenseKey('transaction',row.item_id,row.transaction_id,row.account_id)],old.id);
  assert.doesNotMatch(JSON.stringify(proof),/synthetic-item|synthetic-account|synthetic-row|Different fictional/);
  assert.equal(await readFile(join(dir,'ledger.json'),'utf8'),before);
}));
test('changed current facts cannot reuse archived identity',()=>fixture(async ({dir,state,old})=>{
  for(const change of [{date:'2030-01-01'},{outflowCents:999},{currency:'USD'},{accountId:'bank'},{status:'pending'}]) {
    const copy=structuredClone(state);Object.assign(copy.data.transactions.find(t=>t.id===old.id),change);
    const proof=await readFinanceRegisterBindings(dir,copy);
    assert.deepEqual(proof.bindings,{accounts:{},transactions:{}});assert.equal(proof.unavailableArchiveCount,1);
  }
}));
test('tampered, missing and path-like archives fail closed with explicit coverage limitation',()=>fixture(async ({dir,state})=>{
  const item=state.imports.find(i=>i.hash!==state.imports[0].hash);
  const path=join(dir,'sources',item.hash+'.json');
  await writeFile(path,'{}');
  const proof=await readFinanceRegisterBindings(dir,state);
  assert.deepEqual(proof.bindings,{accounts:{},transactions:{}});assert.equal(proof.unavailableArchiveCount,1);
  const copy=structuredClone(state);copy.imports=[{...item,hash:'../outside'}];
  assert.equal((await readFinanceRegisterBindings(dir,copy)).unavailableArchiveCount,1);
}));
test('replayed import records do not duplicate identities',()=>fixture(async ({dir,state})=>{
  const copy={...state,imports:[...state.imports,...state.imports]};
  assert.deepEqual((await readFinanceRegisterBindings(dir,copy)).bindings,(await readFinanceRegisterBindings(dir,state)).bindings);
}));
