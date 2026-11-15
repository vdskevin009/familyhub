/** Read-only verification of private cloud captures against real FamilyHub stores. No provider client. */
import {parseNativeFinanceCsv} from './finance-cloud-native.js';
import {createHash} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {dailyFinanceDigest,financeScopeDigest,financeStages,durableExclusive,type DailyFinanceScope,type StageReport,type StageReceipt} from './finance-daily-gate.js';
import {assertScheduledAdmission,type ScheduledAdmission} from './finance-scheduled-bridge.js';
import {FinanceLibrary} from './finance-library.js';
import {FinanceSourceInventoryStore,financeSourceKey} from './finance-source-inventory-store.js';
import {FinanceSourceExpensesStore} from './finance-source-expenses-store.js';
import {prepareSourceExpenses,type SourceExpensesEvidence} from './finance-source-expenses-prepare.js';
import {validateFinanceSourceInventory} from './finance-source-inventory-model.js';
import {contributionsView,type ContributionsConfig} from './contributions-view.js';
import type {FinanceState} from './finance-model.js';
export type PrivateRef={path:string;sha256:string};
export type NativePage={response:RawCapture;resultIndex:number;export?:RawCapture & {sourceFileId:string}};
export type RawCapture={capture:PrivateRef;archive:PrivateRef};
export type FinanceCloudManifest={schema:1;attemptId:string;scopeDigest:string;baseline:PrivateRef;mapping:PrivateRef;linked:RawCapture;expenses:RawCapture;nativeTransactions:NativePage[];sections:{dataset:string;raw:RawCapture;nativePages:NativePage[]}[];inventory:PrivateRef};
export type CloudReadbackOptions={directory:string;evidenceDirectory:string;scope:DailyFinanceScope & {mappingDigest:string;accountPolicy: 'all-linked'};admission:ScheduledAdmission;clock?:()=>Date;get:(route:string)=>Promise<any>};
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const same=(a:unknown,b:unknown)=>dailyFinanceDigest(a)===dailyFinanceDigest(b);
const guard=(ok:unknown)=>{if(!ok)throw Error('Private cloud evidence/readback mismatch; no completion.');};
const requiredSections=['investment_holdings','investment_transactions','recurring_transactions','liabilities'];
const amount=(v:unknown)=>{guard(typeof v==='number'&&Number.isFinite(v));const n=Math.round((v as number)*100);guard(Number.isSafeInteger(n)&&Math.abs((v as number)*100-n)<0.000001);return n};
const time=(v:unknown)=>{guard(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v));const n=Date.parse(v as string);guard(Number.isFinite(n)&&new Date(n).toISOString()===(v as string).replace(/(?<!\.\d{3})Z$/,'.000Z'));return n};
async function refBytes(root:string,ref:PrivateRef){
 guard(ref&&typeof ref.path==='string'&&/^[a-f0-9]{64}$/.test(ref.sha256));
 const base=await realpath(root),file=await realpath(resolve(base,ref.path)),rel=relative(base,file);
 guard(rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)&&!rel.split(/[\\/]/).includes('.git'));
 guard((await stat(file)).size<=64*1024*1024);const bytes=await readFile(file);guard(bytes.length<=64*1024*1024&&sha(bytes)===ref.sha256);return bytes;
}
async function pairBytes(root:string,pair:RawCapture){const a=await refBytes(root,pair.capture),b=await refBytes(root,pair.archive);guard((await realpath(resolve(root,pair.capture.path)))!==(await realpath(resolve(root,pair.archive.path)))&&a.equals(b));return a}
async function rawPair(root:string,pair:RawCapture){return JSON.parse((await pairBytes(root,pair)).toString('utf8'))}
async function bindNativePages(root:string,batch:any,bindings:NativePage[],dataset:string){
 guard(Array.isArray(bindings)&&bindings.length===batch.pages.length);
 const hashes:string[]=[];
 for(const [i,binding] of bindings.entries()){
  const native=await rawPair(root,binding.response);guard(native.isError!==true&&Number.isSafeInteger(binding.resultIndex));
  const results=native.structuredContent?.results;guard(Array.isArray(results));
  const matches=results.filter((r:any)=>r.index===binding.resultIndex&&r.query_type===dataset);guard(matches.length===1&&matches[0].is_error===false);
  const result=matches[0].result,prepared=batch.pages[i].result;hashes.push(binding.response.archive.sha256);
  if(Array.isArray(result.items)){guard(!binding.export&&same(result,prepared));}
  else{
   guard(dataset==='transactions'&&binding.export&&result.file_id===binding.export!.sourceFileId&&Number.isSafeInteger(result.result_count));
   const bytes=await pairBytes(root,binding.export!),rows=parseNativeFinanceCsv(bytes.toString('utf8'));
   guard(rows.length===result.result_count&&same(rows,prepared.items));
   const {items,...metadata}=prepared;guard(same(metadata,result));hashes.push(binding.export!.archive.sha256);
  }
 }
 return hashes;
}
function coverage(c:any,dataset:string){return c?.dataset===dataset&&c.availability==='ready'&&['complete','full_history'].includes(c.state)&&c.is_complete_for_query===true&&Array.isArray(c.warning_codes)&&c.warning_codes.length===0}
function pagesComplete(batch:any,dataset:string,ids:string[],period:{from:string;through:string}){
 guard(batch?.query?.query_type===dataset&&Array.isArray(batch.pages)&&batch.pages.length>0);
 const q=batch.query;guard(Object.keys(q).every(k=>['query_type','account_id','date','include_transfers','limit','order_by_field','order_by_direction'].includes(k))&&q.account_id?.op==='in'&&Array.isArray(q.account_id.val)&&same([...q.account_id.val].sort(),[...ids].sort()));
 if(['transactions','investment_transactions'].includes(dataset))guard(q.date?.op==='between'&&same(q.date.val,[period.from,period.through]));
 let cursor:string|null=null,complete=true;const seen=new Set<string>();
 for(const [i,p] of batch.pages.entries()){const r=p.result;guard(p.requestCursor===cursor&&Array.isArray(r?.items)&&typeof r.has_more==='boolean');complete=complete&&coverage(r.coverage,dataset);if(r.has_more){guard(typeof r.next_cursor==='string'&&r.next_cursor&&!seen.has(r.next_cursor));cursor=r.next_cursor;seen.add(cursor!);if(i===batch.pages.length-1)complete=false;}else guard(r.next_cursor==null&&i===batch.pages.length-1)}
 return complete;
}
const protectedFacts=(state:FinanceState)=>{const copy=structuredClone(state);delete copy.data?.balanceObservations;const {revision,importedAt,imports,...rest}=copy;return rest};
function context(options:CloudReadbackOptions){
 const clock=options.clock??(()=>new Date());const check=()=>assertScheduledAdmission({...options,now:clock()},options.admission,'readback');
 const get=async(route:string)=>{await check();guard(['/finances','/finance/source-inventory','/finance/source-expenses','/contributions/progress'].includes(route));return options.get(route)};
 return {clock,check,get};
}
async function current(options:CloudReadbackOptions){
 const {clock,check,get}=context(options);await check();
 const ledger=await new FinanceLibrary(join(options.directory,'finances')).read();
 const inventory=await new FinanceSourceInventoryStore(options.directory).read(clock());
 const expenses=await new FinanceSourceExpensesStore(options.directory).read(clock());
 const config=JSON.parse(await readFile(join(options.directory,'contributions','config.json'),'utf8')) as ContributionsConfig;
 const apiLedger=await get('/finances'),apiInventory=await get('/finance/source-inventory'),apiExpenses=await get('/finance/source-expenses'),apiProgress=await get('/contributions/progress');
 guard(same(ledger,apiLedger)&&same(inventory,apiInventory.state)&&same(expenses,apiExpenses.state));
 const evaluatedOn=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
 const progress=contributionsView(ledger,config,evaluatedOn);guard(same(progress,apiProgress));await check();return {ledger,inventory,expenses,config,progress};
}
/** Baseline is a private local artifact, captured before collection/intake; never a production mutation. */
export async function saveCloudFinanceBaseline(options:CloudReadbackOptions){
 await assertScheduledAdmission({...options,now:(options.clock??(()=>new Date()))()},options.admission,'collect');
 const value={schema:1,attemptId:options.admission.attempt.id,scopeDigest:financeScopeDigest(options.scope),capturedAt:(options.clock??(()=>new Date()))().toISOString(),...(await current(options))};
 const path='baseline-'+options.admission.attempt.id+'.json',bytes=JSON.stringify(value);
 await durableExclusive(join(options.evidenceDirectory,path),bytes);
 guard((await readFile(join(options.evidenceDirectory,path),'utf8'))===bytes);return {path,sha256:sha(bytes)};
}
/** Reconstruct receipts from actual archives and independent GET/file readback. Caller receipts are never trusted. */
export async function produceCloudFinanceReport(options:CloudReadbackOptions,manifestInput:FinanceCloudManifest):Promise<StageReport>{
 const manifest=structuredClone(manifestInput),{clock,check}=context(options);await check();
 guard(manifest.schema===1&&manifest.attemptId===options.admission.attempt.id&&manifest.scopeDigest===financeScopeDigest(options.scope)&&manifest.baseline.path==='baseline-'+manifest.attemptId+'.json');
 const root=options.evidenceDirectory,base=JSON.parse((await refBytes(root,manifest.baseline)).toString('utf8'));
 guard(base.schema===1&&base.attemptId===manifest.attemptId&&base.scopeDigest===manifest.scopeDigest&&time(base.capturedAt)>=time(options.admission.attempt.startedAt));
 const mapping=JSON.parse((await refBytes(root,manifest.mapping)).toString('utf8')) as Record<string,string>;
 guard(manifest.mapping.sha256===options.scope.mappingDigest&&Object.keys(mapping).every(k=>/^fsi_[a-f0-9]{64}$/.test(k))&&Object.values(mapping).every(v=>typeof v==='string'&&v)&&new Set(Object.values(mapping)).size===Object.values(mapping).length);
 const linked=await rawPair(root,manifest.linked),expensesInput=await rawPair(root,manifest.expenses) as SourceExpensesEvidence;
 const captureTime=(v:any)=>{guard(time(v.collectedAt)>=time(base.capturedAt)&&time(v.collectedAt)<=clock().getTime()&&time(v.collectedAt)<=time(options.admission.expiresAt));};
 captureTime(linked);captureTime(expensesInput);guard(linked.rawLinkedAccounts?.isError!==true);
 const linkedBody=linked.rawLinkedAccounts?.structuredContent;guard(Array.isArray(linkedBody?.institutions));
 const accounts=linkedBody.institutions.flatMap((i:any)=>{guard(Array.isArray(i.accounts));return i.accounts}).concat(linkedBody.manual_accounts??[]);
 guard(accounts.length>0&&accounts.length<=100);
 const byKey=new Map<string,any>();for(const a of accounts){const k=financeSourceKey('account',a.item_id,a.account_id);guard(!byKey.has(k));byKey.set(k,a)}
 const keys=[...byKey.keys()].sort(),ids=[...new Set(accounts.map((a:any)=>a.account_id))].sort() as string[];
 guard(options.scope.accountPolicy==='all-linked');
 for(const stage of ['accounts','balances','transactions'] as const)guard(same(options.scope.subjects[stage],['all-linked-source-universe']));
 guard(same([...options.scope.subjects.collection].sort(),['accounts','transactions',...requiredSections].sort())&&options.scope.periods.length===1);
 guard(Object.values(mapping).every(id=>base.ledger.data?.accounts.some((a:any)=>a.id===id)));
 guard(same(expensesInput.accounts.map(a=>financeSourceKey('account',a.item_id,a.account_id)).sort(),keys));
 guard(expensesInput.transactions?.query?.select_fields===undefined);
 const nativeHashes=await bindNativePages(root,expensesInput.transactions,manifest.nativeTransactions,'transactions');
 const expenseSnapshot=prepareSourceExpenses(expensesInput,clock());guard(same(expenseSnapshot.query.accountSourceKeys,keys));
 let txComplete=pagesComplete(expensesInput.transactions,'transactions',ids,options.scope.periods[0])&&expenseSnapshot.coverage.complete;
 const sectionStates=new Map<string,boolean>(),sectionSources=new Map<string,any>();guard(manifest.sections.length===requiredSections.length&&new Set(manifest.sections.map(s=>s.dataset)).size===requiredSections.length);
 for(const entry of manifest.sections){guard(requiredSections.includes(entry.dataset));const value=await rawPair(root,entry.raw);captureTime(value);nativeHashes.push(...await bindNativePages(root,value,entry.nativePages,entry.dataset));sectionStates.set(entry.dataset,pagesComplete(value,entry.dataset,ids,options.scope.periods[0]));sectionSources.set(entry.dataset,value);}
 const state=await current(options);guard(same(protectedFacts(base.ledger),protectedFacts(state.ledger))&&same(base.config,state.config)&&base.ledger.imports.every((x:any)=>state.ledger.imports.some(y=>same(x,y))));
 guard((base.ledger.data?.balanceObservations??[]).every((row:any)=>(state.ledger.data?.balanceObservations??[]).some(current=>same(row,current))));
 guard(base.expenses.snapshots.every((x:any)=>state.expenses.snapshots.some(y=>same(x,y)))&&state.expenses.snapshots.some(s=>same(s,expenseSnapshot)));
 const inventory=validateFinanceSourceInventory(JSON.parse((await refBytes(root,manifest.inventory)).toString('utf8')),clock());guard(same(inventory,state.inventory.snapshot)&&time(inventory.collectedAt)>=time(base.capturedAt));
 guard(same(inventory.accounts.map(a=>a.sourceKey).sort(),keys.filter(k=>!Object.hasOwn(mapping,k))));
  const expectedCapture=Math.max(time(linked.collectedAt),...[...sectionSources.values()].map(v=>time(v.collectedAt)));
 guard(time(inventory.collectedAt)===expectedCapture);
 const enumerationComplete=linkedBody.institutions.every((i:any)=>coverage(i.account_coverage,'accounts'))&&!(linkedBody.manual_accounts?.length);
 const mappedCurrent=keys.some(k=>Object.hasOwn(mapping,k));
 const expectedAccountsAvailability={status:enumerationComplete?(mappedCurrent?'partial':'available'):'unavailable',coverage:enumerationComplete?(mappedCurrent?'partial':'complete'):'unknown',observedCount:inventory.accounts.length};
 guard(same(inventory.availability.accounts,expectedAccountsAvailability));
 let inventorySemanticsComplete=true;
 for(const [dataset,field] of [['investment_holdings','holdings'],['investment_transactions','activity'],['recurring_transactions','recurring'],['liabilities','liabilities']] as const){
  const native=sectionSources.get(dataset),count=native.pages.reduce((n:number,p:any)=>n+p.result.items.length,0),complete=sectionStates.get(dataset)===true;
  const partial=!complete&&native.pages.some((p:any)=>p.result.coverage?.availability==='ready'&&p.result.coverage?.is_complete_for_query===false);
  guard(same(inventory.availability[field],{status:complete?'available':partial?'partial':'unavailable',coverage:complete?'complete':partial?'partial':'unknown',observedCount:count}));
 }
 const recurring=sectionSources.get('recurring_transactions'),recurringCount=recurring.pages.reduce((n:number,p:any)=>n+p.result.items.length,0);
 if(sectionStates.get('recurring_transactions')&&recurringCount===0)guard(inventory.predictions.length===0);
 else{guard(same(inventory.predictions,base.inventory.snapshot?.predictions??[]));inventorySemanticsComplete=false;}
 let balancesComplete=true;
 for(const [key,a] of byKey){
  const balance=a.balances;const known=balance&&typeof balance.current==='number'&&Number.isFinite(balance.current)&&typeof balance.iso_currency_code==='string';
  if(!known)balancesComplete=false;
  if(Object.hasOwn(mapping,key)){
   guard(state.ledger.data?.accounts.some(row=>row.id===mapping[key]));
   if(known)guard(state.ledger.data?.balanceObservations?.some(row=>row.accountId===mapping[key]&&row.balanceCents===amount(balance.current)&&row.currency===balance.iso_currency_code&&row.capturedAt===linked.collectedAt&&row.sourceAsOf===null&&row.source.sha256===manifest.linked.capture.sha256));
  }else{
      const row=inventory.accounts.find(row=>row.sourceKey===key)!;guard(row.name===a.name);
   const owner=linkedBody.institutions.find((i:any)=>i.accounts.some((r:any)=>r.item_id===a.item_id&&r.account_id===a.account_id));
   const sourceInstitution=typeof owner?.institution?.name==='string'?owner.institution.name:null;
   const sourceKind=['depository','credit','investment','loan','other'].includes(a.type)?a.type:'unknown';
   guard(row.kind===sourceKind&&row.institution===sourceInstitution);
   const liabilities=sectionSources.get('liabilities'),liabilityCount=liabilities.pages.reduce((n:number,p:any)=>n+p.result.items.length,0);
   if(row.kind!=='credit'||sectionStates.get('liabilities')&&liabilityCount===0)guard(row.credit===null);
   else{const prior=base.inventory.snapshot?.accounts.find((r:any)=>r.sourceKey===key);guard(same(row.credit,prior?.credit??null));inventorySemanticsComplete=false;}
   if(known)guard(row.balance?.amountCents===amount(balance.current)&&row.balance.currency===balance.iso_currency_code&&row.balance.sourceAsOf===null);else guard(row.balance===null);
  }
 }
 guard(state.config.plans.every(plan=>options.scope.periods[0].from<=plan.from&&options.scope.periods[0].through>=(plan.through<state.progress.evaluatedOn?plan.through:state.progress.evaluatedOn)));
 // The live projection is independently recomputed; no configuration attribution is changed.
 guard(same(state.config.plans.map(p=>p.id).sort(),[...options.scope.subjects.contributions].sort()));
 const evidence=[...nativeHashes,manifest.baseline.sha256,manifest.mapping.sha256,manifest.linked.archive.sha256,manifest.expenses.archive.sha256,manifest.inventory.sha256,...manifest.sections.map(s=>s.raw.archive.sha256),dailyFinanceDigest(state)];
 const accountsComplete=enumerationComplete&&inventorySemanticsComplete;
 const collectionComplete=accountsComplete&&txComplete&&[...sectionStates.values()].every(Boolean);
 const statuses={collection:collectionComplete,accounts:accountsComplete,balances:balancesComplete&&enumerationComplete,transactions:txComplete,contributions:txComplete};
 const receipts:StageReceipt[]=financeStages.map(stage=>{const subjects=options.scope.subjects[stage],retain=stage==='contributions'||stage==='transactions';const payload={schema:1 as const,stage,attemptId:options.admission.attempt.id,localDate:options.admission.attempt.localDate,scopeDigest:manifest.scopeDigest,status:statuses[stage]?'confirmed' as const:'partial' as const,...(!inventorySemanticsComplete&&['accounts','collection'].includes(stage)?{verificationLimits:['Nonempty credit or recurring fields are preserved from baseline but not independently source-derived; stage remains partial.']} : {}),confirmedSubjectIds:retain?[]:[...subjects],...(retain?{retainedUnassigned:subjects.map(subjectId=>({subjectId,evidenceDigests:evidence,sourceNative:true as const,persisted:true as const,readbackVerified:true as const,limits:['Complete raw source retained separately; canonical attribution and existing Contributions configuration remain unchanged. CSV blank cells cannot distinguish absent, null and empty source values; original bytes and envelope are preserved.']}))}:{}),evidenceDigests:evidence,withheldCount:statuses[stage]?0:1,uncertainWrite:false,sourceFreshness:'unknown' as const,sourceAsOf:null};return {payload,digest:dailyFinanceDigest(payload)}});
 await check();return {writeOutcome:'confirmed',receipts};
}
export function cloudFinanceVerifiers(options:CloudReadbackOptions,loadManifest:()=>Promise<FinanceCloudManifest>){
 return {
  verifyReceiptReadOnly:async(receipt:StageReceipt)=>{const actual=await produceCloudFinanceReport(options,await loadManifest());return actual.receipts.some(r=>same(r,receipt))},
  verifyOutcomeReadOnly:async(report:StageReport)=>same(await produceCloudFinanceReport(options,await loadManifest()),report)
 };
}
