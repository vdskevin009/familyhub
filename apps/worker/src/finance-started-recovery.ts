/** Exceptional schema-2 recovery. No provider, HTTP, import, reset or success path. */
import {readFile,readdir,unlink,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {dailyFinanceDigest as digest,financeScopeDigest,readState,durableExclusive,replace} from './finance-daily-gate.js';
import {assertInferencePolicyPin} from './finance-inference-pin.js';
import type {DailyFinanceScope,DailyFinanceState} from './finance-daily-gate.js';
import type {ScheduledAdmission} from './finance-scheduled-bridge.js';
import {createHash} from 'node:crypto';

export type StartedRecoveryProof={schema:2;kind:'started-not-applied';admissionDigest:string;beforeStateDigest:string;leaseDigest:string;startedDigest:string;baselineSha256:string;ownerEvidenceSha256:string;files:Record<string,string>};
export type RecoveryVerification={writeOutcome:'not-applied';baselineSha256:string;ownerEvidenceSha256:string;targetsUnchanged:true;contributionsUnchanged:true;exclusionHeld:true};
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const requireProof=(ok:unknown)=>{if(!ok)throw Error('Started recovery evidence mismatch; retain lease.');};
async function optional(file:string){try{return await readFile(file,'utf8')}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}}
async function regularGateFile(file:string,allowAbsent=false){
 const full=resolve(file);let current=full;
 for(;;){let info;try{info=await lstat(current);}catch(e){if(current===full&&allowAbsent&&(e as NodeJS.ErrnoException).code==='ENOENT'){current=dirname(current);continue;}throw e;}
   requireProof(!info.isSymbolicLink()&&(current!==full||info.isFile()));const parent=dirname(current);if(parent===current)break;current=parent;}
}

/** The verifier must hold effective write/delete exclusion and independently establish
 * all owners stopped/drained throughout this call. A caller boolean is not a verifier.
 * The maintained Windows entry point supplies the concrete file verifier and holder.
 * A process killed while owning either protocol lock stays fail-closed for review.
 */
export async function recoverStartedNotApplied(input:{directory:string;scope:DailyFinanceScope;clock?:()=>Date;planningOnly?:boolean;checkpoint?:(phase:string)=>Promise<void>},admission:ScheduledAdmission,proof:StartedRecoveryProof,
 verifyReadOnly:(phase:'before-archive'|'before-commit'|'before-release')=>Promise<RecoveryVerification>){
 const a=structuredClone(admission),p=structuredClone(proof),scope=structuredClone(input.scope),now=input.clock??(()=>new Date());
 const root=join(input.directory,'finance-feed/daily-gate'),stateFile=join(root,'state.json'),leaseFile=join(root,'lease.lock');
 requireProof(a.schema===2&&a.reservationProtocol==='preoperation-v1'&&a.mode==='scheduled'&&a.action==='collect'&&hex(a.token)&&
   financeScopeDigest(scope)===a.scopeDigest&&a.attempt.scopeDigest===a.scopeDigest&&a.admittedDay===a.attempt.localDate&&
   a.invocationStartedAt===a.attempt.startedAt&&a.expiresAt===a.attempt.leaseExpiresAt&&Number.isFinite(Date.parse(a.expiresAt))&&now().getTime()>Date.parse(a.expiresAt));
 const tokenDigest=digest(a.token),admissionDigest=digest(a),proofDigest=digest(p);
 requireProof(p.schema===2&&p.kind==='started-not-applied'&&p.admissionDigest===admissionDigest&&p.beforeStateDigest===a.stateDigest&&
   [p.leaseDigest,p.startedDigest,p.baselineSha256,p.ownerEvidenceSha256].every(hex)&&p.files&&Object.keys(p.files).length>0&&Object.values(p.files).every(hex));
 const phase=join(root,'phase-'+tokenDigest+'.lock'),finalizer=join(root,'finalize.lock'),artifactFile=join(root,'started-recovery-'+tokenDigest+'.json');
 await regularGateFile(stateFile);await regularGateFile(leaseFile,true);await regularGateFile(artifactFile,true);
 const nextState=(state:DailyFinanceState)=>{
   const next:DailyFinanceState={...state,revision:state.revision+1,days:{...state.days,[a.admittedDay]:{
     scopeDigest:a.scopeDigest,status:'partial',lastAttemptAt:a.invocationStartedAt,attemptId:a.attempt.id,receiptDigests:[]}}};
   delete next.pending;return next;
 };
 const checkFixed=async()=>{
   await regularGateFile(stateFile);await regularGateFile(leaseFile,true);await regularGateFile(artifactFile,true);
   await assertInferencePolicyPin(input.directory,scope.inferencePolicySha256);
   requireProof(digest(JSON.parse(await readFile(join(input.directory,'finance-feed/daily-scope.json'),'utf8')))===digest(scope));
   requireProof(digest(JSON.parse(await readFile(join(root,'admission-'+tokenDigest+'.json'),'utf8')))===admissionDigest);
   const marker=JSON.parse(await readFile(join(root,'started-'+tokenDigest+'.json'),'utf8'));
   requireProof(digest(marker)===p.startedDigest&&digest(marker)===digest({schema:1,admissionDigest,attemptId:a.attempt.id}));
   // Reject all controller activity in this deliberately narrow pre-controller path,
   // including previews. An absent intent by itself never establishes no-write.
   for(const name of await readdir(root)){
     if(name==='controller-'+a.attempt.id)throw Error('Controller activity requires separate uncertain-write review.');
     if(name.startsWith('intent-')){
       const intent=JSON.parse(await readFile(join(root,name),'utf8'));
       requireProof(typeof intent.attemptId==='string'&&intent.attemptId!==a.attempt.id);
     }
   }
 };
 const checkLease=async()=>{
   const bytes=await optional(leaseFile);if(bytes===null)return false;
   const lease=JSON.parse(bytes);requireProof(lease.schema===1&&lease.bridge===true&&lease.tokenDigest===tokenDigest&&digest(lease)===p.leaseDigest);return true;
 };
 const verify=async(stage:'before-archive'|'before-commit'|'before-release')=>{
   await checkFixed();const result=await verifyReadOnly(stage);
   requireProof(digest(result)===digest({writeOutcome:'not-applied',baselineSha256:p.baselineSha256,ownerEvidenceSha256:p.ownerEvidenceSha256,targetsUnchanged:true,contributionsUnchanged:true,exclusionHeld:true}));
   await checkFixed();
 };
 // Own both normal guard/finalization mutexes; never remove a preexisting lock.
 const lockBytes=JSON.stringify({schema:1,kind:'started-recovery',admissionDigest,proofDigest});
 // The maintained Windows holder requests plans only and owns its own mutexes.
 // This child mode never creates, changes or removes ANY file, including locks.
 const plan=async(action:string,artifact:any)=>{
   const stateBytes=await readFile(stateFile),leaseBytes=await optional(leaseFile);
   requireProof(digest(JSON.parse(stateBytes.toString('utf8')))===(['release','done'].includes(action)?artifact.afterStateDigest:p.beforeStateDigest));
   requireProof(leaseBytes===null?action==='done':digest(JSON.parse(leaseBytes))===p.leaseDigest);
   return {action,tokenDigest,artifactName:'started-recovery-'+tokenDigest+'.json',artifactBytes:JSON.stringify(artifact),afterStateBytes:JSON.stringify(artifact.afterState),
     stateSha256:createHash('sha256').update(stateBytes).digest('hex'),leaseSha256:leaseBytes===null?null:createHash('sha256').update(leaseBytes).digest('hex')};
 };
 if(!input.planningOnly)await durableExclusive(phase,lockBytes);let ownsFinalizer=false;
 try{
   if(!input.planningOnly){await durableExclusive(finalizer,lockBytes);ownsFinalizer=true;}await checkFixed();
   const state=await readState(stateFile),saved=await optional(artifactFile),artifact=saved===null?null:JSON.parse(saved);
   if(artifact){
     requireProof(artifact.schema===2&&artifact.kind==='started-recovery-not-applied'&&artifact.complete===false&&artifact.writeOutcome==='not-applied'&&
       artifact.admissionDigest===admissionDigest&&artifact.proofDigest===proofDigest&&digest(artifact.proof)===proofDigest&&
       digest(artifact.beforeState)===p.beforeStateDigest&&digest(artifact.beforeState.pending)===digest(a.attempt)&&
       digest(nextState(artifact.beforeState))===artifact.afterStateDigest&&digest(artifact.afterState)===artifact.afterStateDigest);
   }
   if(artifact&&digest(state)===artifact.afterStateDigest){
     if(!await checkLease())return input.planningOnly?plan('done',artifact):{complete:false,writeOutcome:'not-applied',reason:'already-recovered-local'};
     await verify('before-release');requireProof(digest(await readState(stateFile))===artifact.afterStateDigest&&await checkLease());
     if(input.planningOnly)return plan('release',artifact);
     await unlink(leaseFile);return {complete:false,writeOutcome:'not-applied',reason:'recovered-retry-later'};
   }
   requireProof(digest(state)===p.beforeStateDigest&&digest(state.pending)===digest(a.attempt)&&state.days[a.admittedDay]?.status==='pending'&&
     state.days[a.admittedDay]?.attemptId===a.attempt.id&&state.days[a.admittedDay]?.lastAttemptAt===a.invocationStartedAt&&await checkLease());
   await verify('before-archive');
   const afterState=nextState(state),expected={schema:2,kind:'started-recovery-not-applied',admissionDigest,proofDigest,proof:p,beforeState:state,afterState,afterStateDigest:digest(afterState),complete:false,writeOutcome:'not-applied'};
   if(input.planningOnly){if(artifact)requireProof(digest(artifact)===digest(expected));requireProof(digest(await readState(stateFile))===p.beforeStateDigest&&await checkLease());return plan(artifact?'commit':'archive',expected);}
   if(artifact)requireProof(digest(artifact)===digest(expected));else await durableExclusive(artifactFile,JSON.stringify(expected));
   requireProof(digest(JSON.parse(await readFile(artifactFile,'utf8')))===digest(expected));
   await input.checkpoint?.('after-archive');await verify('before-commit');
   requireProof(digest(await readState(stateFile))===p.beforeStateDigest&&await checkLease());
   await replace(stateFile,afterState);await input.checkpoint?.('after-state');
   await verify('before-release');requireProof(digest(await readState(stateFile))===digest(afterState)&&await checkLease());
   await unlink(leaseFile);await input.checkpoint?.('after-release');
   return {complete:false,writeOutcome:'not-applied',reason:'recovered-retry-later'};
 }finally{
   // Cleanup only the mutexes acquired by this invocation, with exact ownership.
   if(ownsFinalizer){requireProof(await readFile(finalizer,'utf8')===lockBytes);await unlink(finalizer);}
   if(!input.planningOnly){requireProof(await readFile(phase,'utf8')===lockBytes);await unlink(phase);}
 }
}
