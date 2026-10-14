import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(),'familyhub-claim-test-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const { openClaimBrowser, inspectClaimStep, fillClaimStep, closeClaimBrowser, verifyClaimStep } = await import('../apps/worker/dist/claim-browser.js');
test.after(() => rm(directory,{recursive:true,force:true}));
const dossier = { expenseId:'invoice',insurer:'blue-cross',portalUrl:'https://service.pac.bluecross.ca/member/',blocked:false,reviewableWarnings:[],
 fields:{patient:'Kevin',provider:'Sample Clinic',practitioner:'Sample Therapist',serviceDate:'2026-09-01',originalAmount:100,service:'Physiotherapy - 30 Min Follow Up Visit (30 minutes)',invoiceNumber:'INV-test',otherInsurance:'Yes',otherInsurancePaid:80},
 attachments:[{documentId:'invoice',attachmentId:'pdf',name:'original.pdf'}] };
function fixture({body='Claim Details',fields=[],providers=[]}={}) {
 const calls=[];let url='https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx',closed=false,disconnect;
 const signature=f=>JSON.stringify(['INPUT',f.id,f.id,f.type||'text',f.label?[f.label]:[],null]);
 for(const f of fields) { f.type ||= 'text';f.value ||= '';f.open=false; }
 function field(f) { return {count:async()=>f?1:0,isVisible:async()=>!!f,isEnabled:async()=>f?.disabled!==true,
   getAttribute:async key=>key==='id'?f.id:null,
   evaluate:async()=>{if(f.unreadable)throw Error('unreadable');return {id:f.id,value:f.value,label:f.label||'',type:f.type,options:f.options||[],signature:f.stale?'changed':signature(f)}},
   click:async()=>{calls.push(['open-menu',f.id]);f.open=true;},press:async key=>{if(key==='Escape')f.open=false;calls.push(['key',f.id,key]);},
   fill:async value=>{calls.push(['fill',f.id,value]);f.value=f.forcedValue??value;},
   check:async()=>{calls.push(['provider',f.id]);providers.forEach(p=>p.checked=p.id===f.id);},
   setInputFiles:async file=>{calls.push(['file',file.name]);f.value=file.name;} }; }
 function list(values) { return {all:async()=>values.map(field),filter(){return this;},evaluateAll:async()=>providers,
   first:()=>field(values[0])}; }
 const page={url:()=>url,isClosed:()=>closed,goto:async()=>{},context:()=>context,
   locator(selector){
    if(selector==='body')return {innerText:async()=>body};
    if(selector==='input[type="password"]')return {isVisible:async()=>false};
    if(selector==='input[type="checkbox"]')return list([]);
    if(selector.startsWith('input[type="radio"]'))return list(providers);
    if(selector.startsWith('input:not('))return list(fields);
    const id=selector.match(/^\[id="([^"]+)"\]$/)?.[1];
    if(id?.endsWith('_DropDown')) {
     const f=fields.find(f=>f.id===id.replace(/_DropDown$/,'_Input'));
     return {isVisible:async()=>!!f?.open,locator:()=>({allTextContents:async()=>f.options.map(o=>o.label)}),
       getByRole:()=>({filter({hasText}){const matches=f.options.filter(o=>hasText.test(o.label));return {count:async()=>matches.length,isVisible:async()=>f.open,click:async()=>{calls.push(['choose',f.id,matches[0].label]);f.value=matches[0].label;f.open=false;f.onChoose?.();}};}})};
    }
    if(id)return field([...fields,...providers].find(f=>f.id===id));
    const suffix=selector.match(/id\$="_([^"]+)"/)?.[1];return field(fields.find(f=>f.id.endsWith('_'+suffix)));
   }};
 const context={pages:()=>[page],newPage:async()=>page,addCookies:async()=>{},addInitScript:async()=>{}};
 const browser={newContext:async()=>context,on:(_,callback)=>{disconnect=callback;},close:async()=>{closed=true;disconnect?.();}};
 return {calls,page,browser,fields,setUrl:value=>{url=value;}};
}
async function opened(f,claim=dossier,warnings=false){return (await openClaimBrowser(claim,true,warnings,async()=>f.browser)).sessionId;}

test('opening requires duplicate review and corroborated warning review before browser launch',async()=>{
 let launches=0;const launch=async()=>{launches++;throw Error('unexpected launch');};
 await assert.rejects(openClaimBrowser(dossier,false,false,launch),/history/);
 await assert.rejects(openClaimBrowser({...dossier,reviewableWarnings:['Gross extraction warning']},true,false,launch),/original PDF/);
 await assert.rejects(openClaimBrowser({...dossier,blocked:true},true,true,launch),/duplicate/);assert.equal(launches,0);
 await assert.rejects(openClaimBrowser({...dossier,blocked:true,coordination:{required:true,ready:false,message:'Import the confirmed primary insurer response first.'}},true,true,launch),/primary insurer response/);assert.equal(launches,0);
});

test('open uses the preparation destination and returns inspectable fields without filling or submission',async()=>{
 const f=fixture({fields:[{id:'form_txtAmount',label:'Total amount of expense'}]});let destination;f.page.goto=async url=>{destination=url};
 const claim={...dossier,preparationUrl:'https://service.pac.bluecross.ca/member/'};
 const opened=await openClaimBrowser(claim,true,false,async()=>f.browser);
 try{assert.equal(destination,claim.preparationUrl);assert.equal(opened.step.status,'fields');assert.equal(opened.step.fields[0].suggested,'100.00');assert.equal(opened.submitAllowed,false);assert.equal(f.calls.filter(c=>c[0]==='fill'||c[0]==='file').length,0)}finally{await closeClaimBrowser(opened.sessionId)}
});
test('Telerik selection stops after one postback; text and calendar prefill remain source backed',async()=>{
 const f=fixture({fields:[{id:'form_cmbCoveredLife_Input',options:[{value:'k',label:'Kevin - Jan 01, 2000'}]},
 {id:'form_cmbBenefit_Input',options:[{value:'p',label:'Physiotherapist'}]},
 {id:'form_txtAmount',label:'Total amount of expense'},
 {id:'form_calServiceDate_calcalServiceDate_dateInput'}]});const id=await opened(f);
 try {
  const step=await inspectClaimStep(id);const values=Object.fromEntries(step.fields.filter(x=>x.suggested!=null).map(x=>[x.key,x.suggested]));
  assert.equal(step.fields.find(x=>x.kind==='serviceDate').suggested,'09/01/2026');
  const result=await fillClaimStep(id,step.revision,values,null,async()=>{throw Error('unexpected file');});
  assert.equal(result.submitAllowed,false);assert.equal(f.calls.filter(c=>c[0]==='choose').length,1);
  assert.equal(f.fields.find(x=>x.id==='form_txtAmount').value,'100.00');
  await assert.rejects(fillClaimStep(id,step.revision,values,null,async()=>{}),/step changed/);
  assert.equal(f.calls.some(c=>/submit|next|consent/i.test(c[0])),false);
 }finally{await closeClaimBrowser(id);}
});
test('reviewed postback stages retain and recheck every prior approved answer',async()=>{
 const f=fixture({fields:[
  {id:'form_cmbBenefit_Input',options:[{value:'c',label:'Chiropractor'}]},
  {id:'form_cmbExpenseType_Input',options:[{value:'s',label:'Chiropractic - In Person - Subsequent Treatment'}]},
  {id:'form_cmbOtherInsurancePlan_Input',options:[{value:'y',label:'Yes'},{value:'n',label:'No'}]},
  {id:'form_txtAmount',label:'Total amount of expense'},
  {id:'form_txtOtherPlanAmt',label:'Amount paid by another insurance plan',disabled:true}]});
 f.fields.find(x=>x.id==='form_cmbOtherInsurancePlan_Input').onChoose=()=>{f.fields.find(x=>x.id==='form_txtOtherPlanAmt').disabled=false};
 const id=await opened(f,{...dossier,fields:{...dossier.fields,service:'20 min Chiropractic Return',otherInsurancePaid:0}});
 try {
  for(let stage=0;stage<3;stage++){
   const step=await inspectClaimStep(id),values=Object.fromEntries(step.fields.filter(x=>x.suggested!=null).map(x=>[x.key,x.suggested]));
   const result=await fillClaimStep(id,step.revision,values,null,async()=>{});
   assert.equal(f.calls.filter(c=>c[0]==='choose').length,stage+1);
   assert.equal(result.verification.fields.length,4,'A new stage must retain earlier approved answers');
   assert.equal(result.verification.readyForManualNext,stage===2);
  }
  assert.equal(f.fields.find(x=>x.id==='form_cmbExpenseType_Input').value,'Chiropractic - In Person - Subsequent Treatment');
  assert.equal(f.fields.find(x=>x.id==='form_cmbOtherInsurancePlan_Input').value,'Yes');
  const dependent=await inspectClaimStep(id),paid=dependent.fields.find(x=>x.kind==='otherInsurancePaid');assert.equal(paid.suggested,'0.00');
  const result=await fillClaimStep(id,dependent.revision,{[paid.key]:paid.suggested},null,async()=>{});
  assert.equal(result.verification.fields.length,5);assert.equal(result.verification.readyForManualNext,true);assert.equal(f.fields.find(x=>x.id==='form_txtOtherPlanAmt').value,'0.00');
  f.fields.find(x=>x.id==='form_txtAmount').value='101.00';
  const checks=await verifyClaimStep(id);assert.equal(checks.readyForManualNext,false);assert.equal(checks.fields.find(x=>x.kind==='originalAmount').status,'mismatch');
  assert.equal(f.calls.some(c=>/submit|next|consent/i.test(c[0])),false);
 }finally{await closeClaimBrowser(id);}
});

test('operator edits and a changed origin invalidate fill rather than overwriting or transmitting',async()=>{
 for(const change of ['edit','origin']){
  const f=fixture({fields:[{id:'form_txtAmount',label:'Total amount of expense'}]});const id=await opened(f);
  try {const step=await inspectClaimStep(id);if(change==='edit')f.fields[0].value='custom';else f.setUrl('https://unexpected.test/');
   await assert.rejects(fillClaimStep(id,step.revision,{[step.fields[0].key]:'100.00'},null,async()=>{}),/changed/);
   assert.equal(f.calls.filter(c=>c[0]==='fill').length,0);
  }finally{await closeClaimBrowser(id);}
 }
});
test('provider partial name requires an explicit operator choice and existing selection is preserved',async()=>{
 const providers=[{id:'form_repProvider_ctl00_optProvider',name:'opgProvider',label:'Sample Therapist Extra - Clinic address',checked:false}];
 const f=fixture({providers});const id=await opened(f);
 try {const step=await inspectClaimStep(id);const provider=step.fields.find(x=>x.kind==='practitioner');assert.equal(provider.suggested,null);
  await fillClaimStep(id,step.revision,{[provider.key]:provider.options[0].value},null,async()=>{});
  assert.equal(providers[0].checked,true);assert.equal((await inspectClaimStep(id)).fields.some(x=>x.kind==='practitioner'),false);
 }finally{await closeClaimBrowser(id);}
});
test('review screen allows only a selected original PDF; consent and claim values remain untouched',async()=>{
 const f=fixture({body:'I confirm all the information above is correct and I have read and agree',fields:[{id:'form_txtAmount',label:'Total amount of expense'},{id:'upload',type:'file'}]});const id=await opened(f);
 try {const step=await inspectClaimStep(id);assert.equal(step.status,'review');assert.equal(step.fields.length,1);assert.equal(step.fields[0].type,'file');
  let reads=0;await assert.rejects(fillClaimStep(id,step.revision,{},'invoice:not-original',async()=>{reads++;}),/supporting-document/);assert.equal(reads,0);
  const next=await inspectClaimStep(id);const result=await fillClaimStep(id,next.revision,{},'invoice:pdf',async()=>({name:'original.pdf',bytes:Buffer.from('synthetic PDF')}));
  assert.match(result.message,/upload field/);assert.deepEqual(f.calls,[['file','original.pdf']]);
  const repeat=await inspectClaimStep(id);await assert.rejects(fillClaimStep(id,repeat.revision,{},'invoice:pdf',async()=>({name:'original.pdf',bytes:Buffer.from('synthetic PDF')})),/already attempted/);
  assert.deepEqual(f.calls,[['file','original.pdf']]);
 }finally{await closeClaimBrowser(id);}
});
test('processed confirmation has no writable fields or upload action',async()=>{
 const f=fixture({body:'Your claim has been processed.',fields:[{id:'upload',type:'file'}]});const id=await opened(f);
 try {const step=await inspectClaimStep(id);assert.equal(step.status,'complete');assert.deepEqual(step.fields,[]);assert.equal(step.submitAllowed,false);}finally{await closeClaimBrowser(id);}
});

test('read-back reports each mismatch and unreadable field; a changed page invalidates prior matches',async()=>{
 const f=fixture({fields:[{id:'form_txtAmount',label:'Total amount of expense'},{id:'form_txtOtherPlanAmt',label:'Other insurance amount',forcedValue:'80.00'}]});const id=await opened(f);
 try{const step=await inspectClaimStep(id);const values=Object.fromEntries(step.fields.map(x=>[x.key,x.suggested]));const result=await fillClaimStep(id,step.revision,values,null,async()=>{});
  assert.equal(result.verification.fields.find(x=>x.kind==='originalAmount').status,'match');assert.equal(result.verification.fields.find(x=>x.kind==='otherInsurancePaid').status,'match');
  f.fields[1].value='64.00';const mismatch=await verifyClaimStep(id);assert.equal(mismatch.readyForManualNext,false);assert.equal(mismatch.fields[1].status,'mismatch');
  f.fields[0].unreadable=true;assert.equal((await verifyClaimStep(id)).fields[0].status,'unreadable');f.fields[0].unreadable=false;f.fields[0].stale=true;assert.equal((await verifyClaimStep(id)).fields[0].status,'unreadable');
  f.setUrl('https://unexpected.test/');assert.equal((await verifyClaimStep(id)).fields.every(x=>x.status==='unreadable'),true);
 }finally{await closeClaimBrowser(id)}
});
