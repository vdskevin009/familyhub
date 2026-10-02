import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(),'familyhub-claim-test-'));
process.env.FAMILYHUB_WORKER_DATA = directory;
const { openClaimBrowser, inspectClaimStep, fillClaimStep, closeClaimBrowser, fieldKind } = await import('../apps/worker/dist/claim-browser.js');
test.after(() => rm(directory,{recursive:true,force:true}));
const dossier = { expenseId:'invoice',insurer:'blue-cross',portalUrl:'https://service.pac.bluecross.ca/member/',blocked:false,reviewableWarnings:[],
 fields:{patient:'Kevin',provider:'Sample Clinic',practitioner:'Sample Therapist',serviceDate:'2026-09-01',originalAmount:100,service:'Physiotherapy - 30 Min Follow Up Visit (30 minutes)',invoiceNumber:'INV-test',otherInsurance:'Yes',otherInsurancePaid:80},
 attachments:[{documentId:'invoice',attachmentId:'pdf',name:'original.pdf'}] };
function fixture({body='Claim Details',fields=[],providers=[]}={}) {
 const calls=[];let url='https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx',closed=false,disconnect;
 const signature=f=>JSON.stringify(['INPUT',f.id,f.id,f.type||'text',f.label?[f.label]:[],null]);
 for(const f of fields) { f.type ||= 'text';f.value ||= '';f.open=false; }
 function field(f) { return {count:async()=>f?1:0,isVisible:async()=>!!f,isEnabled:async()=>true,
   getAttribute:async key=>key==='id'?f.id:null,
   evaluate:async()=>({id:f.id,value:f.value,label:f.label||'',type:f.type,options:f.options||[],signature:signature(f)}),
   click:async()=>{calls.push(['open-menu',f.id]);f.open=true;},press:async key=>{if(key==='Escape')f.open=false;calls.push(['key',f.id,key]);},
   fill:async value=>{calls.push(['fill',f.id,value]);f.value=value;},
   selectOption:async value=>{calls.push(['select',f.id,value]);f.value=value;},
   check:async()=>{calls.push(['provider',f.id]);providers.forEach(p=>p.checked=p.id===f.id);},
   setInputFiles:async file=>{calls.push(['file',file.name]);f.value=file.name;} }; }
 function list(values) { return {all:async()=>values.map(field),filter(){return this;},evaluateAll:async()=>providers,
   first:()=>field(values[0])}; }
 const page={url:()=>url,isClosed:()=>closed,goto:async()=>{},context:()=>context,
   locator(selector){
    if(selector==='body')return {innerText:async()=>body};
    if(selector==='input[type="password"]')return {isVisible:async()=>false};
    if(selector.startsWith('input[type="radio"]'))return list(providers);
    if(selector.startsWith('input:not('))return list(fields);
    const id=selector.match(/^\[id="([^"]+)"\]$/)?.[1];
    if(id?.endsWith('_DropDown')) {
     const f=fields.find(f=>f.id===id.replace(/_DropDown$/,'_Input'));
     return {isVisible:async()=>!!f?.open,locator:()=>({allTextContents:async()=>f.options.map(o=>o.label)}),
       getByRole:()=>({filter({hasText}){const matches=f.options.filter(o=>hasText.test(o.label));return {count:async()=>matches.length,isVisible:async()=>f.open,click:async()=>{calls.push(['choose',f.id,matches[0].label]);f.value=matches[0].label;f.open=false;}};}})};
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

const desjardinsDossier={...dossier,insurer:'desjardins',portalUrl:'https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Default.aspx'};
function desjardinsFixture(options){const f=fixture(options);f.setUrl(desjardinsDossier.portalUrl);return f;}
test('French labels support composed/decomposed accents without guessing other questions',()=>{
 for(const label of ['Personne assurée *','Personne assure\u0301e :','Bénéficiaire'])assert.equal(fieldKind(label),'patient');
 assert.equal(fieldKind('Montant réclamé'),'originalAmount');assert.equal(fieldKind('Numéro du reçu'),'invoiceNumber');
 assert.equal(fieldKind('Date des soins'),'serviceDate');assert.equal(fieldKind('Acceptez-vous la déclaration?'),null);
 assert.equal(fieldKind('Identifiant'),null);assert.equal(fieldKind('Numéro de compte'),null);
});
test('Desjardins exact French fields preserve unknown date mask and entered operator choices',async()=>{
 const f=desjardinsFixture({fields:[{id:'patient',type:'select',value:'0',label:'Personne assurée',options:[{value:'0',label:'Sélectionnez'},{value:'k',label:'Kevin'}]},
 {id:'amount',label:'Montant réclamé'},{id:'date',label:'Date des soins'},{id:'provider',label:'Nom du fournisseur',value:'Operator clinic'},
 {id:'consent',label:'Je confirme la déclaration'}]});const id=await opened(f,desjardinsDossier);
 try{const step=await inspectClaimStep(id);assert.equal(step.fields.find(x=>x.kind==='patient').suggested,'k');
 assert.equal(step.fields.find(x=>x.kind==='serviceDate').suggested,null);assert.equal(step.fields.some(x=>x.kind==='provider'),false);
 assert.equal(step.fields.find(x=>x.kind==='originalAmount').suggested,'100');
 assert.equal(step.fields.find(x=>x.label==='Je confirme la déclaration').kind,null);
 }finally{await closeClaimBrowser(id);}
});
test('Desjardins native dropdown stops before another dropdown or any PDF upload after form replacement',async()=>{
 const f=desjardinsFixture({fields:[{id:'patient',type:'select',label:'Personne assurée',options:[{value:'k',label:'Kevin'}]},
 {id:'service',type:'select',label:'Type de soins',options:[{value:'p',label:'Physiotherapy - 30 Min Follow Up Visit (30 minutes)'}]},
 {id:'amount',label:'Montant des frais'},{id:'upload',type:'file'}]});const id=await opened(f,desjardinsDossier);
 try{const step=await inspectClaimStep(id);const values=Object.fromEntries(step.fields.filter(x=>x.suggested!=null).map(x=>[x.key,x.suggested]));
 const result=await fillClaimStep(id,step.revision,values,'invoice:pdf',async()=>{assert.fail('Must reread form before loading PDF');});
 assert.equal(result.submitAllowed,false);assert.deepEqual(f.calls,[['fill','amount','100'],['select','patient','k']]);
 await assert.rejects(fillClaimStep(id,step.revision,values,null,async()=>{}),/step changed/);
 }finally{await closeClaimBrowser(id);}
});
test('Desjardins French final review and submitted confirmation never offer financial fields',async()=>{
 for(const [body,status] of [['Résumé de votre réclamation','review'],['Votre re\u0301clamation a e\u0301te\u0301 transmise','complete']]){
 const f=desjardinsFixture({body,fields:[{id:'amount',label:'Montant réclamé'},{id:'upload',type:'file'}]});const id=await opened(f,desjardinsDossier);
 try{const step=await inspectClaimStep(id);assert.equal(step.status,status);assert.equal(step.fields.some(x=>x.kind==='originalAmount'),false);
 assert.equal(step.submitAllowed,false);assert.deepEqual(f.calls,[]);
 }finally{await closeClaimBrowser(id);}}
});
