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
try {
 browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 for(const scenario of ['blocked-source','blocked-target','reviewable-source','prepared','unknown','mismatch','upload-failed','human-required','login-required','blocked','old-worker','refresh-failed','owner-zero','unknown-insurer','confirmed-illness','default-illness','auto-login','optional','required','review','blocked-upload','review-missing','review-no-verification','expense-summary','saved-practitioner','watch-upload']) {
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),page=await context.newPage(),posts=[],errors=[];
  const c={...entry,NextInsurer:scenario==='unknown-insurer'?null:'Blue Cross',DesjardinsReimbursedAmount:scenario==='owner-zero'?null:0};
  const preparation=prepareClaim(expense.Id,'blue-cross',[expense],[c]);
  preparation.attachments=[{documentId:expense.Id,attachmentId:'pdf',name:'synthetic.pdf'}];preparation.blocked=['blocked','blocked-source','blocked-target'].includes(scenario);
  const sourceConflict='OriginalBilledAmount differs from direct-insurance arithmetic (200 vs 80).';
  if(['blocked-source','reviewable-source'].includes(scenario))preparation.conflicts=[sourceConflict];
  if(scenario==='reviewable-source')preparation.reviewableWarnings=[sourceConflict];
  if(scenario==='blocked-target')preparation.duplicate.status='recorded';
  let step={status:['human-required','login-required','blocked'].includes(scenario)?scenario:'fields',fields:scenario==='unknown'?[{key:'illness',kind:'natureOfIllness',label:'Nature of illness/injury',type:'text',options:[],suggested:null}]:[],revision:'step',submitAllowed:false};
  if(['blocked-source','blocked-target'].includes(scenario))step.status='blocked';
  if(['confirmed-illness','default-illness'].includes(scenario))step.confirmedIllness={scope:'a'.repeat(64),value:null,revision:0,source:null,defaultScope:'b'.repeat(64),defaultValue:null,defaultRevision:0};
  if(scenario==='auto-login')step.status='login-required';
  if(scenario==='saved-practitioner')step.confirmedPractitioner={scope:'c'.repeat(64),value:'Sample Practitioner',revision:1};
  if(scenario==='expense-summary'){step.status='navigate';step.portalStage='expense-summary';}
  if(['optional','required'].includes(scenario))step.fields=[{key:'public-plan',kind:null,label:'Amount paid by public or provincial plan',type:'text',options:[],suggested:null,optional:scenario==='optional'}];
  if(['review','blocked-upload','review-missing','review-no-verification'].includes(scenario)){step.status='review';step.fields=[{key:'receipt',kind:null,label:'Receipt',type:'file',options:[],suggested:null}];}
  if(scenario==='review-missing')step.fields.push({key:'illness',kind:'natureOfIllness',label:'Nature of illness/injury',type:'text',options:[],suggested:null});
  const verification={revision:'prepared',readyForManualNext:!['mismatch','upload-failed'].includes(scenario),scope:'Read-back only; not eligibility or submission.',fields:[{key:'gross',label:'Total expense',value:'100.00',actual:scenario==='mismatch'?'80.00':'100.00',status:scenario==='mismatch'?'mismatch':'match'}],attachment:{name:'synthetic.pdf',status:scenario==='upload-failed'?'failed':'verified'}};
  if(scenario==='expense-summary'){verification.fields[0].status='unreadable';verification.fields[0].actual=null;verification.attachment=null;verification.readyForManualNext=false;}
  if(scenario==='review-no-verification')verification.attachment=null;
  if(scenario==='blocked-upload'){verification.attachment={name:'synthetic.pdf',status:'unverified',selected:false,blocked:true};verification.readyForManualNext=false;}
  if(scenario==='watch-upload'){verification.attachment=null;verification.receiptUploadAvailable=false;}
 const result=()=>({preparation,sessionId:preparation.blocked?undefined:'synthetic-session',step,verification:preparation.blocked||['human-required','login-required'].includes(scenario)?undefined:verification,submitAllowed:false});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'})));
  await page.route('https://synthetic-worker.invalid/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'*'}});
   if(request.method()==='OPTIONS')return reply({});
   if(request.method()==='POST')posts.push({path,body:request.postDataJSON()});
   if(path==='/health')return reply({status:'ok',version:scenario==='old-worker'?'2.25.3':'2.26.8'});
   if(path==='/invoices')return reply({items:[expense],reconciliations:[c],unmatchedReimbursements:[],accounts:[]});
   if(path==='/claim-preparation/prepare')return reply(result());
   if(path==='/claim-preparation/verify'&&scenario==='watch-upload')return reply({...verification,receiptUploadAvailable:true});
   if(path==='/claim-preparation/inspect'){
    if(scenario==='auto-login')step={...step,status:'fields'};
    return reply(step);
   }
   if(path==='/claim-preparation/practitioner-answer'){const b=request.postDataJSON();assert.equal(b.action,'remove');assert.equal(b.confirmed,true);assert.equal(b.expenseId,expense.Id);assert.equal(b.expectedScope,step.confirmedPractitioner.scope);assert.equal(b.expectedRevision,1);step={...step,confirmedPractitioner:{...step.confirmedPractitioner,value:null,revision:2}};return reply({answer:step.confirmedPractitioner});}
   if(path==='/claim-preparation/invoice-answer'){
    const b=request.postDataJSON();assert.equal(b.expenseId,expense.Id);assert.equal(b.insurer,'blue-cross');assert.equal(b.confirmed,true);
    const all=scenario==='default-illness',answer=step.confirmedIllness,value=b.action==='remove'?null:b.value;
    assert.equal(b.allInvoices,all);assert.equal(b.expectedScope,all?answer.defaultScope:answer.scope);assert.equal(b.expectedRevision,all?answer.defaultRevision:answer.revision);
    step={...step,confirmedIllness:{...answer,value,source:all?'default':'invoice',...(all?{defaultValue:value,defaultRevision:answer.defaultRevision+1}:{revision:answer.revision+1})}};
    return reply({answer:step.confirmedIllness});
   }
   if(path==='/claim-preparation/retry-receipt'){
    const b=request.postDataJSON();assert.equal(b.prepareAuthorized,true);assert.equal(b.retryReviewed,true);assert.equal(b.revision,'prepared');assert.equal(b.receiptName,'synthetic.pdf');
    verification.attachment={name:'synthetic.pdf',status:'verified',selected:true,blocked:false};return reply(result());
   }
   if(path==='/claim-preparation/resume'){
    if(scenario==='refresh-failed')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Read failed. Check the portal.'})});
    if(scenario==='watch-upload'){step={...step,status:'review'};verification.attachment={name:'synthetic.pdf',status:'verified'};verification.receiptUploadAvailable=false;}
    return reply(result());
   }
   if(path==='/claim-preparation/correct'){assert.deepEqual(request.postDataJSON().values,{illness:'My current answer'});step={...step,fields:[]};return reply(result());}
   if(path==='/claim-preparation/validate'){assert.equal(request.postDataJSON().answersReviewed,true);assert.equal(request.postDataJSON().revision,'prepared');return reply({step,verification});}
   if(path==='/claim-preparation/confirm-adjudication'){
    const b=request.postDataJSON();assert.equal(b.confirmed,true);assert.equal(b.amount,0);assert.equal(b.expectedInvoiceNumber,'SYN-001');assert.equal(b.insurer,'desjardins');
    c.DesjardinsReimbursedAmount=0;c.OwnerAdjudications=[{insurer:'desjardins',amount:0,reason:b.reason,at:'2026-09-02T12:00:00Z',revision:1,provenance:'owner-confirmed'}];
    return reply({preparation:prepareClaim(expense.Id,'blue-cross',[expense],[c])});
   }
   return reply({state:'idle',accounts:[]});
  });
  await page.goto(base);await page.getByRole('button',{name:scenario==='unknown-insurer'?'Prepare claim':'Prepare Blue Cross claim',exact:true}).click();
  if(scenario==='unknown-insurer') {
    const choice=page.getByRole('dialog',{name:'Prepare claim',exact:true});await choice.getByText(/The next insurer is unknown/).waitFor();
    assert.equal(posts.length,0,'Unknown insurer must not silently prepare/upload to Blue Cross');
    await choice.getByRole('combobox').first().selectOption('blue-cross');
  }
  const dialog=page.getByRole('dialog',{name:'Prepare Blue Cross claim',exact:true});await dialog.waitFor();
  await dialog.getByText('Preparing and reading back the insurer form…',{exact:true}).waitFor({state:'hidden'});
  if(scenario==='old-worker'){await dialog.getByText(/requires worker 2.26.0/).waitFor();assert.equal(posts.length,0);}
  else {
   assert.equal(posts.filter(p=>p.path.endsWith('/prepare')).length,1,'A click prepares once, without a prior review checkbox');
   assert.equal(posts[0].body.prepareAuthorized,true);
   assert.equal('historyReviewed' in posts[0].body,false);
   if(scenario==='human-required')await dialog.getByText(/Complete the verification challenge/).waitFor();
   else if(scenario==='login-required')await dialog.getByText(/Sign-in needs attention/).waitFor();
   else if(scenario==='blocked')await dialog.getByText(/current Claims review state/).waitFor();
   else if(scenario==='blocked-source'){
    await dialog.getByRole('alert').filter({hasText:/Conflicting source amounts/}).waitFor();
    const notice=dialog.getByRole('alert').filter({hasText:sourceConflict});assert.equal(await notice.count(),1);assert.equal(await notice.locator('.lucide-circle-check').count(),0);
    assert.equal(await dialog.getByText(/possible .* claim|Processing by Blue Cross/).count(),0);
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await page.screenshot({path:join(output,'claim-source-block-'+width+'.png')});}
   }
   else if(scenario==='blocked-target')await dialog.getByRole('alert').filter({hasText:/Processing by Blue Cross is already recorded/}).waitFor();
   else {
    if(scenario==='reviewable-source'){const warning=dialog.locator('.app-notice.warning').filter({hasText:sourceConflict});await warning.waitFor();assert.equal(await warning.locator('.lucide-triangle-alert').count(),1);assert.equal(await warning.locator('.lucide-circle-check').count(),0);}
    if(scenario==='auto-login'){
     await dialog.getByText(/Sign-in needs attention/).waitFor();
     await dialog.getByText(/Sign-in needs attention/).waitFor({state:'hidden'});
     assert.equal(posts.filter(p=>p.path.endsWith('/resume')).length,1,'Login completion resumes automatically once');
    }
    await dialog.getByRole('region',{name:'Prepared portal answers'}).waitFor();
    if(scenario==='watch-upload'){
     await dialog.getByText(/FamilyHub validation is not required/).waitFor({timeout:15000});
     assert.equal(posts.filter(p=>p.path.endsWith('/resume')).length,1,'Observed upload page resumes once without a second user click');
     await dialog.getByText(/Upload success observed/).waitFor();assert.equal(posts.some(p=>/submit|claim-create|next/.test(p.path)),false);assert.deepEqual(errors,[]);await context.close();continue;
    }
    if(scenario==='saved-practitioner'){await dialog.getByText('Practitioner confirmed for this invoice',{exact:true}).click();await dialog.getByRole('button',{name:'Clear saved practitioner for this invoice',exact:true}).click();await dialog.getByText('Saved practitioner cleared. The current portal selection was preserved.',{exact:true}).waitFor();assert.equal(posts.filter(p=>p.path.endsWith('/practitioner-answer')).length,1);assert.equal(await dialog.getByRole('button',{name:'Clear saved practitioner for this invoice',exact:true}).count(),0);assert.equal(posts.some(p=>/submit|claim-create|next/.test(p.path)),false);assert.deepEqual(errors,[]);await context.close();continue;}
    if(scenario==='expense-summary'){await dialog.getByText(/The insurer expense summary is open/).waitFor();assert.equal(await dialog.getByRole('button',{name:'Validate prepared step',exact:true}).count(),0);assert.equal(await dialog.getByText(/Open the claim form/).count(),0);assert.equal(await dialog.getByText(/Needs attention — unreadable/).count(),0);assert.equal(posts.some(p=>/submit|claim-create|next/.test(p.path)),false);assert.deepEqual(errors,[]);await context.close();continue;}
    const validate=dialog.getByRole('button',{name:'Validate prepared step',exact:true});
    if(['review','blocked-upload','review-missing','review-no-verification'].includes(scenario)){
     if(scenario==='blocked-upload'){await dialog.getByText(/Not attached — an earlier upload attempt/).waitFor();assert.equal(await dialog.getByText(/Selected; upload not yet verified/).count(),0);await dialog.getByRole('button',{name:'Attach receipt to this preparation',exact:true}).click();await dialog.getByText(/Upload success observed/).waitFor();assert.equal(posts.filter(p=>p.path.endsWith('/retry-receipt')).length,1);}
     const missing=dialog.getByRole('region',{name:'Uncertain or missing answers'});
     assert.equal(await missing.count(),['review-missing','review-no-verification'].includes(scenario)?1:0,'Only render pending controls; a verified or blocked file has its own result panel');
     if(scenario==='review-missing')assert.equal(await dialog.getByLabel('Nature of illness/injury').count(),1,'Required answers remain visible after verified upload');
     if(scenario==='review-no-verification')assert.equal(await dialog.getByRole('combobox',{name:/Original receipt/}).count(),1,'An unprepared receipt remains selectable');
     assert.equal(await validate.count(),0);await dialog.getByText(/FamilyHub validation is not required/).waitFor();
     assert.equal(posts.some(p=>/submit|claim-create|next/.test(p.path)),false);assert.deepEqual(errors,[]);await context.close();continue;
    }
    assert.equal(await validate.isDisabled(),true);
    if(scenario==='unknown'){
     assert.equal(await dialog.getByLabel('Nature of illness/injury').inputValue(),'');await dialog.getByLabel('Nature of illness/injury').fill('My current answer');
     await dialog.getByRole('button',{name:'Prepare these answers',exact:true}).click();await dialog.getByLabel('Nature of illness/injury').waitFor({state:'hidden'});
    }
    if(['prepared','unknown','optional'].includes(scenario)){
     await dialog.getByLabel(/I checked the prepared values/).check();await validate.click();await dialog.getByText(/Prepared values rechecked/).waitFor();
     assert.equal(posts.filter(p=>p.path.endsWith('/validate')).length,1);
    } else if(scenario==='required'){
     assert.equal(await dialog.getByLabel(/I checked the prepared values/).isDisabled(),true);
    } else if(['mismatch','upload-failed'].includes(scenario)) {
     assert.equal(await dialog.getByLabel(/I checked the prepared values/).isDisabled(),true);
     await dialog.getByText(scenario==='mismatch'?/Needs attention — mismatch/:/Upload failed/).waitFor();
    } else if(scenario==='refresh-failed') {
     await dialog.getByRole('button',{name:'Read and prepare current step',exact:true}).click();await dialog.getByText(/Read failed/).waitFor();assert.equal(await validate.count(),0);
    } else if(['confirmed-illness','default-illness'].includes(scenario)) {
     const all=scenario==='default-illness';
     await dialog.getByText('Illness or injury',{exact:true}).click();
     if(all)await dialog.getByLabel('Reuse answer for').selectOption('all');
     const save=dialog.getByRole('button',{name:all?'Save default and prepare':'Save for this invoice and prepare',exact:true});
     await dialog.getByLabel('Your answer',{exact:true}).fill('Owner-described symptom');assert.equal(await save.isDisabled(),true);
     await dialog.getByLabel(all?/I confirm this answer should be the default/:/I confirm this is my answer for this invoice/).check();await save.click();
     await dialog.getByRole('button',{name:all?'Clear default answer':'Clear saved invoice answer',exact:true}).waitFor();
     assert.equal(await dialog.getByLabel('Your answer',{exact:true}).inputValue(),'Owner-described symptom');
     await dialog.getByRole('button',{name:all?'Clear default answer':'Clear saved invoice answer',exact:true}).click();
     await dialog.getByText('Saved answer cleared. The current portal value was left unchanged.',{exact:true}).waitFor();
     assert.equal(await dialog.getByLabel('Your answer',{exact:true}).inputValue(),'');
     assert.equal(posts.filter(p=>p.path.endsWith('/invoice-answer')).length,2);
    } else if(scenario==='owner-zero') {
     await dialog.getByRole('button',{name:'Close preparation window',exact:true}).click();await dialog.getByText(/Preparation window closed/).waitFor();
     await dialog.getByText('Review / correct your other-insurer response',{exact:true}).click();
     await dialog.getByLabel('Amount paid by first insurer (CAD)').fill('0');await dialog.getByLabel('Reason for the confirmed response').fill('Confirmed limit exhausted');
     await dialog.getByLabel(/I received this adjudication/).check();await dialog.getByRole('button',{name:'Save owner-confirmed response'}).click();await dialog.getByText(/Your adjudication confirmation was saved/).waitFor();
    }
   }
  }
  assert.equal(posts.some(p=>/submit|claim-create|next/.test(p.path)),false);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,scenario+' mobile overflow');
  await page.screenshot({path:join(output,`claim-autonomous-${scenario}.png`),fullPage:true});await context.close();
 }
 console.log(JSON.stringify({passed:26,providerContact:false,submission:false,screenshots:output}));
}finally{await browser?.close();server.close();}
