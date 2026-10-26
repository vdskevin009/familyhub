import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {dossier} from './fixtures/desjardins-receipt.mjs';
const dir=await mkdtemp(join(tmpdir(),'familyhub-coordination-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {confirmedGovernmentReimbursement:read,confirmGovernmentReimbursement:save}=await import('../apps/worker/dist/claim-coordination-answers.js');
test.after(()=>rm(dir,{recursive:true,force:true}));
test('explicit no-government physiotherapy default is scoped, revisioned and never overrides an invoice answer',async()=>{
 let a=await read(dossier);assert.equal(a.value,null);
 await assert.rejects(save(dossier,{confirmed:false,allPhysiotherapy:true,expectedScope:a.defaultScope,expectedRevision:0,value:'no'}),/confirm/);
 a=await save(dossier,{confirmed:true,allPhysiotherapy:true,expectedScope:a.defaultScope,expectedRevision:0,value:'no'});
 assert.equal(a.value,'no');assert.equal(a.source,'physiotherapy-default');assert.equal((await read({...dossier,expenseId:'next'})).value,'no');
 assert.equal((await read({...dossier,fields:{...dossier.fields,service:'Massage'}})).value,null);
 assert.equal((await read({...dossier,insurer:'blue-cross'})).value,null);
 await assert.rejects(save(dossier,{confirmed:true,allPhysiotherapy:true,expectedScope:a.defaultScope,expectedRevision:1,value:'yes'}),/scope/);
 await assert.rejects(save(dossier,{confirmed:true,expectedScope:a.scope,expectedRevision:1,value:'yes'}),/changed/);
 a=await save(dossier,{confirmed:true,expectedScope:a.scope,expectedRevision:0,value:'yes'});assert.equal(a.value,'yes');assert.equal(a.source,'invoice');
 assert.equal((await read({...dossier,expenseId:'next'})).value,'no');
 a=await save(dossier,{confirmed:true,expectedScope:a.scope,expectedRevision:1,value:null});assert.equal(a.value,null,'Explicit invoice removal suppresses the default');
 await assert.rejects(save({...dossier,blocked:true},{confirmed:true,allPhysiotherapy:true,expectedScope:a.defaultScope,expectedRevision:1,value:'no'}),/confirm/);
});
