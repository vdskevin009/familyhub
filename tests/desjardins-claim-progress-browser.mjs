import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {advanceDesjardinsIntroduction} from '../apps/worker/dist/desjardins-claim-progress.js';
const origin='https://www.agea-gbim.dsf-dfs.com',intro='/AGEA-GBIM/Reclamation/Introduction_Introduction.aspx',type='/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try {
 for(const scenario of ['normal','checkbox','ambiguous','blocked','validation','foreign']) {
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let reserved=0,moved=0;
  await context.route('**/*',r=>{if(new URL(r.request().url()).pathname===type){moved++;return r.fulfill({contentType:'text/html',body:'Type de réclamation'});}
   const button='<button onclick="location.href=\''+type+'\'">Commencer</button>';
   return r.fulfill({contentType:'text/html; charset=utf-8',body:'<main><h1>Réclamation pour soins de santé</h1>'+button+(scenario==='checkbox'?'<input type="checkbox" aria-label="Consentement">':'')+(scenario==='ambiguous'?button:'')+'</main>'});});
  await page.goto((scenario==='foreign'?'https://untrusted.invalid':origin)+(scenario==='validation'?'/AGEA-GBIM/Reclamation/Validation_Validation.aspx':intro));
  assert.equal(await advanceDesjardinsIntroduction(page,{insurer:'desjardins',blocked:scenario==='blocked'},()=>reserved++),scenario==='normal',scenario);
  assert.equal(reserved,scenario==='normal'?1:0);assert.equal(moved,scenario==='normal'?1:0);await context.close();
 }
 console.log(JSON.stringify({passed:6,insurerContact:false,claimSubmitted:false}));
}finally{await browser.close();}
