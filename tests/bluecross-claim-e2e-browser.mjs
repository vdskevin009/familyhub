import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {receiptDossier,receiptText,receiptPdf} from './fixtures/detailed-receipt.mjs';
const dir=await mkdtemp(join(tmpdir(),'familyhub-full-claim-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const {confirmedInvoiceIllness,confirmInvoiceIllness}=await import('../apps/worker/dist/claim-invoice-answers.js');
const {confirmBlueCrossClaimCause}=await import('../apps/worker/dist/bluecross-claim-cause.js');
const {receiptChecklist}=await import('../apps/worker/dist/bluecross-receipt-checklist.js');
const illness='Owner-described symptom',marker='<table id="grdClaimsGrid"><tr><td>Authenticated synthetic marker</td></tr></table>';
let session,page;
try{
 await confirmBlueCrossClaimCause({confirmed:true,allInvoices:true,expectedRevision:0,value:'unrelated'});
 for(const scenario of ['complete-preparation','unknown-required']){
 const dossier={...receiptDossier,expenseId:'synthetic-full-'+scenario,fields:{...receiptDossier.fields,patient:'Kevin',service:'20 min Chiropractic Return',otherInsurance:'Yes',otherInsurancePaid:0}};
 const answer=await confirmedInvoiceIllness(dossier);await confirmInvoiceIllness(dossier,{confirmed:true,expectedScope:answer.scope,expectedRevision:answer.revision,value:illness});
 const counts={kind:0,cause:0,details:0,summary:0,entry:0,upload:0};
 const next=(id,action)=>`<button id="form_${id}" onclick="${action}">Next</button>`;
 const grid='<table id="form_ucClaimExpenseGrid_grdExpenseGrid"><tr>'+['Kevin','Chiropractor','Sample Practitioner','Chiropractic - In Person - Subsequent Treatment','Oct 13, 2026','$80.00',illness].map(x=>'<td>'+x+'</td>').join('')+'</tr></table>';
 const consent='<label><input type="checkbox" id="form_ucSubmitClaim_chkConsent">I confirm all the information above is correct and I have read and agree</label><button onclick="window.sent=true">Submit</button>';
 const uploader=marker+'<h1>Claim Documentation Required</h1><h2>Upload Documents</h2>'+grid+consent+'<div id="form_ucSubmitClaim_radAsyncUpload"><ul><li><input type="file" id="form_radAsyncUploadfile0" onchange="record(\'upload\');document.getElementById(\'uploaded\').innerHTML=\'<span class=ruUploadSuccess>synthetic.pdf</span>\'"></li><li id="uploaded"></li></ul></div>';
 const review=marker+'<h1>Additional Information Required</h1>'+grid+consent+'<input type="button" id="form_ucSubmitClaim_btnUploadReceipt" value="Upload my documents" onclick="record(\'entry\');document.body.innerHTML=window.uploader">';
 const summary=marker+'<h1>Your Expenses</h1>'+grid.replace('</tr>','<td>Edit | Copy | Delete</td></tr>')+next('StepNavigationTemplateContainerID_StepNextButton',"record('summary');document.body.innerHTML=window.review");
 const combo=(suffix,label,value)=>`<span>${label}</span><input type="text" name="form_${suffix}_Input" id="form_${suffix}_Input" readonly onclick="document.getElementById('form_${suffix}_DropDown').hidden=false" onkeydown="if(event.key==='Escape')document.getElementById('form_${suffix}_DropDown').hidden=true"><ul id="form_${suffix}_DropDown" hidden><li onclick="document.getElementById('form_${suffix}_Input').value=this.textContent;this.parentElement.hidden=true">${value}</li></ul>`;
 const details=marker+'<h1>Claim Details</h1>'+combo('cmbCoveredLife','Claimant','Kevin')+combo('cmbBenefit','Benefit','Chiropractor')+combo('cmbExpenseType','Type of expense','Chiropractic - In Person - Subsequent Treatment')+'<div><input type="checkbox" id="receipt">'+receiptChecklist+'</div><input id="form_calServiceDate_calcalServiceDate_dateInput"><input id="form_txtAmount"><label>Amount paid by public or provincial plan $<input></label>'+combo('cmbOtherInsurancePlan','Has this expense been submitted to another insurance plan?','Yes')+'<input id="form_txtOtherPlanAmt"><input id="form_txtIllness"><label><input type="radio" name="provider" id="form_repProvider_0_optProvider">Dr. Sample Practitioner - #100 - 123 Sample St.</label>'+(scenario==='unknown-required'?'<label>Additional required fact<input required></label>':'')+next('StepNavigationTemplateContainerID_StepNextButton',"record('details');document.body.innerHTML=window.summary");
 const labels=[['YesICBC','I am claiming services related to an ICBC or other auto insurance case.'],['YesWCB','I am claiming services related to a WorkSafe case (WCB).'],['YesAccident','I am claiming services related to an accident.'],['YesEmergency','I am claiming services related to a medical emergency that occurred while travelling outside of Canada.'],['No','The service or product provided is not related in any way to a motor vehicle incident, workplace incident, or any other accident where ICBC, WorkSafe BC, or any other liable third party may become involved, and is not related to a medical emergency while travelling outside of Canada.']];
 const cause=marker+'<p>Please select one of the following:</p>'+labels.map(([suffix,label])=>`<label><input type="radio" name="cause" id="form_ucClaimCause_optClaimCause${suffix}" onchange="document.getElementById('cause-next').hidden=false">${label}</label>`).join('')+'<div id="cause-next" hidden>'+next('StartNavigationTemplateContainerID_StartNextButton',"record('cause');document.body.innerHTML=window.details")+'</div>';
 const kind=marker+'<h1>What kind of claim would you like to submit?</h1>'+['Health Care','Drugs','Vision Care','Dental (Orthodontic)',"I don’t see the expense listed"].map(label=>'<label><input type="radio" name="kind">'+label+'</label>').join('')+next('StartNavigationTemplateContainerID_StartNextButton',"record('kind');document.body.innerHTML=window.cause");
 const launch=async()=>{const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});await context.exposeFunction('record',name=>counts[name]++);await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<script>'+Object.entries({cause,details,summary,review,uploader}).map(([k,v])=>'window.'+k+'='+JSON.stringify(v)+';').join('')+'</script>'+kind}));context.on('page',p=>page=p);return context;};return browser;};
 const opened=await openClaimBrowser(dossier,false,false,launch,true);session=opened.sessionId;
 const load=async()=>({name:'synthetic.pdf',bytes:receiptPdf(receiptText.replaceAll('Sample Patient','Kevin Example'))});
 const prepared=await prepareCurrentClaimStep(session,load);
 assert.equal(counts.kind,1);assert.equal(counts.cause,1);
 if(scenario==='complete-preparation'){
  assert.deepEqual(counts,{kind:1,cause:1,details:1,summary:1,entry:1,upload:1});assert.equal(prepared.step.status,'review');assert.equal(prepared.verification.attachment.status,'verified');assert.equal(await page.locator('#form_ucSubmitClaim_chkConsent').isChecked(),false);assert.equal(await page.evaluate(()=>!!window.sent),false);
  await prepareCurrentClaimStep(session,load);assert.equal(counts.upload,1,'No upload replay');
 }else{assert.equal(counts.details,0);assert.equal(counts.summary,0);assert.equal(counts.upload,0);assert.ok(prepared.step.fields.some(f=>f.label==='Additional required fact'));}
 await closeClaimBrowser(session);session=undefined;
 }
 console.log(JSON.stringify({passed:2,coverage:'real orchestrator from category/cause to original receipt; mandatory field abstention',insurerContact:false,consent:false,submission:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(dir,{recursive:true,force:true});}