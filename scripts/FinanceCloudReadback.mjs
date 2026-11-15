/** Explicit local private CLI. No cloud Finances API exists here; GET-only FamilyHub readback. */
import {readFile,realpath,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {saveCloudFinanceBaseline,produceCloudFinanceReport,cloudFinanceVerifiers} from '../apps/worker/src/finance-cloud-readback.ts';
import {assertScheduledAdmission,finalizeScheduledFinance} from '../apps/worker/src/finance-scheduled-bridge.ts';
import {durableExclusive,dailyFinanceDigest} from '../apps/worker/src/finance-daily-gate.ts';
const [command,dataArg,evidenceArg,admissionArg,manifestArg]=process.argv.slice(2);
if(!['baseline','report','finalize'].includes(command)||!dataArg||!evidenceArg||!admissionArg)throw Error('Explicit private paths and operation required.');
async function privateRoot(value){const root=await realpath(resolve(value));for(let p=root;;p=dirname(p)){let repository=false;try{await access(join(p,'.git'));repository=true}catch(e){if(e.code!=='ENOENT')throw e}if(repository)throw Error('Private artifacts cannot be inside a repository.');if(dirname(p)===p)break}return root}
const directory=await privateRoot(dataArg),evidenceDirectory=await privateRoot(evidenceArg);
const scope=JSON.parse(await readFile(join(directory,'finance-feed/daily-scope.json'),'utf8')),admission=JSON.parse(await readFile(resolve(admissionArg),'utf8'));
const options={directory,evidenceDirectory,scope,admission,get:async(route)=>{
 await assertScheduledAdmission({directory,scope},admission,'readback');
 const key=(await readFile(join(directory,'pairing-key.txt'),'utf8')).trim();if(!key)throw Error('Private pairing unavailable.');
 const response=await fetch('http://127.0.0.1:4713'+route,{method:'GET',headers:{'x-familyhub-key':key},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Private readback unavailable.');return response.json();
}};
const loadManifest=async()=>{if(!manifestArg)throw Error('Private manifest required.');return JSON.parse(await readFile(resolve(manifestArg),'utf8'))};
if(command==='baseline'){const ref=await saveCloudFinanceBaseline(options);console.log(JSON.stringify({status:'baseline-saved',file:ref.path}));}
else if(command==='report'){
 const report=await produceCloudFinanceReport(options,await loadManifest()),name='report-'+admission.attempt.id+'-'+dailyFinanceDigest(report)+'.json',bytes=JSON.stringify(report),path=join(evidenceDirectory,name);
 try{await durableExclusive(path,bytes)}catch(e){if(e.code!=='EEXIST'||await readFile(path,'utf8')!==bytes)throw e}
 if(await readFile(path,'utf8')!==bytes)throw Error('Private report readback failed.');
 console.log(JSON.stringify({status:'report-verified',file:name,complete:report.receipts.every(r=>r.payload.status==='confirmed')}));
}else{
 // Explicit report file kept beside manifest; no source call needed to load it.
 const manifest=await loadManifest();if(!manifest.reportFile)throw Error('Private reportFile required for finalization.');
 const path=resolve(evidenceDirectory,manifest.reportFile);if(dirname(path)!==evidenceDirectory)throw Error('Report must be in private evidence directory.');
 const report=JSON.parse(await readFile(path,'utf8'));
 const result=await finalizeScheduledFinance(options,admission,report,async()=>cloudFinanceVerifiers(options,loadManifest));
 console.log(JSON.stringify(result));
}
