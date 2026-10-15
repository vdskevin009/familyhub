/** Dependent form inserts a field before the previously prepared illness. No insurer contact. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'familyhub-dependent-claim-'));process.env.FAMILYHUB_WORKER_DATA=directory;
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const {confirmedInvoiceIllness,confirmInvoiceIllness}=await import('../apps/worker/dist/claim-invoice-answers.js');
const dossier={expenseId:'synthetic-dependent',insurer:'blue-cross',portalUrl:'https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx',blocked:false,reviewableWarnings:[],fields:{originalAmount:100,service:'Physiotherapy',otherInsurancePaid:0},attachments:[]};
let page,session;
try{
 const answer=await confirmedInvoiceIllness(dossier);
 await confirmInvoiceIllness(dossier,{confirmed:true,expectedScope:answer.scope,expectedRevision:answer.revision,value:'Owner-described symptom'});
 const launch=async()=>{const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
  browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<h1>Claim Details</h1><table id="grdClaimsGrid"><tr><td>Authenticated synthetic marker</td></tr></table>
   <label>Amount<input id="form_txtAmount"></label>
   <label>Service<select id="service" onchange="document.getElementById('dependent').innerHTML='<label>Amount paid by another insurance plan<input id=form_txtOtherPlanAmt></label>'"><option value="">Choose</option><option value="physio">Physiotherapy</option></select></label>
   <div id="dependent"></div><label>Nature of illness/injury<input id="form_txtIllness"></label>
   <button onclick="window.next=true">Next</button><button onclick="window.sent=true">Submit</button><label><input type="checkbox">Final attestation</label>`}));context.on('page',p=>page=p);return context;};return browser;};
 const opened=await openClaimBrowser(dossier,false,false,launch,true);session=opened.sessionId;
 const result=await prepareCurrentClaimStep(session,async()=>{throw Error('No attachment expected')});
 assert.equal(await page.locator('#form_txtIllness').inputValue(),'Owner-described symptom');
 assert.equal(await page.locator('#form_txtOtherPlanAmt').inputValue(),'0.00');
 assert.equal(result.verification.fields.find(f=>f.kind==='natureOfIllness').status,'match');
 assert.equal(result.verification.fields.every(f=>f.status==='match'),true);
 assert.equal(await page.getByLabel('Final attestation').isChecked(),false);
 assert.equal(await page.evaluate(()=>!!window.next||!!window.sent),false);
 console.log(JSON.stringify({passed:1,coverage:'illness-readback-survives-dependent-field-insertion',insurerContact:false,submission:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(directory,{recursive:true,force:true});}
