/** Synthetic browser DOM; all network requests are intercepted. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'familyhub-auto-claim-'));process.env.FAMILYHUB_WORKER_DATA=directory;
const {openClaimBrowser,prepareCurrentClaimStep,verifyClaimStep,closeClaimBrowser,claimSessionExpense}=await import('../apps/worker/dist/claim-browser.js');
const {acquirePortalLock}=await import('../apps/worker/dist/portal-login.js');
const {confirmedInvoiceIllness,confirmInvoiceIllness}=await import('../apps/worker/dist/claim-invoice-answers.js');
const dossier={expenseId:'synthetic',insurer:'blue-cross',portalUrl:'https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx',blocked:false,reviewableWarnings:[],fields:{patient:null,provider:'Synthetic Clinic',service:'Physiotherapy',originalAmount:100,otherInsurance:'Yes',otherInsurancePaid:0},attachments:[{documentId:'synthetic',attachmentId:'pdf',name:'synthetic.pdf'}]};
let page,session,uploads=0,contacts=0;
const launch=async()=>{
 const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
 browser.newContext=async()=>{
  const context=await original({serviceWorkers:'block'});
  await context.route('**/*',route=>{contacts++;return route.fulfill({contentType:'text/html',body:`<h1>Claim Details</h1><table id="grdClaimsGrid"><tr><td>Authenticated synthetic history marker</td></tr></table>
  <label>Amount<input id="form_txtAmount"></label>
  <label>Service<select id="service" onchange="document.querySelector('#dependent').innerHTML='<label>Amount paid by another insurance plan<input id=form_txtOtherPlanAmt></label>'"><option value="">Choose</option><option value="physio">Physiotherapy</option></select></label>
  <div id="dependent"></div><label>Nature of illness/injury<input id="form_txtIllness"></label>
  <label>Supporting document<input id="upload" type="file" onchange="window.uploads=(window.uploads||0)+1;document.querySelector('#status').textContent=this.files[0].name+' uploaded successfully'"></label>
  <div role="status" id="status"></div><div role="alert" id="alert"></div>
  <button onclick="window.next=true">Next</button><button onclick="window.sent=true">Submit</button><input type="checkbox" aria-label="Attestation">`})});
  context.on('page',p=>{page=p});return context;
 };return browser;
};
try{
 // Opening with autonomous authorization no longer requires a pre-review checkbox.
 const opened=await openClaimBrowser(dossier,false,false,launch,true);session=opened.sessionId;
 await assert.rejects(acquirePortalLock('bluecross'),/busy/);
 let freshChecks=0;
 const prepare=()=>prepareCurrentClaimStep(session,async()=>{uploads++;return {name:'synthetic.pdf',bytes:Buffer.from('%PDF-synthetic')}},()=>freshChecks++);
 const result=await prepare();
 assert.equal(await page.locator('#form_txtAmount').inputValue(),'100.00');
 assert.equal(await page.locator('#service').inputValue(),'physio');
 assert.equal(await page.locator('#form_txtOtherPlanAmt').inputValue(),'0.00');
 assert.equal(await page.locator('#form_txtIllness').inputValue(),'');
 assert.equal(result.verification.attachment.status,'verified');
 assert.equal(result.verification.fields.every(f=>f.status==='match'),true);
 assert.equal(result.step.fields.some(f=>f.kind==='natureOfIllness'),true);
 assert.ok(freshChecks>=3);assert.equal(uploads,1);
 await prepare();assert.equal(uploads,1,'Resuming must not repeat a selected PDF');
 const answer=await confirmedInvoiceIllness(dossier);
 await confirmInvoiceIllness(dossier,{confirmed:true,expectedScope:answer.scope,expectedRevision:answer.revision,value:'Owner-described symptom'});
 const withAnswer=await prepare();
 assert.equal(await page.locator('#form_txtIllness').inputValue(),'Owner-described symptom');
 assert.equal(withAnswer.verification.fields.find(f=>f.kind==='natureOfIllness').status,'match');
 assert.equal(uploads,1,'Saving an answer cannot replay the PDF');
 await page.locator('#form_txtOtherPlanAmt').fill('80.00');
 assert.equal((await verifyClaimStep(session)).readyForManualNext,false);
 assert.equal((await prepare()).verification.fields.find(f=>f.kind==='otherInsurancePaid').status,'mismatch');
 assert.equal(await page.evaluate(()=>!!window.sent||!!window.next),false);
 assert.equal(await page.getByLabel('Attestation').isChecked(),false);
 await assert.rejects(access(join(directory,'bluecross','login-control.json')),'A reused session must not write the login latch');
 await closeClaimBrowser(session);session=undefined;
 const unlock=await acquirePortalLock('bluecross');await unlock();
 // A single upload input can request another insurer's explanation, not the invoice.
 const explanation=await openClaimBrowser({...dossier,expenseId:'explanation-test'},false,false,launch,true);session=explanation.sessionId;
 await page.locator('#upload').evaluate(el=>el.parentElement.firstChild.textContent='Other insurer explanation of benefits');
 const abstained=await prepare();assert.equal(abstained.verification.attachment,null);assert.equal(uploads,1);
 await closeClaimBrowser(session);session=undefined;
 // Multiple source PDFs must abstain, without losing the rest of preparation.
 const again=await openClaimBrowser({...dossier,attachments:[...dossier.attachments,{documentId:'copy',attachmentId:'pdf',name:'copy.pdf'}]},false,false,launch,true);session=again.sessionId;
 const multi=await prepareCurrentClaimStep(session,async id=>({name:id==='copy'?'copy.pdf':'synthetic.pdf',bytes:Buffer.from('%PDF-'+id)}));assert.equal(multi.verification.attachment,null);assert.equal(uploads,1);
 // Identical forwarded/original copies are one choice; source freshness still sees both.
 await closeClaimBrowser(session);session=undefined;
 const duplicateDossier={...dossier,expenseId:'identical-copy-test',attachments:[{documentId:'original',attachmentId:'one',name:'synthetic.pdf'},{documentId:'forward',attachmentId:'two',name:'synthetic.pdf'}]};
 const duplicate=await openClaimBrowser(duplicateDossier,false,false,launch,true);session=duplicate.sessionId;
 const copyLoader=async()=>({name:'synthetic.pdf',bytes:Buffer.from('%PDF-identical-copies')});
 const resolved=await prepareCurrentClaimStep(session,copyLoader,()=>assert.deepEqual(claimSessionExpense(session).attachments,duplicateDossier.attachments));
 assert.equal(resolved.verification.attachment.status,'verified');
 assert.equal(await page.evaluate(()=>window.uploads),1);
 assert.deepEqual(claimSessionExpense(session).attachments,duplicateDossier.attachments);
 await prepareCurrentClaimStep(session,copyLoader);
 assert.equal(await page.evaluate(()=>window.uploads),1,'Identical-copy resolution must not bypass upload no-replay');
 // A final review never invokes any field fill or upload.
 await page.locator('h1').evaluate(el=>el.textContent='Review your claim');
 const review=await prepare();assert.equal(review.step.status,'review');assert.equal(uploads,1);
 assert.equal(await page.evaluate(()=>!!window.sent||!!window.next),false);
 console.log(JSON.stringify({passed:5,coverage:['automatic-text-select-dependent-zero','unique-upload-readback-no-replay','unknown-diagnosis','cumulative-mismatch','shared-login-lock','session-reuse-no-credentials','ambiguous-documents','byte-identical-copies-source-freshness-no-replay','explanation-upload-is-not-receipt','final-review-no-submit'],interceptedRequests:contacts,insurerContact:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(directory,{recursive:true,force:true});}
