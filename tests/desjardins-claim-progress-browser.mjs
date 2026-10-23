import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {advanceDesjardinsIntroduction,advanceDesjardinsRadio} from '../apps/worker/dist/desjardins-claim-progress.js';
import {desjardinsRadioSuggestion} from '../apps/worker/dist/desjardins-claim-form.js';
const origin='https://www.agea-gbim.dsf-dfs.com',intro='/AGEA-GBIM/Reclamation/Introduction_Introduction.aspx',type='/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try {
 for(const scenario of ['normal','checkbox','ambiguous','blocked','validation','foreign']) {
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let reserved=0,moved=0;
  await context.route('**/*',r=>{if(new URL(r.request().url()).pathname===type){moved++;return r.fulfill({contentType:'text/html',body:'<main><input type="radio" name="typeReclamation"></main>'});}
   const button='<button onclick="location.href=\''+type+'\'">Commencer</button>';
   return r.fulfill({contentType:'text/html; charset=utf-8',body:'<main><h1>Réclamation pour soins de santé</h1>'+button+(scenario==='checkbox'?'<input type="checkbox" aria-label="Consentement">':'')+(scenario==='ambiguous'?button:'')+'</main>'});});
  await page.goto((scenario==='foreign'?'https://untrusted.invalid':origin)+(scenario==='validation'?'/AGEA-GBIM/Reclamation/Validation_Validation.aspx':intro));
  assert.equal(await advanceDesjardinsIntroduction(page,{insurer:'desjardins',blocked:scenario==='blocked'},()=>reserved++),scenario==='normal',scenario);
  assert.equal(reserved,scenario==='normal'?1:0);assert.equal(moved,scenario==='normal'?1:0);await context.close();
 }
 const dossier={insurer:'desjardins',blocked:false,fields:{service:'Subsequent Physiotherapy Session (30 minutes)'}};
 const option={value:'observed',label:'Quel type de réclamation voulez-vous faire?Professionnels de la santé'};
 assert.equal(desjardinsRadioSuggestion('claimType',dossier,[option]),'observed');
 assert.equal(desjardinsRadioSuggestion('claimType',dossier,[option,option]),null);
 assert.equal(desjardinsRadioSuggestion('claimType',{...dossier,fields:{service:'Unknown'}},[option]),null);
 for(const scenario of ['ready','not-ready','unchecked','checkbox','validation']) {
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let reserved=0;
  const patient='/AGEA-GBIM/Reclamation/PersonneAssuree_InsuredPerson.aspx';
  await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:new URL(r.request().url()).pathname===patient?'<main><input type="radio" name="personneAssuree"></main>':'<main><input type="radio" name="typeReclamation" '+(scenario==='unchecked'?'':'checked')+'>'+(scenario==='checkbox'?'<input type="checkbox">':'')+'<button onclick="location.href=\''+patient+'\'">Continuer</button></main>'}));
  await page.goto(origin+(scenario==='validation'?'/AGEA-GBIM/Reclamation/Validation_Validation.aspx':type));
  assert.equal(await advanceDesjardinsRadio(page,scenario!=='not-ready',()=>reserved++),scenario==='ready',scenario);
  assert.equal(reserved,scenario==='ready'?1:0);await context.close();
 }
 console.log(JSON.stringify({passed:14,insurerContact:false,claimSubmitted:false}));
}finally{await browser.close();}
