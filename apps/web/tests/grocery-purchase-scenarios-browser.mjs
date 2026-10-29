/** Fictional purchase scenarios only; no real worker, account, prices or decisions. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,extname,join} from 'node:path';
import {emptyPlan,emptyEvidence} from '../../worker/dist/grocery-planning.js';
import {emptyReceipt,blankItem} from '../../worker/dist/grocery-model.js';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const oldDate=new Date(Date.parse(today)-17*86400000).toISOString().slice(0,10);
const products=['Fictional Tofu Extra Firm','Fictional Honey Nut Cheerios','Mini Cucumbers','Boneless Skinless Chicken Breasts','Protein Tortillas'];
const record={id:'fictional-scenarios',revision:'r1',status:'saved',extraction:'complete',reviewedAt:null,createdAt:new Date().toISOString(),duplicateOf:null,sources:[],receipt:{...emptyReceipt(),sourceType:'confirmation',store:'PC Express fictional',date:today,fulfillment:{date:today,evidence:'Fictional delivery'},total:40,currency:'CAD',items:products.map((product,i)=>({...blankItem(),name:product,product,quantity:1,size:[350,430,6,700,342][i],unit:i===2?'each':'g',uncertain:i>1,evidence:'Fictional original confirmation; payment unknown'}))}};
const plan={...emptyPlan(),items:products.map((name,i)=>({id:'item-'+i,name,quantity:null,size:null,unit:null,preference:'',substitutions:false,active:false,origin:'fictional'})),retailers:[{id:'wm',name:'Walmart',mode:'pickup',locality:'Fictional branch',areaConfirmed:true,membershipStatus:'none',otherFeesReviewed:false,delivery:null,service:null,servicePercent:null,feesTaxPercent:null,minimum:null,freeDeliveryAbove:null,evidence:emptyEvidence()}],prices:products.map((product,i)=>({id:'price-'+i,itemId:'item-'+i,retailerId:'wm',product:i>1?'Other '+product:product,price:[3,4,2.75,18,5][i],size:[350,430,454,1,342][i],unit:i===3?'kg':'g',weighed:i===3,taxPercent:null,currency:'CAD',available:i===4?'no':'yes',substitution:i>1,approved:i<2,kind:'public',mode:'pickup',locality:'Fictional branch',localityConfirmed:i!==4,matchNote:'Fictional sourced price',evidence:{title:'Fictional source',url:'https://example.com/price-'+i,date:i===4?oldDate:today,until:null}}))};
const historical=structuredClone(record);historical.id='fictional-old';historical.receipt.date=oldDate;historical.receipt.fulfillment.date=oldDate;historical.receipt.items.forEach(l=>{l.size=null;l.unit=null;l.uncertain=true;});
let empty=false,unavailable=false,writes=0; const errors=[],outside=[],original=JSON.stringify({record,historical,plan});
const api=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin',req.headers.origin||'*');res.setHeader('Access-Control-Allow-Headers','content-type,x-familyhub-key');res.setHeader('Content-Type','application/json');if(req.method==='OPTIONS')return res.end();if(req.method!=='GET')writes++;if(unavailable){res.writeHead(503);return res.end('{}');}res.end(JSON.stringify(req.url==='/health'?{capabilities:['grocery-purchase-resolution-v1','grocery-purchase-estimates-v1']}:req.url==='/groceries'?{records:empty?[]:[record,historical]}:req.url==='/groceries/planning'?plan:req.url==='/groceries/purchase-resolution'?{schema:1,revision:'empty',candidates:[],decisions:{}}:{}));});
const root=resolve('apps/web/dist'),output=resolve('output/playwright/purchase-scenarios');
const site=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname.replace(/^\/familyhub/,''),file=resolve(root,'.'+(path.endsWith('/')?path+'index.html':path));if(relative(root,file).startsWith('..')){res.writeHead(403);return res.end();}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
let browser;
try {
 api.listen(0,'127.0.0.1');site.listen(0,'127.0.0.1');await Promise.all([once(api,'listening'),once(site,'listening')]);await mkdir(output,{recursive:true});
 browser=await chromium.launch({headless:true,channel:process.env.FAMILYHUB_TEST_BROWSER_CHANNEL||undefined});
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:960},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(outside.push(route.request().url()),route.abort()));
  await context.addInitScript(endpoint=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:endpoint,ApiKey:'fictional'})),'http://127.0.0.1:'+api.address().port);
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+site.address().port+'/familyhub/?view=groceries&tab=tickets');
  const cards=page.locator('.grocery-purchase-card');await cards.first().getByText(/5\/5 comparés, dont 3 estimés/).waitFor();
  await cards.nth(1).getByText(/4\/5 comparés, dont 4 estimés/).waitFor();
  assert.match(await cards.first().innerText(),/2 vérifiés/);assert.doesNotMatch(await cards.first().innerText(),/économie certaine|écart observé/);
  await page.screenshot({path:join(output,'cards-'+width+'.png'),animations:'disabled'});
  await cards.first().getByRole('button',{name:/Ouvrir/}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  const lines=dialog.locator('.grocery-purchase-line');assert.equal(await lines.count(),5);
  await lines.nth(2).getByText('Formats, calcul et sources',{exact:true}).click();
  assert.doesNotMatch(await lines.nth(2).innerText(),/Walmart : prix concurrent absent/);const detail=lines.nth(2).locator('.grocery-scenario-evidence');assert.match(await detail.innerText(),/75.7 g par mini/);assert.match(await detail.innerText(),/au prorata/);assert.match(await detail.innerText(),/paquet\(s\) entier/);assert.equal(await detail.getByRole('link',{name:'Examiner le prix source'}).getAttribute('href'),'https://example.com/price-2');
  await lines.nth(3).getByText('Formats, calcul et sources',{exact:true}).click();assert.match(await lines.nth(3).innerText(),/poids\/conditionnement réel manquant/);
  await lines.nth(4).getByText('Formats, calcul et sources',{exact:true}).click();assert.match(await lines.nth(4).innerText(),/17 jours/);assert.match(await lines.nth(4).innerText(),/Indisponible selon la source/);assert.match(await lines.nth(4).innerText(),/non locale/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||[...document.querySelectorAll('dialog[open] .sheet-content')].some(e=>e.scrollWidth>e.clientWidth+1)),false);
  await lines.nth(2).scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'formula-'+width+'.png'),animations:'disabled'});
  await page.keyboard.press('Escape');if(width===390){unavailable=true;await page.reload();await cards.first().getByText(/5\/5 comparés/).waitFor();unavailable=false;empty=true;await page.reload();await page.getByText(/Aucun achat PC Express terminé/).waitFor();empty=false;}
  await context.close();console.log('PASS verified/estimated/missing, historical, formula/pack, source, cache/empty and layout '+width);
 }
 assert.equal(writes,0);assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);assert.equal(JSON.stringify({record,historical,plan}),original);
 await writeFile(join(output,'verification.json'),JSON.stringify({fictional:true,widths:[320,390,1280],writes,errors,outside,rawAndCartUnchanged:true},null,2));
}finally{await browser?.close();await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>site.close(r))]);}
