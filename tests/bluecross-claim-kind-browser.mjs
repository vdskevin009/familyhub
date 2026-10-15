/** Observed claim-type chooser, synthetic records and intercepted network only. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'familyhub-claim-kind-'));process.env.FAMILYHUB_WORKER_DATA=directory;
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const {confirmedInvoiceIllness,confirmInvoiceIllness}=await import('../apps/worker/dist/claim-invoice-answers.js');
const {openBlueCrossHealthcareClaim}=await import('../apps/worker/dist/bluecross-claim-kind.js');
const portal='https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx';
const base={expenseId:'synthetic',insurer:'blue-cross',portalUrl:portal,blocked:false,reviewableWarnings:[],fields:{service:'20 min Chiropractic Return',originalAmount:100},attachments:[]};
const marker='<table id="grdClaimsGrid"><tr><td>Authenticated synthetic marker</td></tr></table>';
const form=marker+'<h1>Claim Details</h1><label>Amount<input id="form_txtAmount"></label><label>Nature of illness/injury<input id="form_txtIllness"></label><button onclick="window.next=true">Next</button><button onclick="window.sent=true">Submit</button><label><input type="checkbox">Final attestation</label>';
let session,selectedPage;
try{
 const scenarios=['healthcare','physiotherapy','new-tab','home-chain','hidden-copy','unknown-service','ambiguous','changed-options','wrong-heading','uncertain','password'];
 for(const scenario of scenarios){
  let choices=0,homes=0,contacts=0;
  const dossier={...base,expenseId:'synthetic-'+scenario,fields:{...base.fields,service:scenario==='unknown-service'?'Dental cleaning':scenario==='physiotherapy'?'Physiotherapy - 30 Min Follow Up Visit (30 minutes)':base.fields.service},...(scenario==='home-chain'?{portalUrl:'https://service.pac.bluecross.ca/member/'}:{})};
  const answer=await confirmedInvoiceIllness(dossier);
  await confirmInvoiceIllness(dossier,{confirmed:true,expectedScope:answer.scope,expectedRevision:answer.revision,value:'Owner-described symptom'});
  const launch=async()=>{const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
   browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});await context.exposeFunction('recordKind',()=>choices++);await context.exposeFunction('recordHome',()=>homes++);
    await context.route('**/*',route=>{contacts++;const url=new URL(route.request().url());
     let body;
     if(url.pathname==='/member/')body=marker+'<h1>Member home</h1><div class="caresnet-link"><div class="quick-nav__item--claim" onclick="recordHome();location.href=\'/ACESWeb/Pages/Claims/eClaim.aspx\'">SUBMIT CLAIMS &amp; FORMS</div></div>';
     else if(url.searchParams.has('details'))body=form;
     else{
      const action=scenario==='uncertain'?'':scenario==='new-tab'?"window.open('/ACESWeb/Pages/Claims/eClaim.aspx?details=1')":"document.body.innerHTML=window.formHTML";
      const health=`<button onclick="recordKind();${action}">Healthcare</button>`;
      body=marker+`<script>window.formHTML=${JSON.stringify(form)}</script><h1>${scenario==='wrong-heading'?'Review your claim':'What kind of claim would you like to submit?'}</h1>`
       +(scenario==='hidden-copy'?'<div hidden>'+health+'</div>':'')+health+(scenario==='ambiguous'?health:'')
       +`<button onclick="window.wrong=true">Drugs</button><button onclick="window.wrong=true">Vision Care</button><button onclick="window.wrong=true">${scenario==='changed-options'?'Dental':'Dental (Orthodontic)'}</button><button onclick="window.wrong=true">I don’t see the expense listed</button>`
       +(scenario==='password'?'<input type="password">':'');
     }
     return route.fulfill({contentType:'text/html; charset=utf-8',body});
    });context.on('page',page=>selectedPage=page);return context;};return browser;};
  const opened=await openClaimBrowser(dossier,false,false,launch,true);session=opened.sessionId;
  const success=['healthcare','physiotherapy','new-tab','home-chain','hidden-copy'].includes(scenario);
  if(success)assert.equal(opened.step.status,'fields',scenario);
  const prepared=await prepareCurrentClaimStep(session,async()=>{throw Error('Unexpected upload')});
  assert.equal(choices,success||scenario==='uncertain'?1:0,scenario);
  assert.equal(homes,scenario==='home-chain'?1:0);
  if(success){
   const page=selectedPage.context().pages().find(p=>p.url().includes('details=1'))||selectedPage;
   assert.equal(await page.locator('#form_txtAmount').inputValue(),'100.00');
   assert.equal(await page.locator('#form_txtIllness').inputValue(),'Owner-described symptom');
   assert.equal(prepared.verification.fields.every(f=>f.status==='match'),true);
   assert.equal(await page.getByLabel('Final attestation').isChecked(),false);
  }else assert.ok(['navigate','review','login-required'].includes(prepared.step.status),scenario);
  await prepareCurrentClaimStep(session,async()=>{throw Error('Unexpected upload')});
  assert.equal(choices,success||scenario==='uncertain'?1:0,'Choice cannot be replayed');
  for(const page of selectedPage.context().pages())assert.equal(await page.evaluate(()=>!!window.next||!!window.sent||!!window.wrong),false);
  if(scenario==='healthcare'){
   await selectedPage.goto('https://foreign.invalid/');
   assert.equal(await openBlueCrossHealthcareClaim(selectedPage,dossier),false);
  }
  assert.ok(contacts>0);await closeClaimBrowser(session);session=undefined;
 }
 console.log(JSON.stringify({passed:scenarios.length,scenarios,insurerContact:false,submission:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(directory,{recursive:true,force:true});}
