import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {desjardinsSummaryPath,desjardinsCompactSummary,openDesjardinsSummaryDetails} from '../apps/worker/dist/desjardins-claim-summary.js';
import {dossier} from './fixtures/desjardins-receipt.mjs';
const origin='https://www.agea-gbim.dsf-dfs.com',text='Résumé des frais\nTraitement subséquent\n25,00 $\n12 janvier 2026\nMontant total réclamé\n25,00 $';
assert.equal(desjardinsCompactSummary(text,dossier),true);assert.equal(desjardinsCompactSummary(text.replaceAll('25,00','120,00'),dossier),false);assert.equal(desjardinsCompactSummary(text.replace('12 janvier','13 janvier'),dossier),false);
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try{
 for(const scenario of ['match','wrong-amount','ambiguous','extra-field','foreign']){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let reserved=0;
  const button='<button id="voir-les-détails" onclick="window.expanded=true;document.querySelector(\'#readback\').textContent=\'Expanded expense facts\'">Voir les détails</button>';
  await c.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<main>'+text.replaceAll(scenario==='wrong-amount'?'25,00':'nothing','120,00').split('\n').map(l=>'<p>'+l+'</p>').join('')+button+(scenario==='ambiguous'?button:'')+(scenario==='extra-field'?'<input>':'')+'<p id="readback"></p><button onclick="window.next=true">Continuer</button></main>'}));
  await p.goto((scenario==='foreign'?'https://untrusted.invalid':origin)+desjardinsSummaryPath);
  assert.equal(await openDesjardinsSummaryDetails(p,dossier,()=>reserved++),scenario==='match',scenario);assert.equal(reserved,scenario==='match'?1:0);
  assert.equal(await p.evaluate(()=>!!window.next),false);if(scenario==='match')assert.equal(await p.locator('#readback').innerText(),'Expanded expense facts');await c.close();
 }
 console.log(JSON.stringify({passed:8,insurerContact:false,claimSubmitted:false}));
}finally{await browser.close();}
