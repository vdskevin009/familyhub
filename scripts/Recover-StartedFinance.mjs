/** Read-only plan for the Windows holder. Direct invocation cannot mutate any file. */
import {readFile,access} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {recoverStartedNotApplied} from '../apps/worker/src/finance-started-recovery.ts';
import {verifyStartedRecoveryReadOnly,regularPrivateFile,assertRecoveryFilesExcluded} from '../apps/worker/src/finance-started-recovery-readback.ts';
const [directoryArg,admissionArg,baselineArg,proofArg,ownerArg,...extra]=process.argv.slice(2);
if(!directoryArg||!admissionArg||!baselineArg||!proofArg||!ownerArg||extra.length)throw Error('Explicit reviewed private paths required.');
const directory=resolve(directoryArg),admissionFile=await regularPrivateFile(admissionArg),baselineFile=await regularPrivateFile(baselineArg),proofFile=await regularPrivateFile(proofArg),ownerEvidenceFile=await regularPrivateFile(ownerArg);
for(const file of [join(directory,'finance-feed/daily-scope.json'),admissionFile,baselineFile,proofFile,ownerEvidenceFile]){
 for(let p=dirname(file);;p=dirname(p)){try{await access(join(p,'.git'));throw Error('Private recovery evidence cannot be in Git.');}catch(e){if(e.code!=='ENOENT')throw e;}if(dirname(p)===p)break;}
}
await assertRecoveryFilesExcluded([admissionFile,baselineFile,proofFile,ownerEvidenceFile]);
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const scope=await json(join(directory,'finance-feed/daily-scope.json')),admission=await json(admissionFile),proof=await json(proofFile);
const input={directory,baselineFile,ownerEvidenceFile,scope,admission,proof};
// First verification occurs before acquiring any mutable gate mutex.
await verifyStartedRecoveryReadOnly(input);
const result=await recoverStartedNotApplied({directory,scope,planningOnly:true},admission,proof,()=>verifyStartedRecoveryReadOnly(input));
console.log(JSON.stringify(result));
