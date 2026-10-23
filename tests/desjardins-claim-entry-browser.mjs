/** Public-guide navigation labels, intercepted synthetic portal only. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {openDesjardinsClaimEntry} from '../apps/worker/dist/desjardins-claim-entry.js';
const origin='https://www.agea-gbim.dsf-dfs.com',history='/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx',claim='/AGEA-GBIM/Reclamation/Introduction_Introduction.aspx';
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try {
 for(const scenario of ['visible','menu','ambiguous','foreign-link','missing','challenge','unknown-page','blocked']) {
  const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let reservations=0,claims=0;
  await c.route('**/*',r=>{
   const path=new URL(r.request().url()).pathname;
   if(path===claim){claims++;return r.fulfill({contentType:'text/html',body:'<h1>Réclamation pour soins de santé</h1><button>Commencer</button>'});}
   const link='<a '+(scenario==='menu'?'style="display:none" id="entry"':'')+' href="'+(scenario==='foreign-link'?'https://unrelated.invalid':'')+claim+'">Réclamation en ligne</a>';
   const body='<table class="tableau-donnees"><tr><td>Synthetic history</td></tr></table>'+(scenario==='missing'?'':link)+(scenario==='ambiguous'?link:'')+(scenario==='menu'?'<a href="#" onclick="document.querySelector(\'#entry\').style.display=\'block\';return false">Faire une réclamation</a>':'')+(scenario==='challenge'?'<input autocomplete="one-time-code">':'');
   return r.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  await p.goto(origin+(scenario==='unknown-page'?'/unknown':history));
  const ok=['visible','menu'].includes(scenario);
  assert.equal(await openDesjardinsClaimEntry(p,{insurer:'desjardins',blocked:scenario==='blocked'},()=>reservations++),ok,scenario);
  assert.equal(claims,ok?1:0,scenario);assert.equal(reservations,ok?1:0,scenario);
  if(ok){assert.equal(await p.getByRole('button',{name:'Commencer',exact:true}).count(),1);}
  await c.close();
 }
 console.log(JSON.stringify({passed:8,coverage:'unique owned history entry, menu expansion, ambiguity, foreign destination, missing/challenge/unknown/blocked abstention',insurerContact:false,claimSubmitted:false}));
}finally{await browser.close();}