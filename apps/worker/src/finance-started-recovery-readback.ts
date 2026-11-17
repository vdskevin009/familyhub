/** Local-only independent reconciliation. It never calls a source or FamilyHub API. */
import {readFile,lstat,realpath,open} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {dailyFinanceDigest as digest,financeScopeDigest} from './finance-daily-gate.js';
import {FinanceLibrary} from './finance-library.js';
import {FinanceSourceInventoryStore} from './finance-source-inventory-store.js';
import {FinanceSourceExpensesStore} from './finance-source-expenses-store.js';
import {FinanceAccountCapturesStore} from './finance-account-captures-store.js';
import {contributionsView} from './contributions-view.js';
import {readInferencePolicy,inferenceView} from './contribution-inference-readback.js';
import {readFinanceRegisterBindings} from './finance-register-bindings.js';
import type {DailyFinanceScope} from './finance-daily-gate.js';
import type {ScheduledAdmission} from './finance-scheduled-bridge.js';
import type {StartedRecoveryProof,RecoveryVerification} from './finance-started-recovery.js';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const check=(v:unknown)=>{if(!v)throw Error('Independent not-applied evidence failed; no recovery.');};
export const recoveryTargetFiles=['finances/ledger.json','finance/source-inventory.json','finance/source-expenses.json','finance/account-captures.json','contributions/config.json','finance-feed/daily-scope.json'] as const;
export async function regularPrivateFile(file:string){
 const full=resolve(file);let current=full;
 for(;;){const info=await lstat(current);check(!info.isSymbolicLink());if(current===full)check(info.isFile());
   const parent=dirname(current);if(parent===current)break;current=parent;}
 check((await realpath(full)).toLowerCase()===full.toLowerCase());return full;
}
async function bytes(file:string){await regularPrivateFile(file);const b=await readFile(file);check(b.length<=64*1024*1024);return b;}
async function json(file:string){return JSON.parse((await bytes(file)).toString('utf8'));}
function within(root:string,name:string){check(typeof name==='string'&&name.length>0&&!name.includes('\\')&&!isAbsolute(name));const file=resolve(root,name),rel=relative(root,file);check(rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel));return file;}
export type RecoveryReadbackInput={directory:string;baselineFile:string;admission:ScheduledAdmission;scope:DailyFinanceScope;clock?:()=>Date};

/** Useful for private read-only inspection too. No safety claim about concurrent writers. */
export async function inspectStartedRecoveryTargets(input:RecoveryReadbackInput){
 const {directory,admission:a,scope}=input,raw=await bytes(input.baselineFile),base=JSON.parse(raw.toString('utf8'));
 check(base.schema===1&&base.attemptId===a.attempt.id&&base.scopeDigest===financeScopeDigest(scope)&&base.scopeDigest===a.scopeDigest&&
   Number.isFinite(Date.parse(base.capturedAt))&&Date.parse(base.capturedAt)>=Date.parse(a.attempt.startedAt)&&Date.parse(base.capturedAt)<=Date.parse(a.expiresAt));
 const at=new Date(base.capturedAt),ledger=await new FinanceLibrary(join(directory,'finances')).read(),inventory=await new FinanceSourceInventoryStore(directory).read(at),
   expenses=await new FinanceSourceExpensesStore(directory).read(at),accountCaptures=await new FinanceAccountCapturesStore(directory).read(at),config=await json(join(directory,'contributions/config.json'));
 const policy=await readInferencePolicy(directory);check((policy?.hash??null)===(base.inferencePolicySha256??null)&&(policy?.hash??undefined)===scope.inferencePolicySha256);
 const progress=contributionsView(ledger,config,base.progress.evaluatedOn);
 check(digest(ledger)===digest(base.ledger)&&digest(inventory)===digest(base.inventory)&&digest(expenses)===digest(base.expenses)&&
   digest(accountCaptures)===digest(base.accountCaptures)&&digest(config)===digest(base.config)&&digest(progress)===digest(base.progress));
 const files:string[]=[...recoveryTargetFiles];
 if(policy)files.push('contributions/inference-policy.json');
 for(const imported of ledger.imports){check(/^[a-f0-9]{64}$/.test(imported.hash));files.push('finances/sources/'+imported.hash+'.json');}
 const fingerprints:Record<string,string>={};
 for(const name of [...new Set(files)].sort()){const data=await bytes(within(directory,name));fingerprints[name]=sha(data);
   if(name.startsWith('finances/sources/'))check(sha(data)===name.slice('finances/sources/'.length,-5));}
 check(digest(await json(join(directory,'finance-feed/daily-scope.json')))===digest(scope));
 const bindings=await readFinanceRegisterBindings(join(directory,'finances'),ledger);check(bindings.unavailableArchiveCount===0);
 // The baseline stores legacy projection + exact policy pin. Recompute extension from
 // unchanged, hash-verified inputs at that same evaluation date, never at today's date.
 const inferred=inferenceView(progress,ledger,config,expenses,policy,base.progress.evaluatedOn,bindings.bindings);
 const baselineBindings=await readFinanceRegisterBindings(join(directory,'finances'),base.ledger);
 check(digest(inferred)===digest(inferenceView(base.progress,base.ledger,base.config,base.expenses,policy,base.progress.evaluatedOn,baselineBindings.bindings)));
 return {baselineSha256:sha(raw),files:fingerprints,targetsUnchanged:true as const,contributionsUnchanged:true as const};
}

/** Windows holder opens every file with FileShare.Read only. This probe requests write
 * access but never writes. A writable file, missing file or unsupported OS fails closed. */
export async function assertRecoveryFilesExcluded(files:string[]){
 check(process.platform==='win32');
 for(const file of files){await regularPrivateFile(file);let handle;
   try{handle=await open(file,'r+');}catch(e){check(['EBUSY','EACCES','EPERM'].includes((e as NodeJS.ErrnoException).code??''));continue;}
   await handle.close();throw Error('Effective writer exclusion is absent; no recovery.');
 }
}
export async function verifyStartedRecoveryReadOnly(input:RecoveryReadbackInput & {ownerEvidenceFile:string;proof:StartedRecoveryProof}):Promise<RecoveryVerification>{
 const p=input.proof,ownerBytes=await bytes(input.ownerEvidenceFile),owner=JSON.parse(ownerBytes.toString('utf8')),now=(input.clock??(()=>new Date()))().getTime();
 // This entry point intentionally supports the pinned inference-enabled scope only.
 // Absence cannot be protected by a file handle against concurrent creation.
 check(typeof input.scope.inferencePolicySha256==='string'&&/^[a-f0-9]{64}$/.test(input.scope.inferencePolicySha256));
 check(sha(ownerBytes)===p.ownerEvidenceSha256&&owner.schema===1&&owner.kind==='finance-owner-quiescence'&&
   owner.admissionDigest===p.admissionDigest&&owner.beforeStateDigest===p.beforeStateDigest&&owner.leaseDigest===p.leaseDigest&&
   owner.startedDigest===p.startedDigest&&owner.baselineSha256===p.baselineSha256&&typeof owner.coordinator==='string'&&owner.coordinator.trim()&&
   owner.intakeSuspended===true&&owner.pendingOperations===0&&Array.isArray(owner.owners)&&owner.owners.length>0&&
   new Set(owner.owners.map((o:any)=>o.id)).size===owner.owners.length&&Number.isFinite(Date.parse(owner.observedAt))&&Number.isFinite(Date.parse(owner.expiresAt))&&
   Date.parse(owner.observedAt)>Date.parse(input.admission.expiresAt)&&now>=Date.parse(owner.observedAt)&&now<Date.parse(owner.expiresAt)&&Date.parse(owner.expiresAt)-Date.parse(owner.observedAt)<=15*60_000);
 const held=[input.baselineFile,input.ownerEvidenceFile,...Object.keys(p.files).map(name=>within(input.directory,name))];
 for(const row of owner.owners){check(typeof row.id==='string'&&row.id.trim()&&row.status==='stopped-and-drained'&&/^[a-f0-9]{64}$/.test(row.evidenceSha256));
   const file=within(dirname(input.ownerEvidenceFile),row.evidenceFile);check(sha(await bytes(file))===row.evidenceSha256);held.push(file);}
 // The coordinator's authenticated transcript/stop evidence is an explicit operational
 // trust boundary, not a machine inference from a PID, expired time, or these booleans.
 await assertRecoveryFilesExcluded(held);
 const result=await inspectStartedRecoveryTargets(input);check(result.baselineSha256===p.baselineSha256&&digest(result.files)===digest(p.files));
 await assertRecoveryFilesExcluded(held);
 return {writeOutcome:'not-applied',baselineSha256:p.baselineSha256,ownerEvidenceSha256:p.ownerEvidenceSha256,targetsUnchanged:true,contributionsUnchanged:true,exclusionHeld:true};
}
