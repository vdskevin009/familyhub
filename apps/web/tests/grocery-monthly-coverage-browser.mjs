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
  const chart=page.getByRole('region',{name:baseline?'Dépenses mensuelles PC Express':'Monthly PC Express spending',exact:true});await chart.waitFor();
  const method=chart.locator('details').filter({has:page.getByText(baseline?'Couverture et méthode':'Coverage and method',{exact:true})});
  await method.waitFor();assert.equal(await method.getAttribute('open'),null);
  const omitted=['conflictOnly','mixed','unknownOnly','oldConflict','ambiguous','foreignConflict'].includes(name);
  // Wait for the known source result to render, not the initial empty-cache frame.
  const historyWarning=/History: 1 case excluded from totals/;
  const paidAmount=baseline?/25,00/:/25\.00/;
  const zeroAmount=baseline?/0,00/:/0\.00/;
  if(omitted)await (baseline?chart.getByText(/Exclues des montants/):chart.getByText(historyWarning)).waitFor({state:baseline?'attached':'visible'});
  if(['mixed','oldConflict','complete'].includes(name))await chart.getByText(paidAmount).first().waitFor();
  if(name==='zero')await chart.getByText(zeroAmount).first().waitFor();
  if(baseline){
   assert.equal(await chart.locator('.grocery-warning').filter({hasText:/Exclues des montants/}).isVisible(),false);
   if(name==='conflictOnly')assert.match(await chart.innerText(),/Les achats importés apparaîtront ici/);
   if(name==='mixed'||name==='oldConflict')assert.match(await chart.innerText(),paidAmount);
  }else{
   const warning=chart.getByText('History: 1 case excluded from totals',{exact:true});
   assert.equal(await warning.isVisible(),omitted);
   assert.equal(await chart.getByText(/All PC Express purchases are included/).count(),0);
   if(omitted){
    const details=warning.locator('..');assert.equal(await details.getAttribute('open'),null);
    await warning.focus();assert.equal(await warning.evaluate(el=>document.activeElement===el),true);
    assert.notEqual(await warning.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    assert.ok((await warning.boundingBox()).height>=44);
    await page.keyboard.press('Enter');await details.getByText(/all saved years and currencies/).waitFor();
    await details.getByText(/Archive and other receipts/).waitFor();
    await page.keyboard.press('Enter');assert.equal(await details.getAttribute('open'),null);
   }
   if(['conflictOnly','unknownOnly','ambiguous'].includes(name)){
    assert.match(await chart.innerText(),/Sources are available, but their amounts could not be established/);
    assert.equal(await chart.getByText(/Imported purchases will appear here/).count(),0);
   }
   if(name==='empty')assert.match(await chart.innerText(),/No usable PC Express sources are saved yet/);
   if(['mixed','oldConflict','complete'].includes(name))assert.match(await chart.innerText(),paidAmount);
   if(name==='zero')assert.match(await chart.innerText(),zeroAmount);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(width<=390&&['conflictOnly','mixed','empty'].includes(name))await chart.screenshot({path:join(output,`${baseline?'before':'after'}-${name}-${width}.png`)});
  if(!baseline&&name==='conflictOnly'){
   await page.locator('summary').filter({hasText:'Archive and other receipts'}).click();
   await page.getByRole('button',{name:/More details for purchase/}).first().click();
   const purchase=page.getByRole('dialog');await purchase.waitFor();
   await purchase.getByText(/Purchase evidence and limitations/).click();
   await purchase.getByRole('button',{name:'View sources and review receipt',exact:true}).click();
   const editor=page.getByRole('dialog',{name:'Review receipt',exact:true});await editor.waitFor();
   await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});
   await chart.getByText(historyWarning).waitFor();
  }
  if(!baseline&&name==='mixed'){
   offline=true;await page.reload();await page.getByText(/This device shows cached history/).waitFor();
   await chart.getByText(/Cached data/).waitFor();await chart.getByText(historyWarning).waitFor();
   assert.match(await chart.innerText(),paidAmount);
   offline=false;displayedRecords=fixtures.complete;
   const refreshed=page.waitForResponse(response=>response.url()===endpoint+'/groceries'&&response.status()===200);
   await page.reload();await (await refreshed).finished();await chart.getByText(historyWarning).waitFor({state:'hidden'});
   await chart.getByText(paidAmount).first().waitFor();
   assert.equal(await chart.getByText(/Cached data/).count(),0);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  results.push({width,case:name,omitted,requests,errors,external});await context.close();console.log(`PASS ${baseline?'baseline':'candidate'} ${width} ${name}`);
 }
 await writeFile(join(output,`${baseline?'baseline':'acceptance'}.json`),JSON.stringify({synthetic:true,workerStarted:false,baseline,results},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
