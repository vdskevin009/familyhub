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
  const card=(id)=>({id,listingId:id,observedAt:at,address:'Adresse fictive '+id,url:'https://example.com/listing',status:'active',statusEvidence:fact('active'),priceCad:fact(1500000),bedrooms:fact(3),lowerLonsdale:fact(true),separateEntrances:fact(id==='a'?true:null),airbnb:{status:'unknown',evidence:[]},followed:false,changes:[]});
  const cards=[card('a'),card('b')];let revision=0,mode='ready',writes=0;
  await page.route('https://synthetic-worker.invalid/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/property-project/following'){writes++;const input=route.request().postDataJSON();if(input.expectedRevision!==revision)return route.fulfill({status:409,json:{error:'Conflict'}});cards.find(c=>c.listingId===input.listingId).followed=input.followed;revision++;return route.fulfill({json:{revision}});}
   if(path==='/property-project/comparison')return route.fulfill({json:{items:cards.map(c=>({...c,budgetHeadroomCad:200000,askingPriceReductionCad:0}))}});
   if(path==='/property-project')return route.fulfill({status:mode==='offline'?503:200,json:{cards:mode==='empty'?[]:cards,followingRevision:revision}});
   return route.fulfill({json:{status:'ok',capabilities:[],items:[],records:[],jobs:[],state:'idle'}});
  });
  await page.goto(base+'?view=property');await page.locator('.property-card').first().waitFor();assert.equal(await page.locator('.property-card').count(),2);assert.equal(writes,0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByRole('button',{name:'Suivre Adresse fictive a',exact:true}).click();await page.getByRole('button',{name:'Ne plus suivre Adresse fictive a',exact:true}).waitFor();assert.equal(writes,1);
  await page.getByRole('button',{name:'Suivis',exact:true}).click();assert.equal(await page.locator('.property-card').count(),1);await page.getByRole('button',{name:'Tous',exact:true}).click();
  await page.getByRole('button',{name:'Adresse fictive a',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.getByRole('dialog').getByText('Les annonces enregistrées documentent des prix affichés. Pour situer le prix, examinez des ventes conclues.').isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
  await page.getByLabel('Comparer ce bien').nth(0).check();await page.getByLabel('Comparer ce bien').nth(1).check();await page.getByRole('button',{name:'Comparer (2/3)',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.getByText('Sous le budget',{exact:true}).isVisible());await page.getByRole('button',{name:'Fermer',exact:true}).click();
  await mkdir('output/property-ui',{recursive:true});await page.screenshot({path:`output/property-ui/property-${width}.png`,fullPage:true});
  mode='offline';await page.getByRole('button',{name:'Actualiser les biens'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.property-card').count(),2);assert.equal(writes,1);
  mode='empty';await page.getByRole('button',{name:'Actualiser les biens'}).click();await page.getByText('Aucun bien dans cette sélection.').waitFor();assert.equal(await page.locator('.property-card').count(),0);
  await page.getByRole('button',{name:'Projets',exact:true}).first().click();await page.getByRole('button',{name:'Nouveau bien',exact:true}).waitFor();await page.goBack();await page.getByRole('heading',{name:'Nouveau bien',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Property UI passed: mobile/desktop, following, filtering, evidence dialog, comparison, offline preservation, empty, navigation/back.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
