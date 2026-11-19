/** Real browser, fictional evidence only. All non-local/non-fixture requests are blocked. */
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const root=resolve('apps/web/dist'),out=resolve('output/playwright/project-evidence');
const server=createServer(async(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+pathname.replace(/^\/familyhub/,''));if(file!==root&&!file.startsWith(root+sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',{'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'text/html');res.end(await readFile(file===root||pathname.endsWith('/')?join(root,'index.html'):file));}catch{res.writeHead(404).end();}});
server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/familyhub/`;
const browser=await chromium.launch({headless:true}),at='2026-11-19T16:00:00Z',old='2026-10-01T16:00:00Z';
const fact=(value,date=at)=>({value,sourceUrl:value===null?null:'https://example.com/synthetic-listing',checkedAt:value===null?null:date,note:value===null?'Non documenté dans cette source fictive.':'Déclaration fictive de l’annonce ; non vérifiée indépendamment.'});
const property=id=>({id,listingId:id,observedAt:at,address:'Bien fictif '+id,url:'https://example.com/synthetic-listing',status:'active',statusEvidence:fact('active'),priceCad:fact(1600000),bedrooms:fact(3),lowerLonsdale:fact(true),separateEntrances:fact(id==='A'?null:false),monthlyStrataFeeCad:fact(id==='A'?null:500),airbnb:{status:'unknown',evidence:[]},followed:false,changes:[]});
const vehicle=id=>({id,listingId:id,observedAt:at,title:'SUV fictif '+id,url:'https://example.com/synthetic-listing',status:'active',statusEvidence:fact('active'),priceBasis:'before-tax',priceCad:fact(27000),year:fact(2021),mileageKm:fact(65000),make:fact('Marque fictive'),model:fact('Modèle fictif'),trim:fact(null),location:fact('Grand Vancouver'),familySuv:fact(true),used:fact(true),greaterVancouver:fact(id==='A'?null:false),awd:fact(null),accidentHistory:fact(null),followed:false,changes:[]});
const proof=[];
try{await mkdir(out,{recursive:true});for(const kind of ['property','vehicle'])for(const width of [320,390,768,1440]){
 const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Vancouver',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date(at)});
 await page.addInitScript(()=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://synthetic-worker.invalid',ApiKey:'synthetic-key'})));
 const cards=[(kind==='property'?property:vehicle)('A'),(kind==='property'?property:vehicle)('B')];cards[1].statusEvidence=fact('active',old);
 let mode='ready',comparisonMode='valid',revision=0,writes=0,conflict=false;
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===new URL(base).origin)return route.continue();if(url.origin!=='https://synthetic-worker.invalid'){external.push(url.origin);return route.abort();}
 if(url.pathname===`/${kind}-project/following`){writes++;const input=route.request().postDataJSON();if(conflict)return route.fulfill({status:409,json:{error:'Synthetic conflict'}});assert.equal(input.expectedRevision,revision);cards.find(c=>c.listingId===input.listingId).followed=input.followed;revision++;return route.fulfill({json:{revision}});}
 if(url.pathname===`/${kind}-project/comparison`)return route.fulfill({json:{items:cards.map(c=>({...c,listingId:comparisonMode==='wrong'?'unrequested-'+c.listingId:c.listingId,budgetHeadroomCad:kind==='property'?100000:3000,askingPriceReductionCad:0}))}});
 if(url.pathname===`/${kind}-project`)return route.fulfill({status:mode==='error'?503:200,json:{cards:mode==='empty'?[]:cards,followingRevision:revision}});
 return route.fulfill({json:{status:'ok',state:'idle',capabilities:[],items:[],records:[],jobs:[]}});});
 await page.goto(base+'?view='+kind);await page.locator('.property-card').first().waitFor();const articles=page.locator('.property-card');assert.equal(await articles.count(),2);assert.equal(writes,0);
 assert.ok(await articles.nth(0).getByRole('button',{name:/Adéquation au projet : À confirmer/}).isVisible());
 assert.ok(await articles.nth(1).getByRole('button',{name:/Adéquation au projet : Hors critères/}).isVisible());
 assert.ok(await articles.nth(1).getByText(/À actualiser/).isVisible());assert.equal(await page.getByText('Prix à évaluer',{exact:true}).count(),2);
 assert.equal(await page.locator('.project-observation').count(),2);
 const contrasts=await page.locator('.property-meta,.project-fit small,.project-observation,.property-photo-empty,.property-heading p').evaluateAll(elements=>elements.map(el=>{
  const rgb=s=>s.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const foreground=getComputedStyle(el).color;let bg='rgb(255, 255, 255)';for(let node=el;node;node=node.parentElement){const value=getComputedStyle(node).backgroundColor;if(value!=='transparent'&&!value.endsWith(', 0)')){bg=value;break;}}
  const a=lum(rgb(foreground)),b=lum(rgb(bg));return {selector:el.className,foreground,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 }));assert.ok(contrasts.every(c=>c.ratio>=4.5),JSON.stringify(contrasts));
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:join(out,`after-${kind}-${width}.png`),fullPage:true});
 const opener=articles.first().getByRole('button',{name:/Adéquation au projet/});
 for(let i=0;i<3;i++){await opener.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await opener.evaluate(el=>document.activeElement===el),true);}
 await opener.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.equal(await dialog.locator('.project-facts dt').first().innerText(),kind==='property'?'Deux entrées séparées':'Grand Vancouver');
 const issueBox=await dialog.locator('.project-facts').first().boundingBox();assert.ok(issueBox.y+issueBox.height<900,'The reason for opening fits the first mobile screen.');
 await dialog.getByText('Tous les critères et sources',{exact:true}).click();
 assert.ok(await dialog.getByText('Source et date non documentées',{exact:true}).first().isVisible());assert.ok(await dialog.getByText('Non documenté dans cette source fictive.',{exact:true}).first().isVisible());assert.ok(await dialog.locator('time[datetime="'+at+'"]').first().isVisible());
 assert.ok(await dialog.getByText('À vérifier',{exact:true}).first().isVisible());assert.ok(await dialog.getByRole('link',{name:/Source :/}).first().isVisible());
 assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await dialog.getByText('Tous les critères et sources',{exact:true}).click();
 if(kind==='vehicle'){assert.ok(await dialog.getByRole('heading',{name:'Modèle et version'}).isVisible());assert.ok(await dialog.getByText(/2021 · Marque fictive · Modèle fictif/).isVisible());const summary=dialog.locator('summary').filter({hasText:'Cette annonce'});await summary.focus();await page.keyboard.press('Enter');assert.ok(await dialog.getByText('Accidents déclarés',{exact:true}).isVisible());await page.keyboard.press('Enter');assert.equal(await summary.evaluate(el=>el.parentElement.open),false);}
 else {assert.ok(await dialog.getByText('Strata / mois',{exact:true}).isVisible());assert.ok(await dialog.getByText('Comparables vendus insuffisants. Aucune estimation de bonne affaire.').isVisible());}
 await dialog.evaluate(el=>el.scrollTop=0);
 for(const el of [opener,dialog.getByRole('button',{name:'Fermer',exact:true}),dialog.locator('summary').first()]){const box=await el.boundingBox();assert.ok(box.height>=44);}
 await page.screenshot({path:join(out,`after-${kind}-details-${width}.png`),fullPage:true});await page.keyboard.press('Escape');
 await articles.nth(1).locator('h2 button').click();await dialog.waitFor();assert.ok(await dialog.locator('.project-facts').first().getByText('Critère non respecté',{exact:true}).isVisible());if(kind==='property')assert.ok(await dialog.getByText('500 $',{exact:false}).first().isVisible());await page.keyboard.press('Escape');
 await page.getByLabel(kind==='property'?'Comparer ce bien':'Comparer ce véhicule').nth(0).check();await page.getByLabel(kind==='property'?'Comparer ce bien':'Comparer ce véhicule').nth(1).check();comparisonMode='wrong';await page.getByRole('button',{name:'Comparer (2/3)',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('dialog[open]').count(),0);comparisonMode='valid';await page.getByRole('button',{name:'Comparer (2/3)',exact:true}).click();await dialog.waitFor();await page.getByRole('button',{name:'Fermer',exact:true}).click();
 conflict=true;await articles.first().locator('.property-price-row button').click();await page.getByRole('alert').waitFor();assert.equal(writes,1);assert.equal(cards[0].followed,false);conflict=false;await articles.first().locator('.property-price-row button').click();await articles.first().getByRole('button',{name:/Ne plus suivre/}).waitFor();assert.equal(writes,2);await page.reload();await page.getByRole('button',{name:/Ne plus suivre/}).waitFor();assert.equal(writes,2);
 mode='error';await page.locator('.property-heading button').click();await page.getByRole('alert').waitFor();assert.equal(await articles.count(),2);await page.screenshot({path:join(out,`error-${kind}-${width}.png`),fullPage:true});mode='empty';await page.locator('.property-heading button').click();await page.getByText(kind==='property'?'Aucun bien dans cette sélection.':'Aucun véhicule dans cette sélection.').waitFor();assert.equal(await articles.count(),0);await page.screenshot({path:join(out,`empty-${kind}-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Projets',exact:true}).first().click();await page.getByRole('button',{name:kind==='property'?'Nouveau bien':'Voiture',exact:true}).waitFor();await page.goBack();await page.getByRole('heading',{name:kind==='property'?'Nouveau bien':'Voiture',exact:true}).waitFor();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);proof.push({kind,width,writes,errors,external,firstScreenReason:true,focusRestored:true,targetsAtLeast44:true,contrasts});await context.close();console.log(`Project evidence PASS ${kind} ${width}`);
}await writeFile(join(out,'acceptance.json'),JSON.stringify({synthetic:true,results:proof},null,2));}finally{await browser.close();await new Promise(r=>server.close(r));}
