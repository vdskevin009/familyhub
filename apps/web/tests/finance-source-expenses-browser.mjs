/** Synthetic built-PWA acceptance only. No private worker, bank or provider is contacted. */
import { selectFinanceFilter, openFinanceRegister } from './finance-filter-helpers.mjs';
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
   if(path==='/finance/source-expenses'){reads++;if(mode==='delayed'){let finish;delayedFinished=new Promise(r=>{finish=r;});const gate=new Promise(r=>{releaseDelayed=r;});markDelayedStarted();await gate;await route.fulfill({json:{capability,state:saved}});finish();return;}if(mode==='large')return route.fulfill({json:{capability,state:large}});if(mode==='error')return route.fulfill({status:503,json:{error:'synthetic failure'}});if(mode==='empty')return route.fulfill({json:{capability,state:{revision:'empty',snapshots:[]}}});return route.fulfill({json:{capability,state:saved}});}
   if(path==='/finances/register-bindings')return route.fulfill({json:{capability:'finance-register-bindings-v1',ledgerRevision:state.revision,bindings:{accounts:{},transactions:{}},unavailableArchiveCount:0}});
   const body=path==='/finances'?(mode==='no-ledger'?{...state,data:null}:state):path==='/health'?{status:'ok',version:'2.30.0',capabilities:supported?[capability,'finance-register-bindings-v1']:[]}:path==='/invoices'?{items:[],reconciliations:[],unmatchedReimbursements:[],setupRequired:true,accounts:[]}:path==='/savings/contracts'?{records:[]}:{records:[],jobs:[],items:[],state:'idle'};return route.fulfill({json:body});
  });
  await page.goto(base);
  await page.locator('.finance-tabs button[aria-current="page"]').waitFor();
  assert.deepEqual(await page.locator('.finance-tabs button').allTextContents(),['Comptes','Dépenses','Tendances','Contributions']);
  assert.equal(await page.locator('.finance-tabs button[aria-current="page"]').innerText(),'Comptes');
  await page.getByRole('button',{name:'Dépenses',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Source récente',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Registre historique',exact:true}).count(),0);
  await selectFinanceFilter(page,'Année','2026');await selectFinanceFilter(page,'Mois','11');
  await openFinanceRegister(page);
  const sourceView=page.locator('.finance-unresolved');await sourceView.waitFor();
  assert.match(await sourceView.innerText(),/hors du sous-total/);
  const sourceCount=await sourceView.locator('li').count();assert(sourceCount>0);
  await sourceView.locator('summary').first().click();
  assert.match(await sourceView.innerText(),/Mise à jour bancaire : inconnue/);
  assert.match(await sourceView.innerText(),/Collecté le/);
  // Repeated captures retain provenance without becoming two display rows or two totals.
  assert(sourceCount < previous.rows.length+source.rows.length);
  await page.getByRole('button',{name:'Retour aux dépenses',exact:true}).click();
  assert.match(await page.locator('.finance-category-total').innerText(),/Non établi/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:join(output,'expenses-'+width+'.png'),fullPage:true});
  await selectFinanceFilter(page,'Mois','4');
  const category=page.locator('[data-finance-bar="groceries"]').first();await category.waitFor();
  for(let i=0;i<3;i++){
    await category.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:/Paiements/});await dialog.waitFor();
    for(let j=0;j<4;j++)await page.keyboard.press('Tab');
    assert(await dialog.evaluate(el=>el.contains(document.activeElement)));
    if(i===1)await page.goBack();else await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.getAttribute('data-finance-bar')==='groceries');
  }
  await selectFinanceFilter(page,'Mois','11');await openFinanceRegister(page);
  await selectFinanceFilter(page,'Devise','USD');assert.equal(await sourceView.locator('li').count(),1);
  await selectFinanceFilter(page,'Devise','CAD');
  await selectFinanceFilter(page,'Compte',{label:'Compte source fictif · à rapprocher'});
  assert.equal(await sourceView.locator('li').count(),0);
  await selectFinanceFilter(page,'Compte','');
  if(width===320){
    mode='large';await page.getByRole('button',{name:'Actualiser',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.finance-source-register li').length===20);
    const next=sourceView.getByRole('button',{name:/Voir les opérations source suivantes/});await next.focus();await page.keyboard.press('Enter');
    assert.equal(await sourceView.locator('li').count(),40);
    while(await next.count())await next.click();assert.equal(await sourceView.locator('li').count(),85+sourceCount);
  }
  mode='no-ledger';await page.getByRole('button',{name:'Actualiser',exact:true}).click();
  await page.getByText(/Sous-total non établi : aucune opération rapprochée/).waitFor();await sourceView.waitFor();
  await selectFinanceFilter(page,'Devise','USD');assert.equal(await sourceView.locator('li').count(),1);await selectFinanceFilter(page,'Devise','CAD');
  mode='error';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText(/Collectes indisponibles/).waitFor();assert.equal(await sourceView.count(),0);
  mode='empty';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.finance-unresolved'));
  mode='ready';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await openFinanceRegister(page);await sourceView.waitFor();
  mode='delayed';const started=new Promise(r=>{markDelayedStarted=r;});await page.getByRole('button',{name:'Actualiser',exact:true}).click();await started;await page.getByRole('button',{name:'Actualiser',exact:true}).waitFor();
  mode='error';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByText(/Collectes indisponibles/).waitFor();releaseDelayed();await delayedFinished;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await sourceView.count(),0);
  mode='ready';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await sourceView.waitFor();
  assert.equal(JSON.stringify(state),canonical);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  assert.doesNotMatch(await page.evaluate(()=>Object.values(localStorage).join('\n')),/Carte source fictive|Opération fictive|fsi_[a-f0-9]/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await context.close();console.log('PASS unified expenses, capture provenance, no inferred duplicate, shared filters, source-only/empty/error/stale response and category keyboard/Back at '+width+'px');
 }
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));assert(resolve(temp).startsWith(resolve(tmpdir())+sep));await rm(temp,{recursive:true,force:true});}
