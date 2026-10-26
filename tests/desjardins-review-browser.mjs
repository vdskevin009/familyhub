import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {dossier} from './fixtures/desjardins-receipt.mjs';import {summary} from './fixtures/desjardins-summary.mjs';
import {readDesjardinsFinalReview,desjardinsReviewPath} from '../apps/worker/dist/desjardins-claim-summary.js';
import {desjardinsAliasFingerprint} from '../apps/worker/dist/desjardins-collector.js';
const origin='https://www.agea-gbim.dsf-dfs.com',header='Validation\nType de réclamation\nProfessionnels de la santé\nPersonne assurée\nALICE MIDDLE EXAMPLE\nFournisseur\nMorgan Example\nPhysiothérapeute\n';
const aliases={[desjardinsAliasFingerprint('EXAMPLE ALICE MIDDLE')]:'Alice'};
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try{
 for(const scenario of ['match','wrong-patient','wrong-provider','wrong-cost','missing-confirmation','checked-consent','receipt-requested']){
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();
  const text=(header+summary.replace('Résumé des frais','Détail')).replace(scenario==='wrong-patient'?'ALICE MIDDLE EXAMPLE':scenario==='wrong-provider'?'Morgan Example':scenario==='wrong-cost'?'120,00':'nothing',scenario==='wrong-cost'?'100,00':'OTHER PERSON');
  await c.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<main>'+text.split('\n').map(s=>'<p>'+s+'</p>').join('')+(scenario==='missing-confirmation'?'':'<button onclick="window.sent=true">Confirmer</button>')+(scenario==='checked-consent'?'<input type="checkbox" checked>':'')+(scenario==='receipt-requested'?'<input type="file" aria-label="Reçu">':'')+'</main>'}));
  await p.goto(origin+desjardinsReviewPath);const read=await readDesjardinsFinalReview(p,dossier,true,true,aliases);
  assert.equal(read.summary.matches,['match','receipt-requested'].includes(scenario),scenario);assert.equal(read.fileInputs,scenario==='receipt-requested'?1:0);assert.equal(await p.evaluate(()=>!!window.sent),false);await c.close();
 }
 console.log(JSON.stringify({passed:7,insurerContact:false,claimSubmitted:false}));
}finally{await browser.close();}
