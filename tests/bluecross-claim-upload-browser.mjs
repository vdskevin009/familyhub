/** Observed upload entry/control, synthetic receipts and intercepted network only. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'familyhub-receipt-upload-'));process.env.FAMILYHUB_WORKER_DATA=directory;
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const portal='https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx';
const base={expenseId:'synthetic-upload',insurer:'blue-cross',portalUrl:portal,blocked:false,reviewableWarnings:[],fields:{patient:'Kevin',service:'20 min Chiropractic Return',serviceDate:'2026-09-01',originalAmount:100},attachments:[{documentId:'synthetic',attachmentId:'pdf',name:'synthetic.pdf'}]};
const scenarios=['entry','uploader','upload-failed','upload-uncertain','duplicate-success','uncertain-entry','ambiguous-entry','changed-entry','wrong-amount','wrong-date','wrong-patient','multiple-pdfs','already-listed','consent-checked','generic-review','wrong-origin','completed','optional','required'];
let session,page;
try{
 for(const scenario of scenarios){
  let selections=0,entries=0;
  const dossier={...base,expenseId:base.expenseId+'-'+scenario,...(scenario==='wrong-origin'?{portalUrl:'https://foreign.invalid/'}:{}),...(scenario==='multiple-pdfs'?{attachments:[...base.attachments,{documentId:'second',attachmentId:'pdf',name:'second.pdf'}]}:{})};
  const marker='<table id="grdClaimsGrid"><tr><td>Authenticated synthetic history</td></tr></table>';
  const consent=`<label><input type="checkbox" id="form_ucSubmitClaim_chkConsent" ${scenario==='consent-checked'?'checked':''}>I confirm all the information above is correct and I have read and agree</label>`;
  const grid=`<table id="form_ucClaimExpenseGrid_grdExpenseGrid"><tr>${[scenario==='wrong-patient'?'Jasmine':'Kevin','Chiropractor','Synthetic Provider','Chiropractic - In Person - Subsequent Treatment',scenario==='wrong-date'?'Sep 2, 2026':'Sep 1, 2026',scenario==='wrong-amount'?'$90.00':'$100.00','Owner-described symptom'].map(x=>'<td>'+x+'</td>').join('')}</tr></table>`;
  const resultMarkup=scenario==='upload-uncertain'?'synthetic.pdf':scenario==='upload-failed'?'<span class="ruUploadFailure">synthetic.pdf</span>':'<span class="ruUploadSuccess">synthetic.pdf</span>'+(scenario==='duplicate-success'?'<span class="ruUploadSuccess">synthetic.pdf</span>':'');
  const uploader=marker+'<h1>Claim Documentation Required</h1><h2>Upload Documents</h2>'+grid+consent+`<div id="form_ucSubmitClaim_radAsyncUpload"><ul><li><input type="file" id="form_radAsyncUploadfile0" onchange="recordUpload();document.querySelector('#uploaded').innerHTML=window.uploadMarkup"></li>${scenario==='already-listed'?'<li>synthetic.pdf Remove</li>':''}<li id="uploaded"></li></ul></div><button onclick="window.sent=true">Submit</button>`;
  const entry=`<input type="button" id="form_ucSubmitClaim_btnUploadReceipt" value="${scenario==='changed-entry'?'Submit claim':'Upload my documents'}" onclick="recordEntry();${scenario==='uncertain-entry'?'':'document.body.innerHTML=window.uploader'}">`;
  const review=marker+`<script>window.uploadMarkup=${JSON.stringify(resultMarkup)};window.uploader=${JSON.stringify(uploader)}</script><h1>Additional Information Required</h1>`+grid+consent+entry+(scenario==='ambiguous-entry'?entry:'');
  const launch=async()=>{const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});await context.exposeFunction('recordUpload',()=>selections++);await context.exposeFunction('recordEntry',()=>entries++);await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<script>window.uploadMarkup='+JSON.stringify(resultMarkup)+'</script>'+(['optional','required'].includes(scenario)?marker+`<h1>Claim Details</h1><input id="form_txtAmount"><label>Amount paid by public or provincial plan $<input type="text" ${scenario==='required'?'required':''}></label>`:scenario==='generic-review'?marker+'<h1>Review your claim</h1><label>Supporting document<input type="file" onchange="recordUpload()"></label>':scenario==='completed'?review+'<h2>Your claim has been submitted</h2>':['uploader','already-listed','consent-checked'].includes(scenario)?uploader:review)}));context.on('page',p=>page=p);return context;};return browser;};
  const opened=await openClaimBrowser(dossier,false,false,launch,true);session=opened.sessionId;
  const prepared=await prepareCurrentClaimStep(session,async()=>({name:'synthetic.pdf',bytes:Buffer.from('%PDF-synthetic')}));
  const success=['entry','uploader','upload-failed','upload-uncertain','duplicate-success'].includes(scenario);
  assert.equal(selections,success?1:0,scenario);
  assert.equal(entries,['entry','upload-failed','upload-uncertain','duplicate-success','uncertain-entry'].includes(scenario)?1:0,scenario);
  if(success)assert.equal(prepared.verification.attachment.status,scenario==='upload-failed'?'failed':['upload-uncertain','duplicate-success'].includes(scenario)?'unverified':'verified');
  if(['optional','required'].includes(scenario)){
   const field=prepared.step.fields.find(f=>f.label==='Amount paid by public or provincial plan $');
   assert.equal(!!field.optional,scenario==='optional');
   assert.equal(await page.getByLabel('Amount paid by public or provincial plan $').inputValue(),'');
  }
  await prepareCurrentClaimStep(session,async()=>({name:'synthetic.pdf',bytes:Buffer.from('%PDF-synthetic')}));
  assert.equal(selections,success?1:0,'No upload replay');
  assert.equal(entries,['entry','upload-failed','upload-uncertain','duplicate-success','uncertain-entry'].includes(scenario)?1:0,'No navigation replay');
  assert.equal(await page.evaluate(()=>!!window.sent),false);
  if(await page.locator('#form_ucSubmitClaim_chkConsent').count())assert.equal(await page.locator('#form_ucSubmitClaim_chkConsent').isChecked(),scenario==='consent-checked');
  await closeClaimBrowser(session);session=undefined;
  if(scenario==='uploader'){
   const reopened=await openClaimBrowser(dossier,false,false,launch,true);session=reopened.sessionId;
   await prepareCurrentClaimStep(session,async()=>({name:'synthetic.pdf',bytes:Buffer.from('%PDF-synthetic')}));
   assert.equal(selections,1,'Durable reservation survives reopening');await closeClaimBrowser(session);session=undefined;
  }
 }
 console.log(JSON.stringify({passed:scenarios.length,scenarios,insurerContact:false,consent:false,submission:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(directory,{recursive:true,force:true});}
