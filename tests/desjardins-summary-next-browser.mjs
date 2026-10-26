import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {dossier} from './fixtures/desjardins-receipt.mjs';import {summary} from './fixtures/desjardins-summary.mjs';
import {desjardinsSummaryPath,readDesjardinsExpenseSummary,advanceDesjardinsSummary} from '../apps/worker/dist/desjardins-claim-summary.js';
const origin='https://www.agea-gbim.dsf-dfs.com',next='/AGEA-GBIM/Reclamation/Unknown_SyntheticReview.aspx';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try{
 for(const scenario of ['match','wrong-cost','wrong-other-payment','wrong-duration','missing-owner-answer','missing-receipt','consent','ambiguous']){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let reserved=0,continued=0;
  const text=summary.replace(scenario==='wrong-cost'?'120,00':scenario==='wrong-other-payment'?'95,00':scenario==='wrong-duration'?'30 minutes':'nothing',scenario==='wrong-duration'?'60 minutes':'100,00');
  const button='<button onclick="location.href=\''+next+'\'">Continuer</button>';
  await c.route('**/*',r=>{if(new URL(r.request().url()).pathname===next){continued++;return r.fulfill({contentType:'text/html',body:'<main><h1>Next preparation page</h1><button onclick="window.sent=true">Confirmer</button></main>'});}
   return r.fulfill({contentType:'text/html; charset=utf-8',body:'<main>'+text.split('\n').map(s=>'<p>'+s+'</p>').join('')+'<button>Supprimer le poste</button>'+button+(scenario==='ambiguous'?button:'')+(scenario==='consent'?'<input type="checkbox" aria-label="Consent">':'')+'</main>'});});
  await p.goto(origin+desjardinsSummaryPath);const read=await readDesjardinsExpenseSummary(p,dossier,scenario!=='missing-owner-answer',scenario!=='missing-receipt');
  assert.equal(read.matches,!['wrong-cost','wrong-other-payment','wrong-duration','missing-owner-answer','missing-receipt'].includes(scenario),scenario);
  assert.equal(await advanceDesjardinsSummary(p,read.matches,()=>reserved++),scenario==='match',scenario);assert.equal(continued,scenario==='match'?1:0);assert.equal(reserved,scenario==='match'?1:0);assert.equal(await p.evaluate(()=>!!window.sent),false);await c.close();
 }
 console.log(JSON.stringify({passed:8,insurerContact:false,claimSubmitted:false}));
}finally{await browser.close();}
