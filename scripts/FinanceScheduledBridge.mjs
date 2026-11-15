import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {beginScheduledFinance,assertScheduledAdmission,finalizeScheduledFinance,journalScheduledIntent,abandonUnstartedReservation} from '../apps/worker/src/finance-scheduled-bridge.ts';
const [command,dir,tokenFile,reportFile,verifierFile]=process.argv.slice(2);
if(!dir||!['scheduled-abandon-unstarted','scheduled-begin','scheduled-check-collect','scheduled-check-readback','scheduled-finalize','scheduled-intent'].includes(command))throw Error('Explicit scheduled operation and private directory required.');
const directory=resolve(dir),scope=JSON.parse(await readFile(join(directory,'finance-feed/daily-scope.json'),'utf8'));
let result;
if(command==='scheduled-begin'){
 const r=await beginScheduledFinance({directory,scope});
 // Token never printed. Caller reads the admitted private file locally.
 result={action:r.action,reason:r.reason,complete:r.complete,...('admissionFile'in r?{admissionFile:r.admissionFile,validUntil:r.validUntil}:{}),...('notificationDue'in r?{notificationDue:r.notificationDue}:{})};
}else{
 if(!tokenFile)throw Error('Private admission file required.');
 const admission=JSON.parse(await readFile(resolve(tokenFile),'utf8'));
 if(command==='scheduled-abandon-unstarted'){
  result=await abandonUnstartedReservation({directory,scope},admission);
 }else if(command==='scheduled-intent'){
  if(!reportFile)throw Error('Private intent file required.');
  result=await journalScheduledIntent({directory,scope},admission,JSON.parse(await readFile(resolve(reportFile),'utf8')));
 }else if(command==='scheduled-finalize'){
  if(!reportFile||!verifierFile)throw Error('Private report and reviewed local verifier required.');
  const report=JSON.parse(await readFile(resolve(reportFile),'utf8'));
  result=await finalizeScheduledFinance({directory,scope},admission,report,async()=>{
   const m=await import(pathToFileURL(resolve(verifierFile)).href);
   return {verifyReceiptReadOnly:(r,a)=>m.verifyReceiptReadOnly(r,a,{directory,scope}),verifyOutcomeReadOnly:(r,a)=>m.verifyOutcomeReadOnly(r,a,{directory,scope})};
  });
 }else{await assertScheduledAdmission({directory,scope},admission,command==='scheduled-check-collect'?'collect':'readback');result={admitted:true,operation:command}}
}
console.log(JSON.stringify(result));
