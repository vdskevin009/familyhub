import {assertInferencePolicyPin} from './finance-inference-pin.js';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,unlink,access} from 'node:fs/promises';
import {join} from 'node:path';
import {dailyFinanceDigest,financeScopeDigest,decideDailyFinance,vancouverFinanceTime,financeStages,validateReceipt,readState,durableExclusive,replace} from './finance-daily-gate.js';
import type {DailyFinanceScope,FinanceAttempt,StageReport,FinanceGateCallbacks} from './finance-daily-gate.js';
export type ScheduledAdmission={schema:1|2; reservationProtocol?:'preoperation-v1'; mode:'scheduled'; token:string; action:'collect'|'recover'; admittedDay:string; invocationStartedAt:string; expiresAt:string; attempt:FinanceAttempt; stateDigest:string; scopeDigest:string};
type Input={directory:string;scope:DailyFinanceScope;now?:Date};
const paths=(directory:string)=>{const dir=join(directory,'finance-feed','daily-gate');return {dir,state:join(dir,'state.json'),lease:join(dir,'lease.lock'),finalizer:join(dir,'finalize.lock')}};
/** LOCAL ONLY. No adapter imports, provider calls, health checks or manual reset. */
export async function beginScheduledFinance(input:Input){
 await assertInferencePolicyPin(input.directory,input.scope.inferencePolicySha256);
 const p=paths(input.directory),scope=structuredClone(input.scope),digest=financeScopeDigest(scope),now=input.now??new Date();
 await mkdir(p.dir,{recursive:true});
 const token=randomBytes(32).toString('hex');
 try{await durableExclusive(p.lease,JSON.stringify({schema:1,bridge:true,tokenDigest:dailyFinanceDigest(token),acquiredAt:now.toISOString()}));}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return {action:'skip' as const,reason:'locked-review-if-stale',complete:false};throw e}
 // Failures retain the lock: a crash must never be mistaken for permission to retry writes.
 let state=await readState(p.state);const decision=decideDailyFinance(state,digest,now);
 if(decision.action==='skip'){
  if(decision.reason==='already-complete'){
   const a=JSON.parse(await readFile(join(p.dir,'verified-'+state.days[decision.localDate].artifactDigest+'.json'),'utf8'));
   if(a.report.receipts.length!==financeStages.length||new Set(a.report.receipts.map((r:any)=>r.payload.stage)).size!==financeStages.length||!a.report.receipts.every((r:any)=>validateReceipt(r,a.attempt,scope)))throw Error('Stored stage scope proof mismatch.');
  }
  await unlink(p.lease);return {...decision,complete:decision.reason==='already-complete',notificationDue:decision.reason!=='already-complete'&&vancouverFinanceTime(now).minute>=1260};
 }
 const start=now.toISOString(),expiresAt=new Date(now.getTime()+55*60_000).toISOString();
 const attempt:FinanceAttempt=decision.action==='recover'?state.pending!:{id:randomBytes(16).toString('hex'),localDate:decision.localDate,scopeDigest:digest,startedAt:start,leaseExpiresAt:expiresAt};
 state={...state,revision:state.revision+1,pending:attempt,days:{...state.days,[attempt.localDate]:{...state.days[attempt.localDate],scopeDigest:digest,status:'pending',lastAttemptAt:start,attemptId:attempt.id}}};
 await replace(p.state,state);
 const admission:ScheduledAdmission={schema:2,reservationProtocol:'preoperation-v1',mode:'scheduled',token,action:decision.action,admittedDay:decision.localDate,invocationStartedAt:start,expiresAt,attempt,scopeDigest:digest,stateDigest:dailyFinanceDigest(state)};
 const file=join(p.dir,'admission-'+dailyFinanceDigest(token)+'.json');
 await durableExclusive(file,JSON.stringify(admission));
 return {action:decision.action,reason:decision.reason,complete:false,admissionFile:file,validUntil:expiresAt,admission};
}
/** Call immediately before EACH cloud source call or intake mutation. Does not enforce external tool behavior. */
async function validateScheduledAdmission(input:Input,admission:ScheduledAdmission,operation:'collect'|'readback'){
 await assertInferencePolicyPin(input.directory,input.scope.inferencePolicySha256);
 const p=paths(input.directory),a=structuredClone(admission),now=input.now??new Date(),local=vancouverFinanceTime(now);
 if((a.schema!==1&&a.schema!==2)||(a.schema===2&&a.reservationProtocol!=='preoperation-v1')||(a.schema===1&&a.reservationProtocol!==undefined)||a.mode!=='scheduled'||!['collect','recover'].includes(a.action)||!/^[a-f0-9]{64}$/.test(a.token)||financeScopeDigest(input.scope)!==a.scopeDigest)throw Error('Invalid scheduled admission.');
 const stored=JSON.parse(await readFile(join(p.dir,'admission-'+dailyFinanceDigest(a.token)+'.json'),'utf8'));
 const lock=JSON.parse(await readFile(p.lease,'utf8'));
 if(dailyFinanceDigest(stored)!==dailyFinanceDigest(a)||lock.bridge!==true||lock.tokenDigest!==dailyFinanceDigest(a.token))throw Error('Admission token mismatch.');
 if(local.day!==a.admittedDay||local.minute<480||local.minute>=1260||now.getTime()<Date.parse(a.invocationStartedAt)||now.getTime()>Date.parse(a.expiresAt))throw Error('Admission expired or window closed; stop and recover read-only after operator review.');
 if(operation==='collect'&&a.action!=='collect')throw Error('Recovery admission permits readback only.');
 if(dailyFinanceDigest(await readState(p.state))!==a.stateDigest)throw Error('Admission state drift.');
 return a;
}

/** New reservations journal the first operation BEFORE admission is returned to a caller.
 * Cancellation and first-operation admission share one exclusive lock. A stale lock is never stolen.
 * This cannot sandbox an uncooperative caller; every source/API boundary must call this guard.
 */
export async function assertScheduledAdmission(input:Input, admission:ScheduledAdmission, operation:'collect'|'readback'){
 if(admission.reservationProtocol!=='preoperation-v1')return validateScheduledAdmission(input,admission,operation);
 const p=paths(input.directory),mutex=join(p.dir,'phase-'+dailyFinanceDigest(admission.token)+'.lock');
 await durableExclusive(mutex,JSON.stringify({schema:1,admissionDigest:dailyFinanceDigest(admission)}));
 try{
  await validateScheduledAdmission(input,admission,operation);
  const file=join(p.dir,'started-'+dailyFinanceDigest(admission.token)+'.json');
  const bytes=JSON.stringify({schema:1,admissionDigest:dailyFinanceDigest(admission),attemptId:admission.attempt.id});
  try{await durableExclusive(file,bytes)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(file,'utf8')!==bytes)throw e;}
  await validateScheduledAdmission(input,admission,operation);
  return admission;
 }finally{await unlink(mutex)}
}

/** Live owner cancellation, NOT expired/dead-owner recovery. No provider/API callbacks.
 * Old admissions, recovery admissions and anything that crossed a guard remain fail-closed.
 */
export async function abandonUnstartedReservation(input:Input,admission:ScheduledAdmission){
 if(admission.schema!==2||admission.reservationProtocol!=='preoperation-v1'||admission.action!=='collect')throw Error('Reservation protocol required; operator recovery only.');
 const p=paths(input.directory),mutex=join(p.dir,'phase-'+dailyFinanceDigest(admission.token)+'.lock');
 await durableExclusive(mutex,JSON.stringify({schema:1,admissionDigest:dailyFinanceDigest(admission)}));
 try{
  await validateScheduledAdmission(input,admission,'collect');
  for(const name of ['started-'+dailyFinanceDigest(admission.token)+'.json','finalize.lock']){
   let present=false;try{await access(join(p.dir,name));present=true}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
   if(present)throw Error('Operation may have started; read-only operator recovery required.');
  }
  const state=await readState(p.state);
  if(state.pending?.id!==admission.attempt.id)throw Error('Pending attempt mismatch.');
  const next={...state,revision:state.revision+1,days:{...state.days,[admission.admittedDay]:{
   ...state.days[admission.admittedDay],status:'partial' as const,receiptDigests:[]}}};
  delete next.pending;
  const proof={schema:1,kind:'unstarted-reservation-abandoned',admissionDigest:dailyFinanceDigest(admission),
   beforeStateDigest:dailyFinanceDigest(state),afterStateDigest:dailyFinanceDigest(next),complete:false};
  const file=join(p.dir,'abandoned-'+dailyFinanceDigest(admission.token)+'.json'),bytes=JSON.stringify(proof);
  try{await durableExclusive(file,bytes)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(file,'utf8')!==bytes)throw e}
  await validateScheduledAdmission(input,admission,'collect');
  await replace(p.state,next);
  await unlink(p.lease);
  return {complete:false,reason:'unstarted-abandoned-retry-next-hour'};
 }finally{await unlink(mutex)}
}

export async function finalizeScheduledFinance(input:Omit<Input,'now'> & {clock?:()=>Date}, admission:ScheduledAdmission,reportInput:StageReport,loadVerifier:()=>Promise<Pick<FinanceGateCallbacks,'verifyReceiptReadOnly'|'verifyOutcomeReadOnly'>>){
 const p=paths(input.directory),scope=structuredClone(input.scope),clock=input.clock??(()=>new Date()),a=structuredClone(admission),report=structuredClone(reportInput);
 // Lost final response: prove this exact admission/report against local durable artifacts only.
 if(a.mode==='scheduled' && /^[a-f0-9]{64}$/.test(a.token) && financeScopeDigest(scope)===a.scopeDigest){
  const saved=JSON.parse(await readFile(join(p.dir,'admission-'+dailyFinanceDigest(a.token)+'.json'),'utf8'));
  if(dailyFinanceDigest(saved)!==dailyFinanceDigest(a))throw Error('Admission token mismatch.');
  const existing=await readState(p.state),record=existing.days[a.attempt.localDate];
  if(record?.attemptId===a.attempt.id && record.status!=='pending' && record.artifactDigest){
   const proof=JSON.parse(await readFile(join(p.dir,'verified-'+record.artifactDigest+'.json'),'utf8'));
   if(dailyFinanceDigest(proof)!==record.artifactDigest||dailyFinanceDigest(proof.attempt)!==dailyFinanceDigest(a.attempt)||dailyFinanceDigest(proof.report)!==dailyFinanceDigest(report))throw Error('Replay proof mismatch.');
   return {complete:proof.complete===true&&a.attempt.localDate===vancouverFinanceTime(clock()).day,reason:'already-finalized-local',completedLocalDate:proof.complete?a.attempt.localDate:null};
  }
 }
 const guard=()=>assertScheduledAdmission({...input,scope,now:clock()},a,'readback');
 await guard(); // Must precede loading even a reviewed local verifier.
 await durableExclusive(p.finalizer,JSON.stringify({tokenDigest:dailyFinanceDigest(a.token)}));
 try{
  await guard();
  if(!report||!['confirmed','not-applied','uncertain'].includes(report.writeOutcome)||!Array.isArray(report.receipts)||report.receipts.length>5||new Set(report.receipts.map(r=>r.payload?.stage)).size!==report.receipts.length)throw Error('Invalid stage report.');
  const verifier=await loadVerifier();let all=report.receipts.length===5;
  for(const r of report.receipts){const complete=validateReceipt(r,a.attempt,scope);await guard();if(await verifier.verifyReceiptReadOnly(structuredClone(r),structuredClone(a.attempt))!==true)throw Error('Independent stage verification failed.');all=all&&complete}
  if(report.writeOutcome==='uncertain'||report.receipts.some(r=>r.payload.uncertainWrite))throw Error('Outcome uncertain; lease retained for operator-reviewed recovery.');
  await guard();if(await verifier.verifyOutcomeReadOnly(structuredClone(report),structuredClone(a.attempt))!==true)throw Error('Independent outcome verification failed.');await guard();
  const complete=report.writeOutcome==='confirmed'&&all,artifact={schema:1,attempt:a.attempt,report,verifiedAt:clock().toISOString(),complete},artifactDigest=dailyFinanceDigest(artifact);
  const artifactPath=join(p.dir,'verified-'+artifactDigest+'.json'),artifactBytes=JSON.stringify(artifact);
  try{await durableExclusive(artifactPath,artifactBytes)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(artifactPath,'utf8')!==artifactBytes)throw e;}
  await guard();let state=await readState(p.state);
  state={...state,revision:state.revision+1,days:{...state.days,[a.attempt.localDate]:{scopeDigest:a.scopeDigest,status:complete?'complete':'partial',lastAttemptAt:a.invocationStartedAt,attemptId:a.attempt.id,receiptDigests:report.receipts.map(r=>r.digest),artifactDigest,...(complete?{completedAt:clock().toISOString()}:{})}}};delete state.pending;
  await replace(p.state,state);await unlink(p.lease);
  return {complete:complete&&a.attempt.localDate===a.admittedDay,reason:complete?'verified':'partial-retry-later',completedLocalDate:complete?a.attempt.localDate:null};
 }finally{await unlink(p.finalizer)}
}

/** Persist immutable intent BEFORE an independently authorized intake mutation. Contains no credentials. */
export async function journalScheduledIntent(input:Input, admission:ScheduledAdmission, intent:{operationId:string;kind:string;payloadDigest:string;expectedRevision:string;readbackLocator:string}){
 await assertScheduledAdmission(input,admission,'collect');
 if(!intent.operationId||!intent.kind||!intent.expectedRevision||!intent.readbackLocator||!/^[a-f0-9]{64}$/.test(intent.payloadDigest))throw Error('Bound operation intent required.');
 const value={schema:1,attemptId:admission.attempt.id,scopeDigest:admission.scopeDigest,intent:structuredClone(intent)},digest=dailyFinanceDigest(value);
 const path=join(paths(input.directory).dir,'intent-'+dailyFinanceDigest({attemptId:admission.attempt.id,operationId:intent.operationId})+'.json'),bytes=JSON.stringify(value);
 try{await durableExclusive(path,bytes)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(path,'utf8')!==bytes)throw Error('Intent conflict requires review.');}
 if(await readFile(path,'utf8')!==bytes)throw Error('Intent readback failed.');
 return {intentDigest:digest};
}
