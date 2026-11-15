/** Synthetic built-PWA acceptance only. No private worker, bank or provider is contacted. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { financeFixture } from '../../../tests/finance-fixture.mjs';
import { expenseSnapshot } from '../../../tests/finance-source-expenses-fixture.mjs';
import { FinanceLibrary } from '../../worker/dist/finance-library.js';

import {SOURCE_EXPENSES_CAPABILITY as capability,validateSourceExpenses} from '../../worker/dist/finance-source-expenses-model.js';

const root = resolve('apps/web/dist'), temp = await mkdtemp(join(tmpdir(), 'familyhub-source-ui-synthetic-'));
const output = resolve('output/playwright/finance-source-expenses'); await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname, file = resolve(root, '.' + pathname.replace(/^\/familyhub/, ''));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(file)] ?? 'text/html'); res.end(await readFile(file === root || pathname.endsWith('/') ? join(root, 'index.html') : file)); } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port + '/familyhub/?view=finances';

const collectedAt=new Date(Date.now()-1000).toISOString(),source=validateSourceExpenses(expenseSnapshot(collectedAt));
const previous=validateSourceExpenses({...source,collectedAt:new Date(Date.parse(collectedAt)-3600000).toISOString(),evidenceSha256:'b'.repeat(64),rows:source.rows.filter(r=>!r.description.endsWith('refund'))});
const saved={revision:createHash('sha256').update(JSON.stringify([previous,source])).digest('hex'),snapshots:[previous,source]};
const many=validateSourceExpenses({...source,collectedAt:new Date(Date.parse(collectedAt)+500).toISOString(),evidenceSha256:'c'.repeat(64),rows:Array.from({length:85},(_,i)=>({...source.rows.find(r=>r.description.endsWith('purchase')),sourceKey:'fsi_'+createHash('sha256').update('synthetic-row-'+i).digest('hex'),description:'Achat fictif '+i}))});
const large={revision:createHash('sha256').update(JSON.stringify([previous,source,many])).digest('hex'),snapshots:[previous,source,many]};
const categoryCase=validateSourceExpenses({...source,evidenceSha256:'d'.repeat(64),rows:[['groceries',42000],['dining_drinks',18500],['shopping',12000],['transportation',8000],['entertainment',4500],['travel',-3500]].map(([primary,amount],i)=>({...source.rows.find(r=>r.description.endsWith('purchase')),sourceKey:'fsi_'+createHash('sha256').update('category-demo-'+i).digest('hex'),description:'Exemple fictif '+primary,outflowCents:amount,category:{primary,detailed:null,confidence:'HIGH'}}))});
const categorySaved={revision:'d'.repeat(64),snapshots:[categoryCase]};
let browser;
try {
 browser=await chromium.launch({...(process.env.FAMILYHUB_TEST_BROWSER_CHANNEL?{channel:process.env.FAMILYHUB_TEST_BROWSER_CHANNEL}:{}),headless:true});
 for(const width of [320,390,768,1440]){
  const lib=new FinanceLibrary(join(temp,String(width))),state=(await lib.import({bundle:financeFixture(),apply:true,expectedRevision:'empty'})).state,canonical=JSON.stringify(state);
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Vancouver',serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];let supported=true,mode='ready',reads=0,releaseDelayed,markDelayedStarted,delayedFinished;
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'})));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(url.origin===new URL(base).origin)return route.continue();
   if(url.hostname!=='synthetic-worker.invalid')return route.abort();
   if(req.method()==='OPTIONS')return route.fulfill({json:{}});if(req.method()!=='GET'){writes.push(path);return route.fulfill({status:403,json:{}});}
   if(path==='/finance/source-expenses'){reads++;if(mode==='delayed'){let finish;delayedFinished=new Promise(r=>{finish=r;});const gate=new Promise(r=>{releaseDelayed=r;});markDelayedStarted();await gate;await route.fulfill({json:{capability,state:saved}});finish();return;}if(mode==='categories')return route.fulfill({json:{capability,state:categorySaved}});if(mode==='large')return route.fulfill({json:{capability,state:large}});if(mode==='error')return route.fulfill({status:503,json:{error:'synthetic failure'}});if(mode==='empty')return route.fulfill({json:{capability,state:{revision:'empty',snapshots:[]}}});return route.fulfill({json:{capability,state:saved}});}
   const body=path==='/finances'?(mode==='no-ledger'?{...state,data:null}:state):path==='/health'?{status:'ok',version:'2.30.0',capabilities:supported?[capability]:[]}:path==='/invoices'?{items:[],reconciliations:[],unmatchedReimbursements:[],setupRequired:true,accounts:[]}:path==='/savings/contracts'?{records:[]}:{records:[],jobs:[],items:[],state:'idle'};return route.fulfill({json:body});
  });
  await page.goto(base);const sourceView=page.locator('.source-expenses');await sourceView.waitFor();
  assert.equal(await page.locator('.finance-expense-charts:visible').count(),0,'No old total underneath source mode');assert.equal(await page.locator('.finance-collection-note').count(),0,'Canonical unknown capture notice cannot contradict the known source timestamp');
  assert.equal(await page.getByRole('button',{name:'Source récente',exact:true}).getAttribute('aria-pressed'),'true');
  assert.match(await sourceView.innerText(),/Sous-total des données disponibles/);assert.match(await sourceView.innerText(),/Date de mise à jour bancaire inconnue/);assert.match(await sourceView.innerText(),/non confirmées/);
  assert.match(await sourceView.locator('[data-source-total="net"]').innerText(),/115,00/);assert.match(await sourceView.locator('[data-source-total="refunds"]').innerText(),/20,00/);assert.match(await sourceView.innerText(),/Paiement de carte exclu|transferts et revenus/);
  assert.equal(await sourceView.locator('.source-expense-capture time').getAttribute('datetime'),collectedAt);assert.match(await sourceView.locator('.source-expense-capture').innerText(),/H[AN]P|UTC|GMT/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:join(output,'expenses-'+width+'.png'),fullPage:true});
  const groceries=sourceView.locator('[data-source-category="groceries"]');
  assert.match(await groceries.innerText(),/80,00/);
  assert.match(await groceries.innerText(),/20,00/);
  assert.equal(await sourceView.locator('[data-source-category="transfers"]').count(),0);
  for(let repeat=0;repeat<2;repeat++){
    await groceries.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.activeElement?.closest('.source-category-detail')!==null);
    assert.equal(await sourceView.locator('.source-expense-rows li').count(),2);
    assert.match(await sourceView.locator('.source-expense-rows').innerText(),/refund/);
    await page.setViewportSize({width,height:1600});
    await sourceView.locator('.source-expense-rows').screenshot({path:join(output,'category-detail-'+width+'.png')});
    await page.setViewportSize({width,height:900});
    await sourceView.getByRole('button',{name:'Toutes les opérations',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-source-category')==='groceries');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  mode='categories';await page.getByRole('button',{name:'Actualiser',exact:true}).click();
  await sourceView.getByRole('button',{name:'Toutes les catégories (6)',exact:true}).waitFor();
  assert.equal(await sourceView.locator('[data-source-category]').count(),4);
  await page.screenshot({path:join(output,'category-overview-'+width+'.png'),fullPage:true});
  await page.setViewportSize({width,height:1600});
  await sourceView.locator('.source-category-chart').screenshot({path:join(output,'category-chart-'+width+'.png')});
  await page.setViewportSize({width,height:900});
  await sourceView.getByRole('button',{name:'Toutes les catégories (6)',exact:true}).click();
  const credit=sourceView.locator('[data-source-category="travel"]');
  assert.match(await credit.innerText(),/net créditeur/);
  assert.equal(await credit.locator('.source-category-bar > span').evaluate(el=>parseFloat(el.style.left)<50),true,'Credit is left of zero, not a positive spending bar');
  await credit.click();assert.equal(await sourceView.locator('.source-expense-rows li').count(),1);
  await sourceView.getByLabel('Opérations affichées',{exact:true}).selectOption('pending');
  assert.equal(await sourceView.getByRole('button',{name:'Toutes les opérations',exact:true}).count(),0,'Changing row scope clears category');
  await sourceView.getByRole('button',{name:'Réduire les catégories',exact:true}).click();
  assert.equal(await sourceView.locator('[data-source-category]').count(),4);
  mode='ready';await page.getByRole('button',{name:'Actualiser',exact:true}).click();
  await sourceView.locator('[data-source-category="groceries"]').waitFor();
  await page.getByRole('button',{name:'Tendances',exact:true}).click();
  const trends=page.locator('.source-trends');await trends.waitFor();
  assert.equal(await trends.locator('[data-source-trend-month]').count(),12);
  assert.equal(await page.locator('.trend-annual').count(),0,'Canonical annual trends are not mixed into source mode');
  assert.equal(await page.locator('.finance-collection-note').count(),0);
  assert.match(await trends.locator('.source-expense-capture').innerText(),/Date de mise à jour bancaire inconnue/);
  for(let i=0;i<3;i++){
    await trends.locator('[data-source-trend-month="2026-11"]').click();
    await page.waitForFunction(()=>document.activeElement?.id==='source-trend-month-title');
    assert.match(await trends.locator('[data-source-trend-total]').innerText(),/115,00/);
    assert.match(await trends.innerText(),/Mois incomplet/);
    await trends.getByRole('button',{name:"Retour à l'année",exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-source-trend-month')==='2026-11');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:join(output,'trends-annual-'+width+'.png'),fullPage:true});
  await trends.locator('[data-source-trend-month="2026-11"]').click();
  await trends.getByText('Cumul quotidien',{exact:true}).click();
  await trends.getByText('Valeurs jour par jour',{exact:true}).click();
  assert.equal(await trends.locator('.trend-table tbody tr').count(),14);
  await trends.getByLabel('Catégorie source',{exact:true}).selectOption('groceries');
  assert.equal(await trends.locator('.source-expense-rows li').count(),2);
  await trends.getByLabel('Devise',{exact:true}).selectOption('USD');
  assert.match(await trends.locator('[data-source-trend-total]').innerText(),/9,00/);
  await trends.getByLabel('Devise',{exact:true}).selectOption('CAD');
  const sourceAccount=source.accounts.find(a=>a.name==='Compte source fictif').sourceKey;
  await trends.getByLabel('Compte source',{exact:true}).selectOption(sourceAccount);
  assert.match(await trends.locator('[data-source-trend-total]').innerText(),/Non établi/);
  await trends.getByLabel('Compte source',{exact:true}).selectOption('');
  assert.match(await trends.locator('[data-source-trend-total]').innerText(),/115,00/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:join(output,'trends-month-'+width+'.png'),fullPage:true});
  await trends.getByText('Changer de collecte (2)',{exact:true}).click();
  await trends.getByLabel('Collecte des tendances').selectOption(previous.collectedAt);
  await trends.locator('[data-source-trend-month="2026-11"]').click();
  assert.match(await trends.locator('[data-source-trend-total]').innerText(),/135,00/);
  await page.getByRole('button',{name:'Registre historique',exact:true}).click();
  await page.locator('.trend-annual').waitFor();assert.equal(await trends.count(),0);
  await page.getByRole('button',{name:'Source récente',exact:true}).click();await trends.waitFor();
  mode='no-ledger';await page.getByRole('button',{name:'Actualiser',exact:true}).click();
  await trends.locator('[data-source-trend-month="2026-11"]').click();assert.match(await trends.locator('[data-source-trend-total]').innerText(),/115,00/);
  assert.equal(await page.getByRole('heading',{name:'Aucun historique importé',exact:true}).count(),0,'Source trends work without canonical ledger');
  mode='error';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText(/Dépenses source indisponibles/).waitFor();assert.equal(await trends.count(),0);assert.equal(await page.locator('.trend-annual').count(),0);
  mode='empty';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText(/Aucune collecte enregistrée/).waitFor();assert.equal(await trends.locator('[data-source-trend-total]').count(),0);
  mode='ready';await page.getByRole('button',{name:'Actualiser',exact:true}).click();
  await page.getByRole('button',{name:'Dépenses',exact:true}).click();await sourceView.locator('[data-source-total="net"]').waitFor();
  await sourceView.locator('.source-expense-controls > summary').click();
  await sourceView.getByLabel('Devise',{exact:true}).selectOption('USD');assert.match(await sourceView.locator('[data-source-total="net"]').innerText(),/9,00/);assert.equal(await sourceView.locator('.source-expense-rows li').count(),1);
  await sourceView.getByLabel('Devise',{exact:true}).selectOption('CAD');await sourceView.getByLabel('Opérations affichées').selectOption('pending');assert.equal(await sourceView.locator('.source-expense-rows li').count(),1);assert.match(await sourceView.innerText(),/En attente, hors total/);assert.match(await sourceView.locator('[data-source-total="net"]').innerText(),/115,00/);
  await sourceView.getByLabel('Opérations affichées').selectOption('ambiguous');assert.equal(await sourceView.locator('.source-expense-rows li').count(),2);
  await sourceView.getByText('Changer de collecte (2)',{exact:true}).click();
  await sourceView.getByLabel('Collecte consultée').selectOption(previous.collectedAt);assert.match(await sourceView.locator('[data-source-total="net"]').innerText(),/135,00/);await sourceView.getByLabel('Collecte consultée').selectOption(source.collectedAt);assert.match(await sourceView.locator('[data-source-total="net"]').innerText(),/115,00/);
  await sourceView.locator('.source-expense-controls > summary').click();
  await sourceView.getByLabel('Compte source',{exact:true}).selectOption({label:'Compte source fictif'});assert.equal(await sourceView.locator('[data-source-total="net"]').innerText(),'Non établi');assert.match(await sourceView.innerText(),/Aucun montant nul/);await sourceView.getByLabel('Compte source',{exact:true}).selectOption('');
  await sourceView.getByLabel('Mois',{exact:true}).fill('2026-12');assert.equal(await sourceView.locator('[data-source-total="net"]').innerText(),'Non établi');await sourceView.getByLabel('Mois',{exact:true}).fill('2026-11');
  const historical=page.getByRole('button',{name:'Registre historique',exact:true});await historical.focus();await page.keyboard.press('Enter');await page.locator('.finance-expense-charts').waitFor();assert.equal(await sourceView.count(),0);
  await page.getByRole('button',{name:'Source récente',exact:true}).click();await sourceView.waitFor();for(const tab of ['Comptes','Tendances','Dépenses'])await page.getByRole('button',{name:tab,exact:true}).click();await sourceView.waitFor();
  if(width===320){mode='large';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await sourceView.getByText('Changer de collecte (3)',{exact:true}).waitFor();assert.equal(await sourceView.locator('.source-expense-rows li').count(),20);let next=sourceView.getByRole('button',{name:/Voir les opérations suivantes/});await next.focus();await page.keyboard.press('Enter');assert.equal(await sourceView.locator('.source-expense-rows li').count(),40);while(await next.count())await next.click();assert.equal(await sourceView.locator('.source-expense-rows li').count(),85);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);mode='ready';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await sourceView.getByText('Changer de collecte (2)',{exact:true}).waitFor();}
  mode='delayed';const started=new Promise(r=>{markDelayedStarted=r;});await page.getByRole('button',{name:'Actualiser',exact:true}).click();await started;await page.getByRole('button',{name:'Actualiser',exact:true}).waitFor();
  mode='error';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText(/Dépenses source indisponibles/).waitFor();releaseDelayed();await delayedFinished;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.getByText(/Dépenses source indisponibles/).waitFor();assert.equal(await sourceView.count(),0);assert.equal(await page.locator('.finance-expense-charts:visible').count(),0);
  mode='empty';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText(/Aucune collecte enregistrée/).waitFor();
  mode='ready';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await sourceView.locator('[data-source-total="net"]').waitFor();assert.match(await sourceView.locator('[data-source-total="net"]').innerText(),/115,00/);
  supported=false;const before=reads;await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText(/Cette vue nécessite une mise à jour/).waitFor();assert.equal(reads,before);await historical.click();await page.locator('.finance-expense-charts').waitFor();
  assert.equal(JSON.stringify(state),canonical);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.doesNotMatch(await page.evaluate(()=>Object.values(localStorage).join('\n')),/Carte source fictive|Opération fictive|fsi_[a-f0-9]/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await context.close();console.log('PASS source expenses, capture history, refunds/pending/currency/uncertainty, source-vs-ledger, empty/error/old worker and no overflow at '+width+'px');
 }
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));assert(resolve(temp).startsWith(resolve(tmpdir())+sep));await rm(temp,{recursive:true,force:true});}
