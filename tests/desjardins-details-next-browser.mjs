import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {advanceDesjardinsDetails} from '../apps/worker/dist/desjardins-claim-progress.js';
const origin='https://www.agea-gbim.dsf-dfs.com',path='/AGEA-GBIM/Reclamation/DetailFrais_ExpenseDetail.aspx',next='/AGEA-GBIM/Reclamation/Unknown_SyntheticStep.aspx';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try{
 for(const scenario of ['ready','not-ready','extra-field','unchecked','consent','ambiguous','unknown-path','foreign']){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let reserved=0,continued=0;
  const groups=['radioAccident','radioRemboursementObtenu','radioRemboursementGouvernement','radioRemboursementPrive','radioRemboursement'];
  await c.route('**/*',r=>{if(new URL(r.request().url()).pathname===next){continued++;return r.fulfill({contentType:'text/html',body:'<main><h1>Unknown next step</h1><button onclick="window.sent=true">Confirmer</button></main>'});}
   const button='<button onclick="location.href=\''+next+'\'">Continuer</button>';
   return r.fulfill({contentType:'text/html; charset=utf-8',body:'<main><h1>Frais de soins professionnels</h1><label>*Date des frais(facultatif)<input value="12-01-2026"></label><label>*Type de frais(facultatif)<select name="typeFrais"><option>Traitement subséquent</option></select></label><label>*Durée en minutes(facultatif)<input type="number" name="uniteMesure" value="30"></label><label>*Coût du produit ou du service(facultatif)<input name="montantService" value="120,00"></label><label>*Montant obtenu d’un régime privé(facultatif)<input name="montantPrive" value="95,00"></label>'+groups.map((g,i)=>'<input type="radio" name="'+g+'" '+(scenario==='unchecked'&&i===2?'':'checked')+'><input type="radio" name="'+g+'">').join('')+(scenario==='extra-field'?'<label>Unknown<input></label>':'')+(scenario==='consent'?'<input type="checkbox" aria-label="Consent">':'')+button+(scenario==='ambiguous'?button:'')+'</main>'});});
  await p.goto((scenario==='foreign'?'https://untrusted.invalid':origin)+(scenario==='unknown-path'?'/AGEA-GBIM/Reclamation/Validation_Validation.aspx':path));
  assert.equal(await advanceDesjardinsDetails(p,scenario!=='not-ready',()=>reserved++),scenario==='ready',scenario);
  assert.equal(reserved,scenario==='ready'?1:0,scenario);assert.equal(continued,scenario==='ready'?1:0,scenario);
  if(scenario==='ready')assert.equal(await p.evaluate(()=>!!window.sent),false);await c.close();
 }
 console.log(JSON.stringify({passed:8,insurerContact:false,claimSubmitted:false}));
}finally{await browser.close();}
