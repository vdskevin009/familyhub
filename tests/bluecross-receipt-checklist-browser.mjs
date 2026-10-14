import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receiptDossier, receiptText, receiptPdf } from './fixtures/detailed-receipt.mjs';
const dir=await mkdtemp(join(tmpdir(),'familyhub-receipt-checklist-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {receiptChecklist,blueCrossReceiptCheckbox}=await import('../apps/worker/dist/bluecross-receipt-checklist.js');
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser,verifyClaimStep,fillClaimStep}=await import('../apps/worker/dist/claim-browser.js');
let session,page;
try{
 for(const scenario of ['verified','unpaid','extra-document','ambiguous','review','already-checked']){
  const launch=async()=>{const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}), original=browser.newContext.bind(browser);
   browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>${scenario==='review'?'Review your claim':'Claim Details'}</h1><table id="grdClaimsGrid"><tr><td>Authenticated synthetic marker</td></tr></table>
    <div><input id="receipt" type="checkbox" ${scenario==='already-checked'?'checked':''}>${receiptChecklist}${scenario==='extra-document'?' Also upload an explanation of benefits.':''}</div>
    ${scenario==='ambiguous'?`<div><input id="second" type="checkbox">${receiptChecklist}</div>`:''}
    <input type="checkbox" aria-label="Final attestation"><button onclick="window.sent=true">Submit</button><button onclick="window.next=true">Next</button>`}));context.on('page',p=>page=p);return context;};return browser;};
  const opened=await openClaimBrowser(receiptDossier,false,false,launch,true);session=opened.sessionId;
  const load=async()=>({name:'synthetic.pdf',bytes:receiptPdf(scenario==='unpaid'?receiptText.replace('Amount: $80.00','Amount: $40.00'):receiptText)});
  const result=await prepareCurrentClaimStep(session,load);
  assert.equal(await page.locator('#receipt').isChecked(),['verified','already-checked'].includes(scenario),scenario);
  if(scenario==='verified'){
   assert.equal(result.verification.fields.find(f=>f.kind==='supportingReceipt').status,'match');
   await prepareCurrentClaimStep(session,load);
   await page.locator('#receipt').uncheck();assert.equal((await verifyClaimStep(session)).readyForManualNext,false);
  }else if(scenario==='unpaid'){
   assert.match(result.warning,/PDF could not establish/);
   const field=result.step.fields.find(f=>f.kind==='supportingReceipt');
   await assert.rejects(fillClaimStep(session,result.step.revision,{[field.key]:'true'},null,load),/does not establish/);
  }else if(['extra-document','ambiguous'].includes(scenario))assert.equal(await blueCrossReceiptCheckbox(page),null);
  assert.equal(await page.getByLabel('Final attestation').isChecked(),false);assert.equal(await page.evaluate(()=>!!window.sent||!!window.next),false);
  await closeClaimBrowser(session);session=undefined;
 }
 console.log(JSON.stringify({passed:6,insurerContact:false,submission:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(dir,{recursive:true,force:true});}
