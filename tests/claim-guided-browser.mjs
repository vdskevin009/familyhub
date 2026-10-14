/** Real browser DOM, synthetic invoice/portal only; no insurance network. */
import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'familyhub-guided-browser-'));process.env.FAMILYHUB_WORKER_DATA=directory;
const {openClaimBrowser,fillClaimStep,verifyClaimStep,inspectClaimStep,closeClaimBrowser,forgetClaimServiceChoices}=await import('../apps/worker/dist/claim-browser.js');
const dossier={expenseId:'synthetic',insurer:'blue-cross',portalUrl:'https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx',blocked:false,reviewableWarnings:[],fields:{patient:'Kevin',provider:'Sample Clinic',service:'Physiotherapy',originalAmount:100,otherInsurance:'Yes',otherInsurancePaid:64},attachments:[{documentId:'synthetic',attachmentId:'pdf',name:'synthetic.pdf'}]};
let page,session;
const launch=async()=>{
 const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
 browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<h1>Claim Details</h1><label>Type of service<select id="service"><option value=""></option><option value="follow">Physiotherapy follow-up</option><option value="initial">Initial assessment</option></select></label><label>Total amount of expense<input id="form_txtAmount"></label><label>Amount paid by another insurance plan<input id="form_txtOtherPlanAmt"></label><label>Supporting document<input id="upload" type="file"></label><div role="status" id="status"></div><div role="alert" id="alert"></div><button onclick="window.next=true">Next</button><button onclick="window.sent=true">Submit</button><input type="checkbox" aria-label="Attestation">`}));context.on('page',p=>{page=p});return context};return browser;
};
try{
 const opened=await openClaimBrowser(dossier,true,false,launch);session=opened.sessionId;const step=opened.step;
 const service=step.fields.find(f=>f.kind==='service');assert.equal(service.suggested,null);
 const values=Object.fromEntries(step.fields.filter(f=>f.kind).map(f=>[f.key,f.kind==='service'?'follow':f.suggested]));
 const filled=await fillClaimStep(session,step.revision,values,null,async()=>{},true);assert.equal(filled.verification.readyForManualNext,true);assert.equal(filled.choicesSaved,1);assert.equal(filled.verification.fields.every(f=>f.status==='match'),true);
 await page.locator('#form_txtOtherPlanAmt').fill('80.00');let checks=await verifyClaimStep(session);assert.equal(checks.readyForManualNext,false);assert.equal(checks.fields.find(f=>f.kind==='otherInsurancePaid').status,'mismatch');
 await page.locator('#form_txtOtherPlanAmt').fill('64.00');assert.equal((await verifyClaimStep(session)).readyForManualNext,true);
 await page.locator('#form_txtAmount').evaluate(el=>el.remove());assert.equal((await verifyClaimStep(session)).fields.find(f=>f.kind==='originalAmount').status,'unreadable');
 assert.equal(await page.evaluate(()=>!!window.sent||!!window.next),false);assert.equal(await page.getByLabel('Attestation').isChecked(),false);
 await closeClaimBrowser(session);session=undefined;
 const again=await openClaimBrowser(dossier,true,false,launch);session=again.sessionId;assert.equal(again.step.fields.find(f=>f.kind==='service').suggested,'follow');assert.equal(again.step.fields.find(f=>f.kind==='service').suggestionSource,'confirmed-choice');
 await forgetClaimServiceChoices(session);assert.equal((await inspectClaimStep(session)).fields.find(f=>f.kind==='service').suggested,null);
 const current=await inspectClaimStep(session);const uploaded=await fillClaimStep(session,current.revision,{},'synthetic:pdf',async()=>({name:'synthetic.pdf',bytes:Buffer.from('synthetic PDF')}));assert.equal(uploaded.verification.attachment.status,'unverified');assert.equal(uploaded.verification.readyForManualNext,false);
 await page.locator('#alert').evaluate(el=>el.textContent='synthetic.pdf upload failed');assert.equal((await verifyClaimStep(session)).attachment.status,'failed');
 await page.locator('#alert').evaluate(el=>el.textContent='');await page.locator('#status').evaluate(el=>el.textContent='synthetic.pdf uploaded successfully');assert.equal((await verifyClaimStep(session)).attachment.status,'verified');
 assert.equal(await page.evaluate(()=>!!window.sent||!!window.next),false);
 console.log(JSON.stringify({passed:1,coverage:['real-DOM-reviewed-fill','partial-amount-mismatch-and-correction','removed-field','durable-choice-reopen-reset','file-selection-not-upload','observed-upload-failure-and-success','no-next-submit-attestation'],insurerContact:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(directory,{recursive:true,force:true})}
