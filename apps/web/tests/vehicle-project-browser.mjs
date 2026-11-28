/** Synthetic local browser acceptance; never connects to a financial provider. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { once } from "node:events";
const root = resolve("apps/web/dist");
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  try { const bytes = await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file); res.setHeader("Content-Type", {".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml"}[extname(file)] || "text/html"); res.end(bytes); } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
const browser=await chromium.launch({headless:true});
try {
 for(const width of [390,1100]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'})));
  const at=new Date().toISOString(),fact=value=>({value,sourceUrl:value===null?null:'https://example.com/listing',checkedAt:value===null?null:at,note:'Synthetic evidence'});
  const card=(id)=>({id,listingId:id,observedAt:at,title:'Véhicule fictif '+id,url:'https://example.com/listing',status:'active',statusEvidence:fact('active'),priceBasis:'before-tax',priceCad:fact(27000),year:fact(2021),mileageKm:fact(65000),make:fact('Honda'),model:fact('CR-V'),trim:fact(null),location:fact('Vancouver'),familySuv:fact(true),used:fact(true),greaterVancouver:fact(true),awd:fact(id==='a'?true:false),accidentHistory:fact(null),followed:false,changes:[]});
  const cards=[card('a'),card('b')];let revision=0,mode='ready',writes=0,reads=0; let releaseInitial; const initialGate=new Promise(resolve=>releaseInitial=resolve);
  await page.route('https://synthetic-worker.invalid/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/vehicle-project/following'){writes++;const input=route.request().postDataJSON();if(input.expectedRevision!==revision)return route.fulfill({status:409,json:{error:'Conflict'}});cards.find(c=>c.listingId===input.listingId).followed=input.followed;revision++;return route.fulfill({json:{revision}});}
   if(path==='/vehicle-project/comparison')return route.fulfill({json:{items:cards.map(c=>({...c,budgetHeadroomCad:3000,askingPriceReductionCad:0}))}});
   if(path==='/vehicle-project'){reads++;if(reads===1)await initialGate;return route.fulfill({status:mode==='offline'?503:200,json:{cards:mode==='empty'?[]:cards,followingRevision:revision}});}
   return route.fulfill({json:{status:'ok',capabilities:[],items:[],records:[],jobs:[],state:'idle'}});
  });
  await page.goto(base+'?view=vehicle');const refresh=page.locator('.property-heading button');await refresh.waitFor();assert.equal(await refresh.isDisabled(),true);await refresh.evaluate(el=>el.click());assert.equal(reads,1);assert.equal(writes,0);releaseInitial();await page.locator('.vehicle-project .property-card').first().waitFor();assert.equal(await page.locator('.vehicle-project .property-card').count(),2);assert.equal(writes,0);
  assert.ok(await page.getByText(/Not AWD/).isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByRole('button',{name:'Follow Véhicule fictif a',exact:true}).click();await page.getByRole('button',{name:'Unfollow Véhicule fictif a',exact:true}).waitFor();assert.equal(writes,1);
  await page.getByRole('button',{name:'Following',exact:true}).click();assert.equal(await page.locator('.vehicle-project .property-card').count(),1);await page.getByRole('button',{name:'All',exact:true}).click();
  await page.getByRole('button',{name:'Véhicule fictif a',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.getByRole('dialog').getByText("Seller claims are not a substitute for a full history report or an inspection. Reliability and value still need to be assessed.").isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
  await page.getByLabel('Compare this vehicle').nth(0).check();await page.getByLabel('Compare this vehicle').nth(1).check();await page.getByRole('button',{name:'Compare (2/3)',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.getByText('Room below $30,000',{exact:true}).isVisible());await page.getByRole('button',{name:'Close',exact:true}).click();
  await mkdir('output/vehicle-ui',{recursive:true});await page.screenshot({path:`output/vehicle-ui/vehicle-${width}.png`,fullPage:true});
  mode='offline';await page.getByRole('button',{name:'Refresh vehicles'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.vehicle-project .property-card').count(),2);assert.equal(writes,1);
  mode='empty';await page.getByRole('button',{name:'Refresh vehicles'}).click();await page.getByText('No vehicles in this selection.').waitFor();assert.equal(await page.locator('.vehicle-project .property-card').count(),0);
  await page.getByRole('button',{name:'Projects',exact:true}).first().click();await page.getByRole('button',{name:'Vehicles',exact:true}).waitFor();await page.goBack();await page.getByRole('heading',{name:'Vehicles',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Vehicle UI passed: mobile/desktop, following, filtering, evidence dialog, comparison, offline preservation, empty, navigation/back.');
}finally{await browser.close();await new Promise(r=>server.close(r));}

