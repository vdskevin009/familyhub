/** Synthetic store readbacks, static localhost, intercepted GET only. No installed worker. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, relative } from 'node:path';
const baseline=process.argv.includes('--baseline');
const fixtures=JSON.parse(await readFile('tests/fixtures/grocery-monthly-coverage.json','utf8'));
const root=resolve('apps/web/dist'),output=resolve('output/playwright/grocery-monthly-coverage');
const endpoint='https://grocery-coverage.invalid';
const plan={schema:1,revision:'',area:'',areaConfirmed:false,currency:'CAD',tipPerOrder:0,items:[],retailers:[],prices:[]};
const zero=structuredClone(fixtures.complete);zero[0].receipt.total=0;zero[0].receipt.items[0].amount=0;
const ambiguous=structuredClone(fixtures.complete);ambiguous[0].receipt.reference='900000000000028 900000000000029';
const foreignConflict=fixtures.mixed.map(r=>r.receipt.sourceType==='confirmation'?{...r,receipt:{...r.receipt,currency:'USD'}}:r);
const cases={conflictOnly:fixtures.conflictOnly,mixed:fixtures.mixed,unknownOnly:fixtures.unknownOnly,oldConflict:fixtures.oldConflict,empty:[],complete:fixtures.complete,zero,ambiguous,...(baseline?{}:{foreignConflict})};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname.replace(/^\/familyhub/,'');
 const file=resolve(root,'.'+(path.endsWith('/')?path+'index.html':path));
 if(relative(root,file).startsWith('..'))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
let browser;const results=[];
try{
 await mkdir(output,{recursive:true});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/familyhub/`;
 browser=await chromium.launch({headless:true});
 for(const width of baseline?[320,390]:[320,390,768,1440])for(const [name,records] of Object.entries(cases)){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],external=[],requests=[];let offline=false,displayedRecords=records;
  page.on('pageerror',e=>{errors.push(e.message);console.error(`PAGE ERROR ${width} ${name}: ${e.message}`);});page.setDefaultTimeout(10000);
  await context.addInitScript(endpoint=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:endpoint,ApiKey:'synthetic-only'})),endpoint);
  await context.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin===new URL(base).origin)return route.continue();
   if(url.origin!==endpoint){external.push(url.origin);return route.abort();}
   assert.equal(req.method(),'GET','No writes or collection');requests.push(url.pathname);
   if(offline)return route.fulfill({status:503,json:{error:'Synthetic offline'}});
   return route.fulfill({json:url.pathname==='/groceries'?{records:displayedRecords}:url.pathname==='/groceries/planning'?plan:{}});
  });
  const loaded=page.waitForResponse(response=>response.url()===endpoint+'/groceries'&&response.status()===200);
  await page.goto(base+'?view=groceries&tab=tickets');await (await loaded).finished();
  const chart=page.getByRole('region',{name:'Dépenses mensuelles PC Express',exact:true});await chart.waitFor();
  const method=chart.locator('details').filter({has:page.getByText('Couverture et méthode',{exact:true})});
  await method.waitFor();assert.equal(await method.getAttribute('open'),null);
  const omitted=['conflictOnly','mixed','unknownOnly','oldConflict','ambiguous','foreignConflict'].includes(name);
  // Wait for the known source result to render, not the initial empty-cache frame.
  if(omitted)await (baseline?chart.getByText(/Exclues des montants/):chart.getByText(/Historique : 1 cas/)).waitFor({state:baseline?'attached':'visible'});
  if(['mixed','oldConflict','complete'].includes(name))await chart.getByText(/25,00/).first().waitFor();
  if(name==='zero')await chart.getByText(/0,00/).first().waitFor();
  if(baseline){
   assert.equal(await chart.locator('.grocery-warning').filter({hasText:/Exclues des montants/}).isVisible(),false);
   if(name==='conflictOnly')assert.match(await chart.innerText(),/Les achats importés apparaîtront ici/);
   if(name==='mixed'||name==='oldConflict')assert.match(await chart.innerText(),/25,00/);
  }else{
   const warning=chart.getByText('Historique : 1 cas écarté des montants',{exact:true});
   assert.equal(await warning.isVisible(),omitted);
   assert.equal(await chart.getByText(/Tous les achats PC Express sont inclus/).count(),0);
   if(omitted){
    const details=warning.locator('..');assert.equal(await details.getAttribute('open'),null);
    await warning.focus();assert.equal(await warning.evaluate(el=>document.activeElement===el),true);
    assert.notEqual(await warning.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    assert.ok((await warning.boundingBox()).height>=44);
    await page.keyboard.press('Enter');await details.getByText(/toutes les années et devises/).waitFor();
    await details.getByText(/Archives et autres tickets/).waitFor();
    await page.keyboard.press('Enter');assert.equal(await details.getAttribute('open'),null);
   }
   if(['conflictOnly','unknownOnly','ambiguous'].includes(name)){
    assert.match(await chart.innerText(),/Sources présentes, montants non établis/);
    assert.equal(await chart.getByText(/Les achats importés apparaîtront ici/).count(),0);
   }
   if(name==='empty')assert.match(await chart.innerText(),/Aucune source PC Express enregistrée/);
   if(['mixed','oldConflict','complete'].includes(name))assert.match(await chart.innerText(),/25,00/);
   if(name==='zero')assert.match(await chart.innerText(),/0,00/);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(width<=390&&['conflictOnly','mixed','empty'].includes(name))await chart.screenshot({path:join(output,`${baseline?'before':'after'}-${name}-${width}.png`)});
  if(!baseline&&name==='conflictOnly'){
   await page.locator('summary').filter({hasText:'Archives et autres tickets'}).click();
   await page.getByRole('button',{name:/Plus d[’']infos pour l[’']achat/}).first().click();
   const purchase=page.getByRole('dialog');await purchase.waitFor();
   await purchase.getByText(/Provenance de l[’']achat et limites/).click();
   await purchase.getByRole('button',{name:'Voir les sources et vérifier le ticket',exact:true}).click();
   const editor=page.getByRole('dialog',{name:'Vérifier le ticket',exact:true});await editor.waitFor();
   await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});
   await chart.getByText(/Historique : 1 cas/).waitFor();
  }
  if(!baseline&&name==='mixed'){
   offline=true;await page.reload();await page.getByText(/Historique en cache/).waitFor();
   await chart.getByText(/Données en cache/).waitFor();await chart.getByText(/Historique : 1 cas/).waitFor();
   assert.match(await chart.innerText(),/25,00/);
   offline=false;displayedRecords=fixtures.complete;
   const refreshed=page.waitForResponse(response=>response.url()===endpoint+'/groceries'&&response.status()===200);
   await page.reload();await (await refreshed).finished();await chart.getByText(/Historique : 1 cas/).waitFor({state:'hidden'});
   await chart.getByText(/25,00/).first().waitFor();
   assert.equal(await chart.getByText(/Données en cache/).count(),0);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  results.push({width,case:name,omitted,requests,errors,external});await context.close();console.log(`PASS ${baseline?'baseline':'candidate'} ${width} ${name}`);
 }
 await writeFile(join(output,`${baseline?'baseline':'acceptance'}.json`),JSON.stringify({synthetic:true,workerStarted:false,baseline,results},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
