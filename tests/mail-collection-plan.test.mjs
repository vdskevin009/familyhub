import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { planInvoiceMail, planGroceryMail, invoiceHistoryVersion, healthReceiptRepairVersion, upgradeCandidates, retryCandidates } from '../apps/worker/dist/mail-collection-plan.js';
import { legacyMailSource } from '../apps/worker/dist/mail-source.js';
import { preparedPluginMailSource } from '../apps/worker/dist/prepared-plugin-mail-source.js';
import { GroceryCollection } from '../apps/worker/dist/grocery-collection.js';
const account={email:'synthetic@example.test',label:'Synthetic'},at=1793534400;
const raw=id=>({id,threadId:'thread',internalDate:String(at*1000),labelIds:[],payload:{mimeType:'text/plain',headers:[{name:'From',value:'other@example.test'},{name:'Subject',value:'Not a PC Express order'}],body:{size:0,data:''}}});
const source=(plan,pages=[{messageIds:[]}],messages=[])=>preparedPluginMailSource([{account,batch:{schema:1,account:account.email,messages,attachments:[],queries:[{q:plan.request.q,maxResults:plan.request.maxResults,complete:true,pages}]}}]);
const forbidden=async()=>{throw new Error('No legacy credentials or network');};
const store={importDeliveredConfirmation:async()=>{throw new Error('No purchase expected');}};
async function directory(t){const d=await mkdtemp(join(tmpdir(),'familyhub-plugin-plan-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}

test('invoice integration uses real collectors in an isolated private directory',async t=>{
 const d=await directory(t);const result=spawnSync(process.execPath,['tests/fixtures/plugin-collection-runner.mjs'],{cwd:process.cwd(),env:{...process.env,FAMILYHUB_WORKER_DATA:d},encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);
});

test('plans are immutable source snapshots, preserve existing windows and expose conditional stages',()=>{
 const progress={window:{after:1,before:at,page:'old-cursor'},invoiceHistoryWindow:{after:2,before:at-1,page:'history'},healthReceiptRepairPage:'stale-repair',healthReceiptRepairTargetVersion:0};
 const before=structuredClone(progress), plan=planInvoiceMail(progress,[],account.email,at+50);
 assert.deepEqual(progress,before);assert.deepEqual(plan.window,progress.window);assert.equal(plan.repair.request.pageToken,undefined);assert.equal(plan.history.request.pageToken,'history');assert.equal(plan.history.afterIncrementalComplete,true);assert.ok(Object.isFrozen(plan.history.window));
 progress.window.after=8;assert.equal(plan.window.after,1);assert.notEqual(plan.fingerprint,planInvoiceMail(progress,[],account.email,at+50).fingerprint);
 assert.equal(planGroceryMail({},account.email,at).window.after,at-30*86400);
 assert.equal(planInvoiceMail({},[],account.email,at).window.after,at-32*86400);
});

test('retry and upgrade plans preserve existing budgets, ordering and independent history gates',()=>{
 const items=Array.from({length:40},(_,i)=>({AccountEmail:account.email,SourceMessageId:String(i),AnalysisVersion:1,ClassificationSource:'unavailable'}));
 assert.equal(upgradeCandidates(items,account.email).length,25);assert.equal(retryCandidates(items,account.email).length,10);
 const plan=planInvoiceMail({invoiceHistoryVersion,healthReceiptRepairVersion},items,account.email,at);
 assert.deepEqual(plan.upgradeMessageIds,items.slice(0,25).map(item=>item.SourceMessageId));assert.equal(plan.history,undefined);assert.equal(plan.repair,undefined);assert.equal(plan.retryMessageIds.length,35);assert.equal(plan.retryReadBudget,10);
 assert.deepEqual(planInvoiceMail({},items,account.email,at).upgradeMessageIds,[]);
});

test('legacy source keeps secret fields out of account identity and refreshes its own token',async()=>{
 let clock=0,auth=0;const calls=[];const original={...account,clientId:'synthetic',clientSecret:'synthetic',refreshToken:'synthetic'};
 const source=legacyMailSource({credentials:async()=>({accounts:[original]}),accessToken:async value=>{assert.equal(value,original);return `token${++auth}`;},gmail:async(token,path)=>{calls.push([token,path]);return {};}},()=>clock);
 assert.deepEqual(await source.accounts(),[account]);const session=await source.open(account);await session.read('messages?x');clock=51*60*1000;await session.read('messages?y');assert.deepEqual(calls,[['token1','messages?x'],['token2','messages?y']]);
 await assert.rejects(source.open({...account,email:'other@example.test'}));
});

test('prepared sources reject duplicate accounts and preflight missing requests without network',async()=>{
 const plan=planGroceryMail({},account.email,at),s=source(plan);assert.deepEqual(await s.accounts(),[account]);await assert.rejects(s.preflight(account,['messages/missing?format=full']));await assert.rejects(s.open({...account,label:'wrong'}));
 const entry={account,batch:{schema:1,account:account.email,messages:[],attachments:[],queries:[]}};assert.throws(()=>preparedPluginMailSource([entry,entry]));
});

test('grocery plan is read-only, missing/stale plan writes nothing, delayed execution uses frozen time',async t=>{
 const d=await directory(t),base={credentials:forbidden,accessToken:forbidden,gmail:forbidden,now:()=>new Date((at+3600)*1000)};
 const plan=await new GroceryCollection(d,store,base).plan(account.email,at);assert.deepEqual(await readdir(d),[]);
 await assert.rejects(new GroceryCollection(d,store,{...base,source:source(plan)}).collect());assert.deepEqual(await readdir(d),[]);
 const stale=structuredClone(plan);stale.at++;await assert.rejects(new GroceryCollection(d,store,{...base,source:source(plan),plans:[stale]}).collect());assert.deepEqual(await readdir(d),[]);
 const status=await new GroceryCollection(d,store,{...base,source:source(plan),plans:[plan]}).collect();assert.equal(status.accounts[0].through,at);assert.equal(status.incomplete,false);
 const before=await readFile(join(d,'collection-status.json'),'utf8');await assert.rejects(new GroceryCollection(d,store,{...base,source:source(plan),plans:[plan]}).collect());assert.equal(await readFile(join(d,'collection-status.json'),'utf8'),before);
});

test('grocery bounded pages resume plugin cursors and preserve through on runtime failure',async t=>{
 const d=await directory(t),base={credentials:forbidden,accessToken:forbidden,gmail:forbidden,now:()=>new Date(at*1000)};
 const plan=await new GroceryCollection(d,store,base).plan(account.email,at);
 const pages=[{messageIds:[],nextPageToken:'p2'},{pageToken:'p2',messageIds:[],nextPageToken:'p3'},{pageToken:'p3',messageIds:[]}];
 let status=await new GroceryCollection(d,store,{...base,source:source(plan,pages),plans:[plan]}).collect();assert.equal(status.incomplete,true);assert.equal(status.accounts[0].through,undefined);
 const resume=await new GroceryCollection(d,store,base).plan(account.email,at+200);assert.equal(resume.request.pageToken,'p3');
 status=await new GroceryCollection(d,store,{...base,source:source(resume,pages),plans:[resume]}).collect();assert.equal(status.incomplete,false);assert.equal(status.accounts[0].through,at);
 const failPlan=await new GroceryCollection(d,store,base).plan(account.email,at+300),good=source(failPlan,[{messageIds:['abcd']}],[raw('abcd')]);
 const broken={...good,open:async()=>({read:async()=>{throw new Error('Synthetic unavailable');}})};
 status=await new GroceryCollection(d,store,{...base,source:broken,plans:[failPlan]}).collect();assert.equal(status.accounts[0].through,at);assert.equal(status.accounts[0].window.before,at+300);assert.equal(status.accounts[0].error,'gmail-unavailable');
 const path=join(d,'collection-status.json'),saved=JSON.parse(await readFile(path,'utf8'));saved.accounts[account.email].window.page='foreign';delete saved.accounts[account.email].transport;await writeFile(path,JSON.stringify(saved));
 const foreign=await new GroceryCollection(d,store,base).plan(account.email,at+400),before=await readFile(path,'utf8');await assert.rejects(new GroceryCollection(d,store,{...base,source:source(foreign,[{messageIds:[],nextPageToken:'foreign'},{pageToken:'foreign',messageIds:[]}]),plans:[foreign]}).collect());assert.equal(await readFile(path,'utf8'),before);
});
