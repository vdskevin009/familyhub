/** Login is simulated; every request is intercepted and no insurer is contacted. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'familyhub-manual-login-'));
process.env.FAMILYHUB_WORKER_DATA=directory;
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const dossier={expenseId:'synthetic',insurer:'blue-cross',portalUrl:'https://service.pac.bluecross.ca/member/login/',blocked:false,reviewableWarnings:[],fields:{originalAmount:100},attachments:[]};
let session,page,clicks=0,uploads=0;
try{
 for(const scenario of ['redirect','new-tab','uncertain','ambiguous']){
  clicks=0;
  const launch=async()=>{
   const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
   browser.newContext=async()=>{
    const context=await original({serviceWorkers:'block'});
    await context.exposeFunction('recordEntry',()=>{clicks++});
    await context.route('**/*',route=>{
     const path=new URL(route.request().url()).pathname;
     let body;
     if(path==='/member/login/')body='<h1>Login</h1><input id="password" type="password">';
     else if(path==='/member/'){
      const action=scenario==='redirect'?"location.href='/ACESWeb/Pages/Claims/eClaim.aspx'":scenario==='new-tab'?"window.open('/ACESWeb/Pages/Claims/eClaim.aspx')":'';
      const entry=`<div class="caresnet-link"><div class="quick-nav__item--claim" onclick="recordEntry();${action}">SUBMIT CLAIMS &amp; FORMS</div></div>`;
      body='<h1>Member home</h1><input id="unlabelled-search">'+entry+(scenario==='ambiguous'?entry:'');
     }else body='<h1>Claim Details</h1><label>Amount<input id="form_txtAmount"></label><button onclick="window.submitted=true">Submit</button><button onclick="window.next=true">Next</button><label><input type="checkbox">Attestation</label>';
     return route.fulfill({contentType:'text/html',body});
    });
    const newPage=context.newPage.bind(context);context.newPage=async()=>{page=await newPage();return page};return context;
   };return browser;
  };
  const opened=await openClaimBrowser(dossier,false,false,launch,true);session=opened.sessionId;
  assert.equal(opened.step.status,'login-required');assert.equal(clicks,0);
  await page.goto('https://service.pac.bluecross.ca/member/');
  const prepare=()=>prepareCurrentClaimStep(session,async()=>{uploads++;throw Error('Unexpected upload')});
  const result=await prepare();
  assert.equal(clicks,scenario==='ambiguous'?0:1);
  if(['redirect','new-tab'].includes(scenario)){
   const form=page.context().pages().find(p=>p.url().includes('/Claims/eClaim.aspx'));
   assert.equal(await form.locator('#form_txtAmount').inputValue(),'100.00');
   assert.equal(await form.evaluate(()=>!!window.submitted||!!window.next),false);
   assert.equal(await form.getByLabel('Attestation').isChecked(),false);
   assert.equal(result.verification.fields[0].status,'match');
  }else{
   assert.equal(result.step.status,'navigate');assert.deepEqual(result.step.fields,[]);
   assert.equal(await page.locator('#unlabelled-search').inputValue(),'');
  }
  await prepare();assert.equal(clicks,scenario==='ambiguous'?0:1,'No repeated navigation');
  assert.equal(uploads,0);
  await closeClaimBrowser(session);session=undefined;
 }
 console.log(JSON.stringify({passed:4,scenarios:['manual-login-redirect','manual-login-new-tab','uncertain-navigation-not-replayed','ambiguous-home-not-a-claim-form'],insurerContact:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(directory,{recursive:true,force:true});}
