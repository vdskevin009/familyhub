import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,unlink,open,rename,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './finance-cloud-readback-fixture.mjs';
import {dailyFinanceDigest as digest,decideDailyFinance} from '../apps/worker/src/finance-daily-gate.ts';
import {recoverStartedNotApplied} from '../apps/worker/src/finance-started-recovery.ts';
import {inspectStartedRecoveryTargets,assertRecoveryFilesExcluded} from '../apps/worker/src/finance-started-recovery-readback.ts';
import {beginScheduledFinance,assertScheduledAdmission} from '../apps/worker/src/finance-scheduled-bridge.ts';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const powershell=process.env.FAMILYHUB_RECOVERY_POWERSHELL??'pwsh.exe';
const sha=v=>createHash('sha256').update(v).digest('hex');

async function setup(){
 const f=await fixture({history:true,beforeIntakes:true,inferencePolicy:true}),root=join(f.directory,'finance-feed/daily-gate'),a=f.options.admission,token=digest(a.token),json=async p=>JSON.parse(await readFile(p,'utf8'));
 await writeFile(join(f.directory,'finance-feed/daily-scope.json'),JSON.stringify(f.scope));
 const baselineFile=join(f.evidenceDirectory,f.manifest.baseline.path),base=await json(baselineFile);
 // Materialize synthetic empty stores; operational recovery deliberately refuses missing files.
 await writeFile(join(f.directory,'finance/source-expenses.json'),JSON.stringify(base.expenses));
 await writeFile(join(f.directory,'finance/account-captures.json'),JSON.stringify(base.accountCaptures));
 const inspection=await inspectStartedRecoveryTargets({directory:f.directory,baselineFile,admission:a,scope:f.scope});
 const p={schema:2,kind:'started-not-applied',admissionDigest:digest(a),beforeStateDigest:a.stateDigest,leaseDigest:digest(await json(join(root,'lease.lock'))),startedDigest:digest(await json(join(root,'started-'+token+'.json'))),baselineSha256:inspection.baselineSha256,ownerEvidenceSha256:'e'.repeat(64),files:inspection.files};
 const input={directory:f.directory,scope:f.scope,clock:()=>new Date('2026-11-16T17:00:00Z')};
 const verify=async()=>({writeOutcome:'not-applied',baselineSha256:p.baselineSha256,ownerEvidenceSha256:p.ownerEvidenceSha256,targetsUnchanged:true,contributionsUnchanged:true,exclusionHeld:true});
 const run=(over={},v=verify,proof=p,admission=a)=>recoverStartedNotApplied({...input,...over},admission,proof,v);
 return {...f,root,a,p,input,verify,run,token,baselineFile,json,state:()=>json(join(root,'state.json')),lease:()=>readFile(join(root,'lease.lock'),'utf8')};
}
test('exact schema2 started recovery archives partial/not-applied, preserves target bytes and hourly time, never success',async()=>{
 const h=await setup(),before=await h.state(),bytes=Object.fromEntries(await Promise.all(Object.keys(h.p.files).map(async f=>[f,await readFile(join(h.directory,f),'utf8')])));
 assert.equal((await h.run()).complete,false);const state=await h.state();assert.equal(state.pending,undefined);assert.equal(state.revision,before.revision+1);assert.equal(state.days[h.a.admittedDay].status,'partial');assert.equal(state.days[h.a.admittedDay].lastAttemptAt,h.a.invocationStartedAt);
 const artifact=await h.json(join(h.root,'started-recovery-'+h.token+'.json'));assert.equal(artifact.complete,false);assert.equal(artifact.writeOutcome,'not-applied');assert.deepEqual(artifact.beforeState,before);
 for(const [f,b] of Object.entries(bytes))assert.equal(await readFile(join(h.directory,f),'utf8'),b);
 assert.equal(decideDailyFinance(state,h.a.scopeDigest,new Date('2026-11-16T16:59:00Z')).action,'skip');
 assert.equal((await h.run()).reason,'already-recovered-local');await assert.rejects(assertScheduledAdmission({...h.input,now:h.now()},h.a,'collect'));
});
for(const phase of ['after-archive','after-state','after-release'])test('interruption '+phase+' replays exact immutable artifact without reapplying or success',async()=>{
 const h=await setup();await assert.rejects(h.run({checkpoint:async p=>{if(p===phase)throw Error('synthetic interruption')}}));
 const file=join(h.root,'started-recovery-'+h.token+'.json'),b=await readFile(file,'utf8');assert.equal((await h.run()).complete,false);assert.equal(await readFile(file,'utf8'),b);assert.equal((await h.state()).revision,2);
});
test('concurrent recovery and ordinary begin/guard cannot enter while recovery owns protocol locks',async()=>{
 const h=await setup();let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);let first=true;
 const running=h.run({},async()=>{if(first){first=false;enter();await held;}return h.verify();});await entered;
 await assert.rejects(h.run(),/EEXIST/);assert.equal((await beginScheduledFinance({...h.input,now:h.input.clock()})).action,'skip');await assert.rejects(assertScheduledAdmission({...h.input,now:h.now()},h.a,'collect'),/EEXIST/);
 release();assert.equal((await running).complete,false);
});
for(const lock of ['phase','finalize'])test('preexisting '+lock+' mutex is never removed, including dead-process leftovers',async()=>{
 const h=await setup(),file=join(h.root,lock==='phase'?'phase-'+h.token+'.lock':'finalize.lock');await writeFile(file,'foreign-owner');await assert.rejects(h.run(),/EEXIST/);assert.equal(await readFile(file,'utf8'),'foreign-owner');assert.equal((await h.state()).pending.id,h.a.attempt.id);await h.lease();
});
for(const change of ['schema1','live','state','lease','started','scope','baseline','owner','artifact'])test('bound '+change+' drift refuses recovery',async()=>{
 const h=await setup();let over={},proof=structuredClone(h.p),a=structuredClone(h.a);
 if(change==='schema1'){a.schema=1;delete a.reservationProtocol;}
 if(change==='live')over.clock=h.now;
 if(change==='state'){const s=await h.state();s.revision++;await writeFile(join(h.root,'state.json'),JSON.stringify(s));}
 if(change==='lease')await writeFile(join(h.root,'lease.lock'),'{}');
 if(change==='started')await writeFile(join(h.root,'started-'+h.token+'.json'),'{}');
 if(change==='scope')await writeFile(join(h.directory,'finance-feed/daily-scope.json'),'{}');
 if(change==='baseline')proof.baselineSha256='a'.repeat(64);
 if(change==='owner')proof.ownerEvidenceSha256='a'.repeat(64);
 if(change==='artifact')await writeFile(join(h.root,'started-recovery-'+h.token+'.json'),'{}');
 await assert.rejects(h.run(over,h.verify,proof,a));await h.lease();assert.equal((await h.state()).days[h.a.admittedDay].status,'pending');
});
for(const trace of ['intent','controller','uncertain'])test('possible write '+trace+' is never recovered by absence/expiry assumptions',async()=>{
 const h=await setup();if(trace==='intent')await writeFile(join(h.root,'intent-synthetic.json'),JSON.stringify({attemptId:h.a.attempt.id}));if(trace==='controller')await mkdir(join(h.root,'controller-'+h.a.attempt.id));
 await assert.rejects(h.run({},trace==='uncertain'?async()=>({...await h.verify(),writeOutcome:'uncertain'}):h.verify));await h.lease();assert.equal((await h.state()).days[h.a.admittedDay].status,'pending');
});
test('drift after archive prevents commit; failed exclusion after commit retains original lease',async()=>{
 const h=await setup();await assert.rejects(h.run({checkpoint:async p=>{if(p==='after-archive'){const s=await h.state();s.revision++;await writeFile(join(h.root,'state.json'),JSON.stringify(s));}}}));await h.lease();assert.equal((await h.state()).days[h.a.admittedDay].status,'pending');
 const j=await setup();await assert.rejects(j.run({},async phase=>({...await j.verify(),exclusionHeld:phase!=='before-release'})));await j.lease();assert.equal((await j.state()).days[j.a.admittedDay].status,'partial');
});
test('later admission cannot be removed by replaying an old recovery',async()=>{
 const h=await setup();await h.run();const next=await beginScheduledFinance({...h.input,now:h.input.clock()});assert.equal(next.action,'collect');const lease=await h.lease();await assert.rejects(h.run());assert.equal(await h.lease(),lease);assert.equal((await h.state()).pending.id,next.admission.attempt.id);
});
for(const file of ['finances/ledger.json','finance/source-inventory.json','finance/source-expenses.json','finance/account-captures.json','contributions/config.json'])test('independent readback rejects changed '+file,async()=>{
 const h=await setup();await writeFile(join(h.directory,file),'{}');await assert.rejects(inspectStartedRecoveryTargets({directory:h.directory,baselineFile:h.baselineFile,admission:h.a,scope:h.scope}));
});
test('concrete verifier refuses missing destination and writable targets; no live ownership inferred',async()=>{
 const h=await setup();await assert.rejects(assertRecoveryFilesExcluded([join(h.directory,'finances/ledger.json')]));await unlink(join(h.directory,'finance/account-captures.json'));
 await assert.rejects(inspectStartedRecoveryTargets({directory:h.directory,baselineFile:h.baselineFile,admission:h.a,scope:h.scope}));
});
test('reparse-point ancestor of gate state/lease/artifact is rejected without mutation',async()=>{
 const h=await setup(),alias=join(h.evidenceDirectory,'aliased-data');await symlink(h.directory,alias,process.platform==='win32'?'junction':'dir');
 const before=await readFile(join(h.root,'state.json'),'utf8'),lease=await h.lease();await assert.rejects(h.run({directory:alias}),/evidence mismatch/);
 assert.equal(await readFile(join(h.root,'state.json'),'utf8'),before);assert.equal(await h.lease(),lease);
});

async function operationalFixture(){
 const h=await setup(),evidenceFile=join(h.evidenceDirectory,'synthetic-owner-stop.txt');
 const evidence='SYNTHETIC TEST ONLY: sole fixture owner stopped and drained; no external operations exist.';await writeFile(evidenceFile,evidence);
 const owner={schema:1,kind:'finance-owner-quiescence',admissionDigest:h.p.admissionDigest,beforeStateDigest:h.p.beforeStateDigest,leaseDigest:h.p.leaseDigest,startedDigest:h.p.startedDigest,baselineSha256:h.p.baselineSha256,
   coordinator:'synthetic-test-coordinator',observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60_000).toISOString(),intakeSuspended:true,pendingOperations:0,owners:[{id:'synthetic-fixture-owner',status:'stopped-and-drained',evidenceFile:'synthetic-owner-stop.txt',evidenceSha256:sha(evidence)}]};
 const ownerFile=join(h.evidenceDirectory,'owner.json'),proofFile=join(h.evidenceDirectory,'proof.json');await writeFile(ownerFile,JSON.stringify(owner));h.p.ownerEvidenceSha256=sha(JSON.stringify(owner));await writeFile(proofFile,JSON.stringify(h.p));
 const admissionFile=join(h.root,'admission-'+h.token+'.json');return {...h,owner,ownerFile,proofFile,admissionFile};
}
function child(command,args){return new Promise((resolveResult,reject)=>{const p=spawn(command,args,{cwd:resolve('.'),windowsHide:true});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',reject);p.on('close',code=>resolveResult({code,output}));});}
test('Windows maintained holder and concrete verifier complete synthetic recovery with all protected bytes unchanged',{skip:process.platform!=='win32'},async()=>{
 const h=await operationalFixture(),before=await inspectStartedRecoveryTargets({directory:h.directory,baselineFile:h.baselineFile,admission:h.a,scope:h.scope});
 const r=await child(powershell,['-NoProfile','-NonInteractive','-File',resolve('scripts/Recover-StartedFinance.ps1'),'-DataDirectory',h.directory,'-AdmissionFile',h.admissionFile,'-BaselineFile',h.baselineFile,'-ProofFile',h.proofFile,'-OwnerEvidenceFile',h.ownerFile,'-NodePath',process.execPath]);
 assert.equal(r.code,0,r.output);assert.match(r.output,/recovered-retry-later/);assert.equal((await h.state()).days[h.a.admittedDay].status,'partial');
 const after=await inspectStartedRecoveryTargets({directory:h.directory,baselineFile:h.baselineFile,admission:h.a,scope:h.scope});assert.deepEqual(after,before);
});
for(const fault of ['no-holder','pending-owner','expired-owner','altered-transcript'])test('concrete operational gate rejects '+fault+' before any mutable gate action',{skip:process.platform!=='win32'},async()=>{
 const h=await operationalFixture();if(fault==='pending-owner')h.owner.pendingOperations=1;if(fault==='expired-owner')h.owner.expiresAt=h.owner.observedAt;
 if(fault==='altered-transcript')await writeFile(join(h.evidenceDirectory,'synthetic-owner-stop.txt'),'changed');
 await writeFile(h.ownerFile,JSON.stringify(h.owner));h.p.ownerEvidenceSha256=sha(JSON.stringify(h.owner));await writeFile(h.proofFile,JSON.stringify(h.p));
 const state=await readFile(join(h.root,'state.json'),'utf8'),lease=await h.lease();
 const r=fault==='no-holder'?await child(process.execPath,['--import','tsx',resolve('scripts/Recover-StartedFinance.mjs'),h.directory,h.admissionFile,h.baselineFile,h.proofFile,h.ownerFile]):
 await child(powershell,['-NoProfile','-NonInteractive','-File',resolve('scripts/Recover-StartedFinance.ps1'),'-DataDirectory',h.directory,'-AdmissionFile',h.admissionFile,'-BaselineFile',h.baselineFile,'-ProofFile',h.proofFile,'-OwnerEvidenceFile',h.ownerFile,'-NodePath',process.execPath]);
 assert.notEqual(r.code,0);assert.match(r.output,fault==='no-holder'?/Effective writer exclusion is absent/:/Independent not-applied evidence failed/);assert.equal(await readFile(join(h.root,'state.json'),'utf8'),state);assert.equal(await h.lease(),lease);assert.equal((await readdir(h.root)).some(n=>n.startsWith('started-recovery-')),false);
});

for(const stage of [2,3])test(`forced Windows holder termination before planner ${stage} leaves no writing child and retains dead-owner locks`,{skip:process.platform!=='win32'},async()=>{
 const h=await operationalFixture(),shim=join(h.evidenceDirectory,'planner-shim.mjs'),command=join(h.evidenceDirectory,'planner-shim.cmd'),ready=join(h.evidenceDirectory,'ready'),release=join(h.evidenceDirectory,'release'),done=join(h.evidenceDirectory,'done');
 // Test-only executable wrapper pauses the read-only child. No production hook or
 // clock override exists. The child is deliberately allowed to outlive its holder.
 await writeFile(shim,`import fs from 'node:fs/promises';import {spawn} from 'node:child_process';
 const dir=process.env.FH_RECOVERY_TEST_DIR;let n=0;try{n=Number(await fs.readFile(dir+'/calls','utf8'))}catch{}await fs.writeFile(dir+'/calls',String(++n));
 if(n===Number(process.env.FH_RECOVERY_TEST_STAGE)){await fs.writeFile(dir+'/ready','ready');for(;;){try{await fs.access(dir+'/release');break}catch{await new Promise(r=>setTimeout(r,10));}}}
 const c=spawn(process.execPath,process.argv.slice(2),{stdio:'inherit',windowsHide:true});c.on('close',async code=>{if(n===Number(process.env.FH_RECOVERY_TEST_STAGE))await fs.writeFile(dir+'/done',String(code));process.exitCode=code??1;});`);
 await writeFile(command,'@"'+process.execPath+'" "'+shim+'" %*\r\n');
 const args=['-NoProfile','-NonInteractive','-File',resolve('scripts/Recover-StartedFinance.ps1'),'-DataDirectory',h.directory,'-AdmissionFile',h.admissionFile,'-BaselineFile',h.baselineFile,'-ProofFile',h.proofFile,'-OwnerEvidenceFile',h.ownerFile,'-NodePath',command];
 const p=spawn(powershell,args,{cwd:resolve('.'),windowsHide:true,env:{...process.env,FH_RECOVERY_TEST_DIR:h.evidenceDirectory,FH_RECOVERY_TEST_STAGE:String(stage)}});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);const exited=new Promise(r=>p.once('exit',r));
 const waitFile=async file=>{const until=Date.now()+20000;while(Date.now()<until){try{await readFile(file);return}catch{}if(p.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,20));}throw Error('Synthetic barrier timed out: '+output);};
 try{
  await waitFile(ready);
  const target=join(h.directory,'finances/ledger.json');await assert.rejects(open(target,'r+'));await assert.rejects(rename(target,target+'.moved'));
  const state=await readFile(join(h.root,'state.json'),'utf8'),lease=await h.lease(),artifact=await readFile(join(h.root,'started-recovery-'+h.token+'.json'),'utf8');
  assert.equal(JSON.parse(state).days[h.a.admittedDay].status,stage===2?'pending':'partial');
  p.kill();await exited;await writeFile(release,'release');
  const until=Date.now()+15000;while(Date.now()<until){try{await readFile(done);break}catch{await new Promise(r=>setTimeout(r,20));}}await readFile(done);
  assert.equal(await readFile(join(h.root,'state.json'),'utf8'),state);assert.equal(await h.lease(),lease);assert.equal(await readFile(join(h.root,'started-recovery-'+h.token+'.json'),'utf8'),artifact);
  assert.ok(await readFile(join(h.root,'phase-'+h.token+'.lock')));assert.ok(await readFile(join(h.root,'finalize.lock')));await assert.rejects(h.run(),/EEXIST/);
 }finally{if(p.exitCode===null)p.kill();await writeFile(release,'release');}
});
