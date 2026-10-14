/** Built PWA acceptance. Synthetic records and mocked worker only. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { once } from 'node:events';
import { prepareClaim } from '../../worker/dist/claim-preparation.js';
const root=resolve('apps/web/dist'), output=resolve('output/playwright');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname, file=resolve(root,'.'+path.replace(/^\/familyhub/,''));
 if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{const data=await readFile(file===root||path.endsWith('/')?join(root,'index.html'):file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'text/html');res.end(data)}catch{res.writeHead(404);res.end()}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}/familyhub/`;
const expense={Id:'synthetic-expense',Category:0,DocumentRole:'expense',Member:'Kevin',ServiceDate:'2026-09-01',ReceivedAt:'2026-09-01T12:00:00Z',BilledAmount:100,Provider:'Sample Clinic',AccountEmail:'test@example.test',SourceMessageId:'synthetic-email',Attachments:[],Healthcare:{ServiceType:'Physiotherapy',InvoiceNumber:'SYN-001'},WorkerManaged:true,Status:0,Sender:'test@example.test',Subject:'Synthetic receipt',Reasons:[],Currency:'CAD'};
const entry={Id:'synthetic-case',DocumentIds:[expense.Id],ExpenseDocumentId:expense.Id,Member:'Kevin',ServiceDate:expense.ServiceDate,OriginalAmount:100,WorkflowStatus:'open',AutomaticWorkflowStatus:'open',MatchAssignments:[],Provider:expense.Provider,ServiceType:'Physiotherapy',PrimaryInsurer:'Desjardins',SecondaryInsurer:'Blue Cross',PrimaryReimbursedAmount:null,SecondaryReimbursedAmount:null,DesjardinsReimbursedAmount:null,BlueCrossReimbursedAmount:null,ReimbursedAmount:0,PotentialRemaining:100,Currency:'CAD',Status:'waiting-primary',Action:'submit-primary',NextInsurer:'Desjardins',Evidence:{},Reasons:[]};
let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 for(const scenario of ['missing-primary','zero-primary','partial-mismatch','upload-failed','login-required','navigate','dependent-postback','inspection-failed']){
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[],posts=[];
  const ready=scenario!=='missing-primary', paid=scenario==='partial-mismatch'?'64.00':'0.00', c={...entry,NextInsurer:ready?'Blue Cross':'Desjardins',DesjardinsReimbursedAmount:ready?Number(paid):null,Status:ready?'waiting-secondary':'waiting-primary',Action:ready?'submit-secondary':'submit-primary'};
  const formScenarios=['zero-primary','partial-mismatch','upload-failed','dependent-postback','inspection-failed'];
  const formFields=[{key:'amount',label:'Total amount of expense',type:'text',kind:'originalAmount',options:[],suggested:'100.00'},{key:'paid',label:'Amount paid by another insurance plan',type:'text',kind:'otherInsurancePaid',options:[],suggested:paid},{key:'service',label:'Type of expense',type:'select',kind:'service',options:[{value:'follow',label:'Physiotherapy follow-up'},{value:'initial',label:'Initial assessment'}],suggested:'follow',suggestionSource:'confirmed-choice',suggestionReason:'Your confirmed choice for this insurer, clinic and exact invoice service. Review it for this claim.'},{key:'unknown',label:'Unknown clinical detail',type:'text',kind:null,options:[],suggested:null},...(scenario==='upload-failed'?[{key:'file',label:'Invoice PDF',type:'file',kind:null,options:[],suggested:null}]:[])];
  const step={status:formScenarios.includes(scenario)?'fields':scenario,revision:'synthetic-revision',submitAllowed:false,fields:formScenarios.includes(scenario)?formFields:[],serviceChoices:{available:true,scopeComplete:true,warning:null}};
  const verification=corrected=>({revision:'approved',readyForManualNext:scenario!=='upload-failed'&&(scenario!=='partial-mismatch'||corrected),scope:'Matching only; no eligibility or coverage verification.',fields:formFields.filter(f=>f.kind).map(f=>({key:f.key,label:f.label,value:f.suggested,optionLabel:f.options.find(o=>o.value===f.suggested)?.label,actual:f.key==='paid'&&scenario==='partial-mismatch'&&!corrected?'80.00':f.suggested,status:f.key==='paid'&&scenario==='partial-mismatch'&&!corrected?'mismatch':'match'})),attachment:scenario==='upload-failed'?{name:'synthetic.pdf',status:'failed'}:null});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'}));localStorage.setItem('familyhub.claim-reason.v1','Prior claim answer');});
  await page.route('https://synthetic-worker.invalid/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'*'}});
   if(req.method()==='OPTIONS')return reply({});
   if(req.method()==='POST')posts.push({path,body:req.postDataJSON()});
   if(path==='/health')return reply({status:'ok',version:'2.25.3'});
   if(path==='/invoices')return reply({items:[expense],reconciliations:[c],unmatchedReimbursements:[],accounts:[]});
   if(path==='/claim-preparation/confirm-adjudication'){
    const body=req.postDataJSON();assert.equal(body.confirmed,true);assert.equal(body.expectedInvoiceNumber,'SYN-001');assert.equal(body.expectedServiceDate,'2026-09-01');assert.equal(body.insurer,'desjardins');
    c.DesjardinsReimbursedAmount=body.remove?null:body.amount;c.OwnerAdjudicationRevisions={desjardins:body.remove?2:1};
    c.OwnerAdjudications=body.remove?[]:[{insurer:'desjardins',amount:body.amount,reason:body.reason,at:'2026-09-02T12:00:00Z',revision:1,provenance:'owner-confirmed'}];
    return reply({saved:true,changed:true,preparation:prepareClaim(expense.Id,'blue-cross',[expense],[c])});
   }
   if(path==='/claim-preparation/preview'){const p=prepareClaim(expense.Id,req.postDataJSON().insurer,[expense],[c]);if(scenario==='upload-failed')p.attachments=[{documentId:expense.Id,attachmentId:'pdf',name:'synthetic.pdf'}];return reply(p)}
   if(path==='/claim-preparation/open')return reply({sessionId:'synthetic-session',step});
   if(path==='/claim-preparation/forget-service-choices')return reply(step);
   if(path==='/claim-preparation/inspect'){
    const fills=posts.filter(p=>p.path.endsWith('/fill')).length,reads=posts.filter(p=>p.path.endsWith('/inspect')).length;
    if(scenario==='inspection-failed')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic read failed'})});
    if(scenario==='dependent-postback'&&fills===1)return reply({...step,revision:'postback-revision',fields:[{key:'other',label:'Submitted to another insurance plan?',type:'combo',kind:'otherInsurance',options:[{value:'Yes',label:'Yes'},{value:'No',label:'No'}],suggested:'Yes'}]});
    if(fills&&reads===1||scenario==='dependent-postback'&&fills>1)return reply({...step,fields:[]});
    return reply(step);
   }
   if(path==='/claim-preparation/verify')return reply(verification(true));
   if(path==='/claim-preparation/fill')return reply({message:'Reviewed fields filled.',verification:verification(false)});
   return reply({state:'idle',accounts:[]});
  });
  await page.goto(base);await page.getByRole('button',{name:ready?'Prepare Blue Cross claim':'Prepare claim',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:ready?'Prepare Blue Cross claim':'Prepare Desjardins claim',exact:true});await dialog.waitFor();
  assert.equal(await dialog.getByRole('combobox').first().inputValue(),ready?'blue-cross':'desjardins');
  if(!ready){
   await dialog.getByRole('combobox').first().selectOption('blue-cross');
   await page.getByRole('dialog',{name:'Prepare Blue Cross claim',exact:true}).waitFor();
   await page.getByText(/response\/payment is not recorded.*open preparation/).waitFor();
   const panel=page.getByRole('dialog',{name:'Prepare Blue Cross claim',exact:true});
   await panel.getByLabel(/I checked the current insurer history/).check();
   assert.equal(await page.getByRole('button',{name:'Open preparation window on PC',exact:true}).isDisabled(),false);
   assert.equal(posts.filter(p=>p.path.endsWith('/open')).length,0);
   await panel.getByText('Review / correct your other-insurer response',{exact:true}).click();
   await panel.getByLabel('Amount paid by first insurer (CAD)',{exact:true}).fill('0');await panel.getByLabel('Reason for the confirmed response',{exact:true}).fill('Limit exhausted');
   assert.equal(await panel.getByRole('button',{name:'Save owner-confirmed response',exact:true}).isDisabled(),true);
   await panel.getByLabel(/I received this adjudication for this exact invoice/).check();await panel.getByRole('button',{name:'Save owner-confirmed response',exact:true}).click();
   await panel.getByText(/Your adjudication confirmation was saved privately/).waitFor();await panel.getByText(/Owner-confirmed Desjardins: 0.00 CAD/).waitFor();
   assert.equal(await panel.getByRole('button',{name:'Open preparation window on PC',exact:true}).isDisabled(),false);
   await panel.getByRole('button',{name:'Clear owner-confirmed response',exact:true}).click();await panel.getByRole('button',{name:'Clear owner-confirmed response',exact:true}).waitFor({state:'hidden'});
   assert.equal(await panel.getByLabel('Amount paid by first insurer (CAD)',{exact:true}).inputValue(),'');assert.equal(await panel.getByRole('button',{name:'Open preparation window on PC',exact:true}).isDisabled(),false);
   assert.equal(posts.filter(p=>p.path.endsWith('/confirm-adjudication')).length,2);
  }else{
   assert.equal(await dialog.getByLabel('Nature of illness / injury',{exact:true}).inputValue(),'','A prior claim answer must not be reused');
   assert.equal(await dialog.getByLabel(/Remember this answer/).count(),0);
   await dialog.getByLabel(/I checked the current insurer history/).check();
   await dialog.getByRole('button',{name:'Open preparation window on PC',exact:true}).click();
   if(formScenarios.includes(scenario)){
    await dialog.getByLabel('Total amount of expense',{exact:true}).waitFor();
    assert.equal(await dialog.getByLabel('Total amount of expense',{exact:true}).inputValue(),'100.00');
    assert.equal(await dialog.getByLabel('Amount paid by another insurance plan',{exact:true}).inputValue(),paid);
    assert.equal(posts.filter(p=>p.path.endsWith('/inspect')).length,0,'Open already provides the first inspection');
    assert.equal(await dialog.getByLabel('Unknown clinical detail',{exact:true}).count(),0);
    await dialog.getByText(/Unknown clinical detail: complete this directly/).waitFor();
    const fill=dialog.getByRole('button',{name:scenario==='upload-failed'?'Valider et préremplir et joindre le PDF':'Valider et préremplir',exact:true});
    if(scenario==='upload-failed')await dialog.getByRole('combobox').last().selectOption(`${expense.Id}:pdf`);
    assert.equal(await fill.isDisabled(),true);
    await dialog.getByLabel(/I reviewed every proposed answer/).check();
    await dialog.getByLabel('Total amount of expense',{exact:true}).fill('101.00');assert.equal(await fill.isDisabled(),true);
    await dialog.getByLabel('Total amount of expense',{exact:true}).fill('100.00');await dialog.getByLabel(/I reviewed every proposed answer/).check();
    if(scenario==='upload-failed'){assert.equal(await fill.isDisabled(),true);await dialog.getByLabel(/Upload this selected original PDF/).check()}
    await page.screenshot({path:join(output,'claim-preparation-reviewed-values.png'),fullPage:true});
    await fill.click();
    await dialog.getByRole('region',{name:'Verified portal answers'}).waitFor();
    await dialog.getByText('Checking.',{exact:true}).waitFor({state:'hidden'});
    assert.deepEqual(posts.find(p=>p.path.endsWith('/fill')).body.values,{amount:'100.00',paid,service:'follow'});assert.equal(posts.find(p=>p.path.endsWith('/fill')).body.rememberServiceChoices,true);
    const verified=dialog.getByRole('region',{name:'Verified portal answers'});
    if(scenario==='dependent-postback'){
     await dialog.getByLabel(/^Submitted to another insurance plan\?/).waitFor();assert.equal(await dialog.getByLabel(/^Submitted to another insurance plan\?/).inputValue(),'Yes');
     await verified.getByText(/Do not choose Next yet.*remaining portal fields/).waitFor();assert.equal(await fill.isDisabled(),true,'Newly exposed answers require fresh review');
     assert.equal(posts.filter(p=>p.path.endsWith('/fill')).length,1,'Inspection must never autofill the next stage');
     await dialog.getByLabel(/I reviewed every proposed answer/).check();await fill.click();await verified.getByText(/Every approved answer matches/).waitFor();
     assert.deepEqual(posts.filter(p=>p.path.endsWith('/fill'))[1].body.values,{other:'Yes'});assert.equal(posts.filter(p=>p.path.endsWith('/fill'))[1].body.revision,'postback-revision');
    }
    else if(scenario==='inspection-failed'){await dialog.getByText(/refreshed form could not be read/).waitFor();await verified.getByText(/Do not choose Next yet.*Read the refreshed form/).waitFor();assert.equal(await fill.count(),0,'No stale fill controls after a failed refresh');assert.equal(posts.filter(p=>p.path.endsWith('/fill')).length,1);}
    else if(scenario==='partial-mismatch'){await verified.getByText(/Mismatch: Amount paid/).waitFor();await verified.getByRole('button',{name:'Re-read filled answers to verify',exact:true}).click();await verified.getByText(/Every approved answer matches/).waitFor();await dialog.getByRole('button',{name:'Read current form fields',exact:true}).click();await dialog.getByLabel('Total amount of expense',{exact:true}).waitFor();assert.equal(await dialog.getByRole('region',{name:'Verified portal answers'}).count(),0,'New answer review invalidates prior checks');await dialog.getByRole('button',{name:'Reset saved service choices for this service',exact:true}).click();await dialog.getByText(/Saved service choices cleared/).waitFor();assert.equal(posts.filter(p=>p.path.endsWith('/forget-service-choices')).length,1)}
    else if(scenario==='upload-failed'){await verified.getByText(/Upload failed: synthetic.pdf/).waitFor();await verified.getByText(/Do not choose Next yet/).waitFor()}
    else await verified.getByText(/Every approved answer matches/).waitFor();
   }else if(scenario==='login-required')await dialog.getByText(/Complete sign-in in the preparation window on your PC/).waitFor();
   else await dialog.getByText(/The preparation window is open on your PC. Open the claim form there/).waitFor();
   assert.equal(posts.filter(p=>p.path.endsWith('/open')).length,1);
  }
  assert.equal(posts.some(p=>/submit|claim-create|next/.test(p.path)),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,scenario+' mobile overflow');
  assert.deepEqual(errors,[]);await page.screenshot({path:join(output,`claim-preparation-${scenario}.png`),fullPage:true});await context.close();
 }
 console.log(JSON.stringify({passed:8,scenarios:['primary-warning-and-owner-zero-save-clear','confirmed-zero-review','partial-mismatch-readback-correction-reset','failed-upload-no-readiness','manual-login','manual-navigation','dependent-postback-reviewed-continuation','inspection-failed-no-stale-fill'],providerContact:false,submission:false,screenshots:output}));
}finally{await browser?.close();server.close();}
