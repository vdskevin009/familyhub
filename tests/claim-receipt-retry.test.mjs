import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const dir=await mkdtemp(join(tmpdir(),'familyhub-upload-recovery-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {reserveClaimUpload,reserveClaimUploadRetry}=await import('../apps/worker/dist/claim-upload-guard.js');
test('explicit receipt recovery retains the original reservation and reserves only one dispatch per preparation',async()=>{
 const d={expenseId:'synthetic-recovery',insurer:'blue-cross'},hash='a'.repeat(64),scope=randomUUID();
 try{
  await assert.rejects(()=>reserveClaimUploadRetry(d,hash,{confirmed:true,scope}));
  await reserveClaimUpload(d,hash);const directory=join(dir,'claim-upload-attempts'),[original]=await readdir(directory),before=await readFile(join(directory,original),'utf8');
  await assert.rejects(()=>reserveClaimUploadRetry(d,hash,{scope}));await assert.rejects(()=>reserveClaimUploadRetry(d,hash,{confirmed:true,scope:'../outside'}));
  const results=await Promise.allSettled([reserveClaimUploadRetry(d,hash,{confirmed:true,scope}),reserveClaimUploadRetry(d,hash,{confirmed:true,scope})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await readdir(directory)).length,2);assert.equal(await readFile(join(directory,original),'utf8'),before);await assert.rejects(()=>reserveClaimUpload(d,hash));
  await writeFile(join(directory,original),'{}');await assert.rejects(()=>reserveClaimUploadRetry(d,hash,{confirmed:true,scope:randomUUID()}));assert.equal((await readdir(directory)).length,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});