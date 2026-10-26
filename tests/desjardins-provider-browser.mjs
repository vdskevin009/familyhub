/** Source receipt, exact saved provider and guarded continuation; synthetic only. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {dossier,receipt} from './fixtures/desjardins-receipt.mjs';
import {receiptPdf} from './fixtures/detailed-receipt.mjs';
const dir=await mkdtemp(join(tmpdir(),'familyhub-desjardins-provider-'));process.env.FAMILYHUB_WORKER_DATA=dir;
const {openClaimBrowser,prepareCurrentClaimStep,closeClaimBrowser}=await import('../apps/worker/dist/claim-browser.js');
const origin='https://www.agea-gbim.dsf-dfs.com',provider='/AGEA-GBIM/Reclamation/Fournisseur/ListeFournisseur_ProviderList.aspx',unknown='/AGEA-GBIM/Reclamation/Unknown_SyntheticStep.aspx';
let session;
try {
 for(const scenario of ['match','ambiguous','wrong-specialty','wrong-receipt','new-question']) {
  let page,continued=0;
  const launch=async()=>{
   const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined}),original=browser.newContext.bind(browser);
   browser.newContext=async()=>{const context=await original({serviceWorkers:'block'});context.on('page',p=>page=p);
    await context.route('**/*',r=>{
     if(new URL(r.request().url()).pathname===unknown){continued++;return r.fulfill({contentType:'text/html',body:'<main><h1>Unknown next step</h1><input type="checkbox" aria-label="Final consent"><button onclick="window.sent=true">Confirmer</button><button onclick="window.next=true">Continuer</button></main>'});}
     const radio=(id)=>'<label>Morgan Example<input type="radio" name="fournisseur" id="'+id+'"></label><p>'+(scenario==='wrong-specialty'?'Massothérapeute':'Physiothérapeute')+'</p>';
     return r.fulfill({contentType:'text/html; charset=utf-8',body:'<main><h1>Fournisseur</h1>'+radio('provider')+(scenario==='ambiguous'?radio('duplicate'):'')+(scenario==='new-question'?'<label>Unknown question<input type="radio" name="new-question"></label>':'')+'<button onclick="location.href=\''+unknown+'\'">Continuer</button></main>'});
    });return context;};return browser;
  };
  const source={...dossier,expenseId:'synthetic-'+scenario,portalUrl:origin+provider,preparationUrl:origin+provider};
  session=(await openClaimBrowser(source,false,false,launch,true,async()=>undefined)).sessionId;
  const load=async()=>({name:'synthetic.pdf',bytes:receiptPdf(scenario==='wrong-receipt'?receipt.replaceAll('$25.00','$26.00'):receipt)});
  const result=await prepareCurrentClaimStep(session,load);
  assert.equal(continued,scenario==='match'?1:0,scenario);
  if(scenario==='match'){
   assert.equal(new URL(page.url()).pathname,unknown);assert.equal(result.step.status,'navigate');
   await prepareCurrentClaimStep(session,load);assert.equal(continued,1,'Resuming cannot replay an earlier provider continuation');
   assert.equal(await page.getByLabel('Final consent').isChecked(),false);assert.equal(await page.evaluate(()=>!!window.sent||!!window.next),false);
  }
  await closeClaimBrowser(session);session=undefined;
 }
 console.log(JSON.stringify({passed:5,insurerContact:false,claimSubmitted:false}));
}finally{if(session)await closeClaimBrowser(session);await rm(dir,{recursive:true,force:true});}
