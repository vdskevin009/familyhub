import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'familyhub-cause-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {blueCrossClaimCauseAnswer,confirmBlueCrossClaimCause}=await import('../apps/worker/dist/bluecross-claim-cause.js');
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const url='https://service.pac.bluecross.ca/ACESWeb/Pages/Claims/eClaim.aspx';
const dossier={expenseId:'synthetic-cause',insurer:'blue-cross',portalUrl:url,blocked:false,reviewableWarnings:[],fields:{service:'20 min Chiropractic Return',originalAmount:100},attachments:[]};
const labels=[['YesICBC','I am claiming services related to an ICBC or other auto insurance case.'],['YesWCB','I am claiming services related to a WorkSafe case (WCB).'],['YesAccident','I am claiming services related to an accident.'],['YesEmergency','I am claiming services related to a medical emergency that occurred while travelling outside of Canada.'],['No','The service or product provided is not related in any way to a motor vehicle incident, workplace incident, or any other accident where ICBC, WorkSafe BC, or any other liable third party may become involved, and is not related to a medical emergency while travelling outside of Canada.']];
const marker='<table id="grdClaimsGrid"><tr><td>Authenticated synthetic marker</td></tr></table>';
let session;
try {
 assert.equal((await blueCrossClaimCauseAnswer()).value,null);
 for(const input of [{value:'unrelated',allInvoices:true,expectedRevision:0},{value:'unrelated',confirmed:true,expectedRevision:0},{value:'guessed',confirmed:true,allInvoices:true,expectedRevision:0}])await assert.rejects(()=>confirmBlueCrossClaimCause(input));
 await confirmBlueCrossClaimCause({value:'unrelated',confirmed:true,allInvoices:true,expectedRevision:0});
 await assert.rejects(()=>confirmBlueCrossClaimCause({value:null,confirmed:true,allInvoices:true,expectedRevision:0}));
 const scenarios=['approved','already-selected','no-default','disabled','wrong-label','other-selected','duplicate','wrong-origin','review','uncertain','next-disabled','ambiguous-next','wrong-next-label','blocked','corrupt'];
 for(const scenario of scenarios){
  const prev=await blueCrossClaimCauseAnswer();await confirmBlueCrossClaimCause({value:scenario==='no-default'?null:'unrelated',confirmed:true,allInvoices:true,expectedRevision:prev.revision});
  const saved=JSON.stringify(await blueCrossClaimCauseAnswer());if(scenario==='corrupt')await writeFile(join(dir,'bluecross-claim-cause-answer.json'),'{}');
  let choices=0,advances=0,page;
  const form=marker+'<h1>Claim Details</h1><label>Amount<input id="form_txtAmount"></label><button onclick="window.sent=true">Submit</button><label><input type="checkbox">Final consent</label><button onclick="window.detailNext=true">Next</button>';
  const launch=async()=>{const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});await context.exposeFunction('recordChoice',()=>choices++);await context.exposeFunction('recordNext',()=>advances++);await context.route('**/*',route=>{
   const radios=labels.map(([suffix,label])=>`<label><input type="radio" name="cause" id="form_ucClaimCause_optClaimCause${suffix}" ${scenario==='disabled'&&suffix==='No'?'disabled':''} ${scenario==='already-selected'&&suffix==='No'||scenario==='other-selected'&&suffix==='YesICBC'?'checked':''} onchange="recordChoice();document.getElementById('next').hidden=false">${scenario==='wrong-label'&&suffix==='No'?'Changed cause text':label}</label>`).join('');
   const next=`<div id="next" ${scenario==='already-selected'?'':'hidden'}><button id="form_StartNavigationTemplateContainerID_StartNextButton" ${scenario==='next-disabled'?'disabled':''} onclick="recordNext();${scenario==='uncertain'?'':'document.body.innerHTML=window.formHTML'}">${scenario==='wrong-next-label'?'Submit':'Next'}</button>${scenario==='ambiguous-next'?'<button>Next</button>':''}</div>`;
   return route.fulfill({contentType:'text/html; charset=utf-8',body:marker+`<script>window.formHTML=${JSON.stringify(form)}</script><p>Please select one of the following:</p>`+radios+(scenario==='duplicate'?radios:'')+next+(scenario==='review'?'<h1>Review your claim</h1>':'')});});context.on('page',p=>page=p);return context;};return browser;};
  if(scenario==='blocked'){await assert.rejects(()=>openClaimBrowser({...dossier,blocked:true},false,false,launch,true));assert.equal(choices,0);assert.equal(advances,0);continue;}
  const opened=await openClaimBrowser({...dossier,expenseId:'synthetic-'+scenario,blocked:scenario==='blocked',portalUrl:scenario==='wrong-origin'?'https://foreign.invalid/':url},false,false,launch,true);session=opened.sessionId;
  const prepared=await prepareCurrentClaimStep(session,async()=>{throw Error('No upload permitted')});
  const success=['approved','already-selected'].includes(scenario);
  if(success){assert.equal(prepared.step.status,'fields',scenario);assert.equal(await page.locator('#form_txtAmount').inputValue(),'100.00');assert.equal(await page.getByLabel('Final consent').isChecked(),false);}
  await prepareCurrentClaimStep(session,async()=>{throw Error('No upload permitted')});
  assert.equal(choices,['approved','uncertain','next-disabled','ambiguous-next','wrong-next-label'].includes(scenario)?1:0,scenario+' selection');
  assert.equal(advances,success||scenario==='uncertain'?1:0,scenario+' next');
  assert.equal(await page.evaluate(()=>!!window.sent||!!window.detailNext),false,scenario+' no final actions');
  await closeClaimBrowser(session);session=undefined;
  if(scenario==='corrupt')await writeFile(join(dir,'bluecross-claim-cause-answer.json'),saved);
 }
 const before=await blueCrossClaimCauseAnswer();await confirmBlueCrossClaimCause({value:null,confirmed:true,allInvoices:true,expectedRevision:before.revision});assert.equal((await blueCrossClaimCauseAnswer()).value,null);
 console.log(JSON.stringify({passed:scenarios.length,scenarios,insurerContact:false,submission:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(dir,{recursive:true,force:true});}