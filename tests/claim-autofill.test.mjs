import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticClaimValues } from '../apps/worker/dist/claim-autofill.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'claim-upload-guard-'));
process.env.FAMILYHUB_WORKER_DATA=directory;
const {reserveClaimUpload}=await import('../apps/worker/dist/claim-upload-guard.js');
const {authenticatedClaimPages}=await import('../apps/worker/dist/claim-login.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const field=(key,kind,suggested,extra={})=>({key,kind,suggested,type:'text',options:[],...extra});
test('automatic preparation abstains on diagnosis, Codex proposals, uncertain money and ambiguous options',()=>{
 const fields=[field('gross','originalAmount','100'),field('paid','otherInsurancePaid','0'),field('name','patient','Sample'),field('reason','natureOfIllness','Pain'),field('ai','service','a',{suggestionSource:'codex'}),field('choice','service','a',{type:'select',options:[{value:'a',label:'A'},{value:'a',label:'B'}]}),field('date','serviceDate',null)];
 assert.deepEqual(automaticClaimValues(fields,{reviewableWarnings:[]}),{gross:'100',paid:'0',name:'Sample'});
 assert.deepEqual(automaticClaimValues(fields,{reviewableWarnings:['Conflicting gross']}),{name:'Sample'});
});
test('a privately confirmed choice is reused only among current unique options',()=>{
 assert.deepEqual(automaticClaimValues([field('s','service','follow',{type:'select',suggestionSource:'confirmed-choice',options:[{value:'follow',label:'Follow up'}]})],{reviewableWarnings:[]}),{s:'follow'});
});
test('upload reservations survive a new session and refuse concurrent or uncertain replay',async()=>{
 const dossier={expenseId:'synthetic',insurer:'blue-cross'};
 const outcomes=await Promise.allSettled([reserveClaimUpload(dossier,'hash'),reserveClaimUpload(dossier,'hash')]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(reserveClaimUpload(dossier,'hash'),/already attempted/);
 await reserveClaimUpload({...dossier,insurer:'desjardins'},'hash');
});
test('claim login observes a trusted authenticated new tab and exposes ambiguous candidates',async()=>{
 const page=(url,password,marker)=>({url:()=>url,isClosed:()=>false,locator:selector=>({first:()=>({isVisible:async()=>selector.includes('password')?password:marker})})});
 const login=page('https://service.pac.bluecross.ca/member/login',true,false),ready=page('https://service.pac.bluecross.ca/member/',false,true),foreign=page('https://evil.example/member/',false,true);
 login.context=()=>({pages:()=>[login,ready,foreign]});
 assert.deepEqual(await authenticatedClaimPages(login,'blue-cross'),[ready]);
 const other=page('https://service.pac.bluecross.ca/member/',false,true);login.context=()=>({pages:()=>[login,ready,other]});
 assert.equal((await authenticatedClaimPages(login,'blue-cross')).length,2);
});
