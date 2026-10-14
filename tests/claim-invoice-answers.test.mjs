import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'familyhub-invoice-answer-'));
process.env.FAMILYHUB_WORKER_DATA=dir;
const {confirmedInvoiceIllness,confirmInvoiceIllness}=await import('../apps/worker/dist/claim-invoice-answers.js');
const {automaticClaimValues}=await import('../apps/worker/dist/claim-autofill.js');
const dossier={expenseId:'synthetic-invoice-a',insurer:'blue-cross',blocked:false,reviewableWarnings:[],fields:{patient:'synthetic-member',serviceDate:'2026-01-01',provider:'Synthetic clinic',originalAmount:100}};
test.after(()=>rm(dir,{recursive:true,force:true}));
test('explicit invoice answer is durable, narrowly scoped, revision guarded and removable',async()=>{
 const original=structuredClone(dossier),empty=await confirmedInvoiceIllness(dossier);
 const input={value:'Owner-described symptom',expectedScope:empty.scope,expectedRevision:0};
 await assert.rejects(confirmInvoiceIllness(dossier,input),/explicitly confirm/);
 await assert.rejects(confirmInvoiceIllness({...dossier,blocked:true},{...input,confirmed:true}),/explicitly confirm/);
 const saved=await confirmInvoiceIllness(dossier,{...input,confirmed:true});
 assert.equal(saved.revision,1);assert.deepEqual(await confirmedInvoiceIllness(dossier),saved);
 await assert.rejects(confirmInvoiceIllness(dossier,{...input,confirmed:true}),/changed/);
 for(const changed of [{...dossier,expenseId:'synthetic-invoice-b'},{...dossier,insurer:'desjardins'},{...dossier,fields:{...dossier.fields,serviceDate:'2026-01-02'}}]){
  assert.equal((await confirmedInvoiceIllness(changed)).value,null);
  await assert.rejects(confirmInvoiceIllness(changed,{...input,confirmed:true}),/explicitly confirm/);
 }
 const bytes=await readFile(join(dir,'claim-invoice-answers.json'),'utf8');
 assert.equal(bytes.includes(dossier.expenseId),false);assert.equal(bytes.includes(dossier.fields.patient),false);
 assert.deepEqual(dossier,original,'Source evidence is never changed');
 const cleared=await confirmInvoiceIllness(dossier,{confirmed:true,expectedScope:saved.scope,expectedRevision:1,remove:true});
 assert.equal(cleared.value,null);assert.equal(cleared.revision,2);
 const races=await Promise.allSettled([1,2].map(()=>confirmInvoiceIllness(dossier,{...input,confirmed:true,expectedRevision:2})));
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
});
test('only an explicit confirmed-answer provenance permits illness autofill',()=>{
 const field={key:'illness',kind:'natureOfIllness',suggested:'Owner-described symptom',type:'text',options:[]};
 for(const suggestionSource of [undefined,'invoice','codex','confirmed-choice'])assert.deepEqual(automaticClaimValues([{...field,suggestionSource}],dossier),{});
 assert.deepEqual(automaticClaimValues([{...field,suggestionSource:'confirmed-answer'}],dossier),{illness:field.suggested});
});
test('corrupt saved answers abstain and cannot be overwritten',async()=>{
 await writeFile(join(dir,'claim-invoice-answers.json'),'broken-store');
 await assert.rejects(confirmedInvoiceIllness(dossier));
 await assert.rejects(confirmInvoiceIllness(dossier,{confirmed:true,expectedScope:'bad',expectedRevision:0,value:'Synthetic'}));
 assert.equal(await readFile(join(dir,'claim-invoice-answers.json'),'utf8'),'broken-store');
});
