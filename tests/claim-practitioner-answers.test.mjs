import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'familyhub-practitioner-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {confirmedInvoicePractitioner,confirmInvoicePractitioner}=await import('../apps/worker/dist/claim-practitioner-answers.js');
const dossier={expenseId:'synthetic-invoice',insurer:'blue-cross',blocked:false,fields:{patient:'Sample',provider:'Synthetic Clinic',practitioner:null,serviceDate:'2026-10-01',originalAmount:100,invoiceNumber:'SYN-VISA'}};
test.after(()=>rm(dir,{recursive:true,force:true}));
test('explicit practitioner is invoice/source/insurer scoped and revision protected',async()=>{
 const initial=await confirmedInvoicePractitioner(dossier);assert.equal(initial.value,null);
 await assert.rejects(confirmInvoicePractitioner(dossier,{value:'Sample Practitioner'}),/explicitly confirm/);
 const input={value:'Sample Practitioner',confirmed:true,expectedScope:initial.scope,expectedRevision:initial.revision};
 const saved=await confirmInvoicePractitioner(dossier,input);assert.equal(saved.value,input.value);assert.equal(saved.revision,1);
 await assert.rejects(confirmInvoicePractitioner(dossier,input),/changed/);
 for(const changed of [{...dossier,expenseId:'other'},{...dossier,insurer:'desjardins'},{...dossier,fields:{...dossier.fields,originalAmount:90}}])assert.equal((await confirmedInvoicePractitioner(changed)).value,null);
 const fresh=await import('../apps/worker/dist/claim-practitioner-answers.js?restart');assert.equal((await fresh.confirmedInvoicePractitioner(dossier)).value,input.value);
 const raw=await readFile(join(dir,'claim-practitioner-answers.json'),'utf8');assert.doesNotMatch(raw,/Synthetic Clinic|SYN-VISA|originalAmount|serviceDate/);
 const removed=await confirmInvoicePractitioner(dossier,{...input,remove:true,expectedRevision:1});assert.equal(removed.value,null);assert.equal(removed.revision,2);
 const known={...dossier,fields:{...dossier.fields,practitioner:'Source Practitioner'}},knownAnswer=await confirmedInvoicePractitioner(known);
 await assert.rejects(confirmInvoicePractitioner(known,{...input,expectedScope:knownAnswer.scope,expectedRevision:0}),/source practitioner/);
});
test('corrupt practitioner preferences fail closed and are preserved',async()=>{await writeFile(join(dir,'claim-practitioner-answers.json'),'broken');await assert.rejects(confirmedInvoicePractitioner(dossier));assert.equal(await readFile(join(dir,'claim-practitioner-answers.json'),'utf8'),'broken');});
