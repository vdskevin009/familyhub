import {mkdir,readFile,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {dailyFinanceDigest,durableExclusive,readState} from './finance-daily-gate.js';
import {assertScheduledAdmission,journalScheduledIntent} from './finance-scheduled-bridge.js';
import {loadCloudIntakePlan,type CloudReadbackOptions,type FinanceCloudManifest} from './finance-cloud-readback.js';
import {parseFinancePreparation} from './finance-import.js';
import {accountCaptureId,legacyInventoryCapture} from './finance-account-captures-store.js';
import {validateFinanceSourceInventory} from './finance-source-inventory-model.js';
import {validateSourceExpenses} from './finance-source-expenses-model.js';
import {validateFinanceAccountCaptureSnapshot} from './finance-account-captures-model.js';
type Kind='balances'|'inventory'|'expenses'|'account-captures';
type State={ledger:any;inventory:any;expenses:any;accountCaptures:any;config:any};
type Plan=Awaited<ReturnType<typeof loadCloudIntakePlan>>;
type Intent={schema:1;attemptId:string;planDigest:string;kind:Kind;payloadDigest:string;expectedRevision:string;beforeTarget:any;preview:any};
export class FinanceIntakeRecovery extends Error {constructor(public code:string,public step?:Kind){super(code)}}
const fail=(code:string,step?:Kind):never=>{throw new FinanceIntakeRecovery(code,step)};
const same=(a:any,b:any)=>dailyFinanceDigest(a)===dailyFinanceDigest(b),sha=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const target=(state:State,k:Kind)=>k==='balances'?state.ledger:k==='account-captures'?state.accountCaptures:state[k];
const route=(k:Kind)=>k==='balances'?'/finances/import':k==='account-captures'?'/finance/account-captures':'/finance/source-'+k;
const capability=(k:Kind)=>k==='balances'?'finance-balance-observations-v1':k==='account-captures'?'finance-account-captures-v1':'finance-source-'+k+'-v1';
const kinds:Kind[]=['balances','inventory','expenses','account-captures'];
const payload=(plan:Plan,k:Kind)=>k==='account-captures'?plan.accountCapture:plan[k];
const protectedLedger=(state:any)=>{const v=structuredClone(state);delete v.data?.balanceObservations;const {revision,importedAt,imports,...rest}=v;return rest};
function captureState(captures:any[]){const sorted=[...captures].sort((a,b)=>a.snapshot.collectedAt.localeCompare(b.snapshot.collectedAt)||a.id.localeCompare(b.id));return {revision:sorted.length?sha(sorted):'empty',captures:sorted}}
function expectedExpenses(plan:Plan){const snapshots=structuredClone(plan.baseline.expenses.snapshots);if(!snapshots.some((s:any)=>same(s,plan.expenses)))snapshots.push(plan.expenses);return {revision:snapshots.length?sha(snapshots):'empty',snapshots}}
function expectedObservations(plan:Plan){const rows=structuredClone(plan.baseline.ledger.data.balanceObservations??[]);for(const row of plan.balances?parseFinancePreparation(plan.balances).balanceObservations??[]:[]){const old=rows.find((r:any)=>r.accountId===row.accountId&&Date.parse(r.capturedAt)===Date.parse(row.capturedAt));if(old){if(!same(old,row))fail('observation-conflict','balances')}else rows.push(row)}return rows}
function applied(plan:Plan,state:State,k:Kind){
 if(k==='balances')return plan.balances===null||state.ledger.imports.some((r:any)=>r.hash===sha(plan.balances))&&same(state.ledger.data.balanceObservations??[],expectedObservations(plan));
 if(k==='inventory')return same(state.inventory,{revision:sha(plan.inventory),snapshot:plan.inventory});
 if(k==='expenses')return same(state.expenses,expectedExpenses(plan));
 return state.accountCaptures.captures.some((c:any)=>c.origin==='source-capture'&&c.id===accountCaptureId('source-capture',plan.accountCapture)&&same(c.snapshot,plan.accountCapture));
}
/** Exact preservation algebra permits only this plan's own later intents, including inventory's legacy append. */
export function verifyComposedFinanceIntakeState(plan:Plan,state:State,intents:Partial<Record<Kind,Intent>>,now=new Date()){
 const base=plan.baseline;
 if(!same(state.config,base.config)||!same(protectedLedger(state.ledger),protectedLedger(base.ledger)))fail('canonical-or-config-drift');
 if(!same(state.ledger,base.ledger)){
  if(!intents.balances||!applied(plan,state,'balances'))fail('unexplained-ledger-change','balances');
  if(!base.ledger.imports.every((old:any)=>state.ledger.imports.some((r:any)=>same(r,old))))fail('import-history-loss','balances');
  const extra=state.ledger.imports.filter((r:any)=>!base.ledger.imports.some((old:any)=>same(r,old)));
  if(extra.length>1||extra.some((r:any)=>r.hash!==sha(plan.balances)||r.added!==0))fail('unexplained-import','balances');
 }
 if(!same(state.inventory,base.inventory)&&(!intents.inventory||!applied(plan,state,'inventory')))fail('unexplained-inventory-change','inventory');
 if(!same(state.expenses,base.expenses)&&(!intents.expenses||!applied(plan,state,'expenses')))fail('unexplained-expense-change','expenses');
 const expected=structuredClone(base.accountCaptures.captures);
 if(state.inventory.snapshot){const legacy=legacyInventoryCapture(state.inventory.snapshot,now);if(!expected.some((c:any)=>c.id===legacy.id)){if(!intents.inventory||!applied(plan,state,'inventory'))fail('unexplained-legacy-append','inventory');expected.push(legacy)}}
 const fresh={id:accountCaptureId('source-capture',plan.accountCapture),origin:'source-capture',snapshot:plan.accountCapture};
 const allowedWithout=captureState(expected);
 if(intents['account-captures']&&!expected.some((c:any)=>c.id===fresh.id))expected.push(fresh);
 if(!same(state.accountCaptures,allowedWithout)&&!same(state.accountCaptures,captureState(expected)))fail('account-history-drift','account-captures');
}
export type FinanceIntakeControllerOptions=CloudReadbackOptions & {manifest:FinanceCloudManifest;apply?:boolean;post:(route:string,body:unknown)=>Promise<any>;checkpoint?:(phase:string)=>Promise<void>};
export async function runFinanceIntakeController(input:FinanceIntakeControllerOptions){
 const options={...input,scope:structuredClone(input.scope),admission:structuredClone(input.admission),manifest:structuredClone(input.manifest)},clock=options.clock??(()=>new Date());
 const plan=await loadCloudIntakePlan(options,options.manifest),planDigest=dailyFinanceDigest(plan),baseDir=join(options.directory,'finance-feed','daily-gate'),dir=join(baseDir,'controller-'+plan.attemptId);
 const proofName='intake-complete-'+dailyFinanceDigest(options.admission)+'.json',proofPath=join(dir,proofName);
 const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
 const exists=async(p:string)=>{try{await readFile(p);return true}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e}};
 const sealed=async(name:string,value:any)=>{const body={value,digest:dailyFinanceDigest(value)},bytes=JSON.stringify(body),p=join(dir,name);try{await durableExclusive(p,bytes)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(p,'utf8')!==bytes)throw e}if(await readFile(p,'utf8')!==bytes)fail('journal-readback-failed');};
 const unseal=async(p:string)=>{const v=await json(p);if(v.digest!==dailyFinanceDigest(v.value))fail('journal-digest-mismatch');return v.value};
 // Only an exact prior controller proof AND actual finalized gate admission allow a local-only replay.
 const gate=await readState(join(baseDir,'state.json')),day=gate.days[options.admission.attempt.localDate];
 if(day?.status==='complete'&&day.attemptId===plan.attemptId){
  const savedAdmission=await json(join(baseDir,'admission-'+dailyFinanceDigest(options.admission.token)+'.json')),proof=await unseal(proofPath);
  if(!same(savedAdmission,options.admission)||proof.planDigest!==planDigest||proof.attemptId!==plan.attemptId||proof.admissionDigest!==dailyFinanceDigest(options.admission))fail('completed-replay-proof-mismatch');
  return {status:'already-finalized-local',intakeConfirmed:true,globalComplete:false,apiCalls:0};
 }
 if(day?.status==='partial'&&day.attemptId===plan.attemptId&&!gate.pending)fail('attempt-finalized-partial-new-admission-required');
 const check=(op:'collect'|'readback')=>assertScheduledAdmission({...options,now:clock()},options.admission,op);await check('readback');
 await mkdir(dir,{recursive:true});const lockPath=join(dir,'controller.lock');let lock;
 try{lock=await open(lockPath,'wx',0o600)}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')fail('controller-locked-operator-review');throw e}
 try{
  await lock.writeFile(JSON.stringify({attemptId:plan.attemptId,planDigest,createdAt:clock().toISOString()}));await lock.sync();
  const apiGet=async(p:string)=>{await check('readback');return options.get(p)};
  const apiPost=async(k:Kind,body:unknown)=>{await check('collect');return options.post(route(k),body)};
  async function snapshot():Promise<State>{
   const ledger=await apiGet('/finances'),inventory=await apiGet('/finance/source-inventory'),expenses=await apiGet('/finance/source-expenses'),accountCaptures=await apiGet('/finance/account-captures');
   if(inventory.capability!==capability('inventory')||expenses.capability!==capability('expenses')||accountCaptures.capability!==capability('account-captures'))fail('required-capability-absent');
   await check('readback');const config=await json(join(options.directory,'contributions','config.json'));
   return {ledger,inventory:inventory.state,expenses:expenses.state,accountCaptures:accountCaptures.state,config};
  }
  const intents:Partial<Record<Kind,Intent>>={};
  for(const kind of kinds){const p=join(dir,'intent-'+kind+'.json'),shared=join(baseDir,'intent-'+dailyFinanceDigest({attemptId:plan.attemptId,operationId:'four-target-'+kind})+'.json');
   if(await exists(p)){const intent=await unseal(p);if(intent.attemptId!==plan.attemptId||intent.planDigest!==planDigest||intent.payloadDigest!==dailyFinanceDigest(payload(plan,kind))||intent.kind!==kind)fail('intent-binding-mismatch',kind);intents[kind]=intent}
   else if(await exists(shared))fail('shared-intent-without-controller-proof',kind);
  }
  const bindingPath=join(dir,'preview-binding.json');
  if(options.apply){const binding=await unseal(bindingPath);if(binding.planDigest!==planDigest||binding.attemptId!==plan.attemptId||binding.scopeDigest!==plan.scopeDigest)fail('reviewed-preview-required')}
  const outcomes:{step:Kind;status:string}[]=[];
  for(const kind of kinds){
   const current=await snapshot();verifyComposedFinanceIntakeState(plan,current,intents,clock());
   if(intents[kind]){
    if(applied(plan,current,kind)){await sealed('confirmed-'+kind+'-'+dailyFinanceDigest(target(current,kind))+'.json',{attemptId:plan.attemptId,planDigest,kind,targetDigest:dailyFinanceDigest(target(current,kind))});outcomes.push({step:kind,status:'confirmed-readback-only'});continue}
    if(same(target(current,kind),intents[kind]!.beforeTarget)){await sealed('not-applied-'+kind+'.json',{attemptId:plan.attemptId,planDigest,kind,boundRevision:intents[kind]!.expectedRevision,beforeDigest:dailyFinanceDigest(intents[kind]!.beforeTarget)});return {status:'not-applied-readback-only',step:kind,intakeConfirmed:false,globalComplete:false};}
    fail('uncertain-target-requires-readback-review',kind);
   }
   if(kind==='balances'&&plan.balances===null){outcomes.push({step:kind,status:'no-mapped-balance-target'});continue}
   if(options.admission.action==='recover')return {status:'recovery-only-no-new-intake',step:kind,intakeConfirmed:false,globalComplete:false};
   const expectedRevision=target(current,kind).revision,body=kind==='balances'?{bundle:plan.balances,apply:false}:{capability:capability(kind),snapshot:payload(plan,kind),expectedRevision,apply:false};
   // The nonmutating preview POST is also recorded first, but never grants apply permission.
   await sealed('preview-request-'+kind+'-'+dailyFinanceDigest(body)+'.json',{attemptId:plan.attemptId,planDigest,kind,body});
   const preview=await apiPost(kind,body);
   if(kind==='balances'){
    if(preview.added!==0||preview.possibleDuplicates!==0||(preview.alreadyImported?preview.state?.revision:preview.revision)!==expectedRevision||(!preview.alreadyImported&&(preview.capability!==capability(kind)||preview.accounts!==plan.balances!.accounts.length||preview.balanceObservations!==plan.balances!.balanceObservations.length)))fail('balance-preview-mismatch',kind);
   }else if(kind==='account-captures'){
    const capture={id:accountCaptureId('source-capture',plan.accountCapture),origin:'source-capture',snapshot:plan.accountCapture},next=[...current.accountCaptures.captures];if(!next.some(c=>c.id===capture.id))next.push(capture);
    if(preview.applied!==false||preview.capability!==capability(kind)||preview.expectedRevision!==expectedRevision||!same(preview.capture,capture)||preview.proposedRevision!==captureState(next).revision)fail('capture-preview-history-mismatch',kind);
   }else{
    const expected=kind==='inventory'?{revision:sha(plan.inventory),snapshot:plan.inventory}:expectedExpenses(plan);
    if(preview.applied!==false||preview.capability!==capability(kind)||preview.expectedRevision!==expectedRevision||!same(preview.snapshot,payload(plan,kind))||preview.proposedRevision!==expected.revision)fail('source-preview-mismatch',kind);
   }
   await sealed('preview-result-'+kind+'-'+dailyFinanceDigest({body,preview})+'.json',{attemptId:plan.attemptId,planDigest,kind,body,preview});
   if(!options.apply){outcomes.push({step:kind,status:'preview-passed'});continue}
   const ready=await snapshot();verifyComposedFinanceIntakeState(plan,ready,intents,clock());if(!same(ready,current))fail('pre-apply-concurrent-change',kind);
   const intent:Intent={schema:1,attemptId:plan.attemptId,planDigest,kind,payloadDigest:dailyFinanceDigest(payload(plan,kind)),expectedRevision,beforeTarget:target(current,kind),preview};
   await sealed('intent-'+kind+'.json',intent);intents[kind]=intent;
   await journalScheduledIntent({...options,now:clock()},options.admission,{operationId:'four-target-'+kind,kind,payloadDigest:intent.payloadDigest,expectedRevision,readbackLocator:kind==='balances'?'/finances':route(kind)});
   await options.checkpoint?.('before-post:'+kind);
   if(!preview.alreadyImported){try{await apiPost(kind,kind==='balances'?{bundle:plan.balances,apply:true,expectedRevision}:{...body,apply:true})}catch{/* Never resend. The only possible next operation is an admitted GET. */}}
   await options.checkpoint?.('after-post:'+kind);
   const after=await snapshot();verifyComposedFinanceIntakeState(plan,after,intents,clock());
   if(!applied(plan,after,kind))fail('apply-outcome-unconfirmed-no-replay',kind);
   await sealed('confirmed-'+kind+'-'+dailyFinanceDigest(target(after,kind))+'.json',{attemptId:plan.attemptId,planDigest,kind,targetDigest:dailyFinanceDigest(target(after,kind))});outcomes.push({step:kind,status:'confirmed'});
  }
  if(!options.apply&&options.admission.action!=='recover'){await sealed('preview-binding.json',{schema:1,attemptId:plan.attemptId,scopeDigest:plan.scopeDigest,planDigest});return {status:'preview-passed',outcomes,intakeConfirmed:false,globalComplete:false}}
  const final=await snapshot();verifyComposedFinanceIntakeState(plan,final,intents,clock());if(!kinds.every(k=>applied(plan,final,k)))fail('composed-final-state-incomplete');
  await sealed(proofName,{schema:1,attemptId:plan.attemptId,planDigest,admissionDigest:dailyFinanceDigest(options.admission),stateDigest:dailyFinanceDigest(final),targetDigests:Object.fromEntries(kinds.map(k=>[k,dailyFinanceDigest(target(final,k))]))});
  return {status:'intake-confirmed',outcomes,intakeConfirmed:true,globalComplete:false};
 }finally{await lock.close();await unlink(lockPath)}
}
