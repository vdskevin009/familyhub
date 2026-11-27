import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root=resolve('apps/web/dist');
const out='output/playwright/opportunity-dossier';
const checkRender = process.argv.includes('--check-render');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.replace(/^\/familyhub\//,'');
  const file=resolve(root,path || 'index.html');
  if(!file.startsWith(root+sep)) return res.writeHead(403).end();
  try {const bytes=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)] || 'text/html');res.end(bytes);}
  catch {res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port+'/familyhub/';
const at='2026-11-27T20:00:00Z';
const fact=value=>({value,checkedAt:value===null?null:at,sourceUrl:value===null?null:'https://document.invalid/example',note:'Fixture synthétique'});
function listing(kind,i) {
  const id=kind+'-'+i;
  const common={id,listingId:id,observedAt:at,url:'https://listing.invalid/'+id,status:'active',statusEvidence:fact('active'),followed:false,changes:[],
    primaryPhoto:i===2?null:{url:'https://media.invalid/'+i,sourceUrl:'https://listing.invalid/'+id,attribution:'Photo fictive',checkedAt:at}};
  return kind==='property'?{...common,address:'Bien fictif '+i,bedrooms:fact(3),lowerLonsdale:fact(true),separateEntrances:fact(true),priceCad:fact(530000),monthlyStrataFeeCad:fact(350),airbnb:{status:'unknown',evidence:[]}}
    :{...common,title:'Auto fictive '+i,make:fact('Marque témoin'),model:fact('Modèle témoin'),trim:fact('Essai'),year:fact(2022),mileageKm:fact(60000+i*1000),location:fact('Grand Vancouver'),awd:fact(false),used:fact(true),familySuv:fact(true),greaterVancouver:fact(true),accidentHistory:fact(null),priceBasis:'before-tax',priceCad:fact(24000-i*1000)};
}
const browser=await chromium.launch({headless:true, ...(process.platform === 'win32' ? {channel:'chrome'} : {})});
try {
  await mkdir(out,{recursive:true});
  for(const width of [320,390,1440]) for(const kind of ['property','vehicle']) {
    const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',timezoneId:'America/Vancouver'});
    const page=await ctx.newPage(),errors=[],unexpected=[];let releaseImage;
    const imageAllowed=new Promise(done=>{releaseImage=done;});
    await page.clock.install({time:new Date(at)});
    page.on('pageerror',e=>errors.push(e.message));
    await ctx.addInitScript(()=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint:'https://fixture.invalid',ApiKey:'fixture-only'})));
    await ctx.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin===new URL(base).origin) return route.continue();
      if(url.origin==='https://media.invalid'){
        if(url.pathname==='/1') return route.fulfill({status:404,body:''});
        await imageAllowed;return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="120"><rect width="280" height="120" fill="#dce7ec"/><text x="140" y="64" text-anchor="middle">Image de test</text></svg>'});
      }
      if(url.origin==='https://fixture.invalid' && req.method()==='GET') return route.fulfill({json:url.pathname==='/'+kind+'-project'?{cards:[0,1,2].map(i=>listing(kind,i)),followingRevision:0}:{items:[],records:[],jobs:[],state:'idle'}});
      unexpected.push(req.method()+' '+url.origin);return route.abort();
    });
    await page.goto(base+'?view=projects');
    await page.getByRole('button',{name:kind==='property'?'Property search':'Vehicles',exact:true}).click();
    const cards=page.locator('.property-card');
    await cards.first().getByText('Loading photo…').waitFor();releaseImage();
    await cards.first().getByText('Loading photo…').waitFor({state:'hidden'});
    assert.ok(await cards.first().locator('img').evaluate(el=>el.complete&&el.naturalWidth>0&&el.referrerPolicy==='no-referrer'));
    await cards.nth(1).scrollIntoViewIfNeeded();await cards.nth(1).getByText('Listing photo unavailable').waitFor();
    assert.ok(await cards.nth(2).getByText('No photo available').isVisible());
    const opener=cards.first().locator('h2 button');
    if (checkRender) {
      const card = cards.first();
      await card.screenshot({path:out+'/'+kind+'-'+width+'-card.png'});
      const bounds = await card.boundingBox();
      const title = await opener.boundingBox();
      assert.ok(bounds && title && bounds.x >= -1 && bounds.x + bounds.width <= width + 1 &&
        title.width > 0 && title.height > 0 && title.x >= bounds.x - 1 &&
        title.x + title.width <= bounds.x + bounds.width + 1, kind+' '+width+'px: card and title fit the viewport');
    }
    await opener.focus();await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog'), analysis=dialog.getByRole('region',{name:'Opportunity analysis'});
    await analysis.getByRole('heading',{name:'Plan a viewing'}).waitFor();
    const photo=analysis.getByRole('img',{name:/Listing photo/});
    await photo.waitFor();
    await analysis.getByText('Loading photo…').waitFor({state:'hidden'});
    assert.ok(await photo.evaluate(el=>el.complete && el.naturalWidth>0 && el.referrerPolicy==='no-referrer'));
    assert.equal(await analysis.getByRole('link',{name:'Photo fictive'}).getAttribute('href'),'https://listing.invalid/'+kind+'-0');
    const motifs=analysis.getByText('Reasons and confidence',{exact:true});
    await motifs.focus();await page.keyboard.press('Enter');await analysis.getByRole('link',{name:/Observed status/}).waitFor();
    assert.ok((await motifs.boundingBox()).height>=44);await page.keyboard.press('Enter');
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await dialog.screenshot({path:out+'/'+kind+'-'+width+'.png'});
    if (checkRender) {
      const image = await photo.boundingBox();
      const credit = await analysis.getByRole('link',{name:'Photo fictive'}).boundingBox();
      assert.ok(image && image.width > 0 && image.height > 0 &&
        await photo.evaluate(el => getComputedStyle(el).objectFit === 'contain'),
        kind+' '+width+'px: open dossier must show the whole photo');
      assert.ok(credit && credit.height >= 24 && credit.x >= image.x - 1 &&
        credit.x + credit.width <= image.x + image.width + 1,
        kind+' '+width+'px: photo credit must be reachable and fit within the photo');
      assert.ok(await motifs.evaluate(el => el === document.activeElement && el.matches(':focus-visible') &&
        getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) >= 2),
        kind+' '+width+'px: disclosure must retain a visible keyboard focus');
      console.log('PASS card render '+kind+' '+width+'px: card, photo, attribution and keyboard focus');
    }
    if(kind==='property'){
      await analysis.getByText('Ownership costs and conditions',{exact:true}).click();
      await analysis.getByText(/Over twelve months at that rate/).waitFor();
      await analysis.getByText('Review documented comparable sales').click();
      await analysis.getByLabel('Property living area (sq. ft.)',{exact:true}).fill('1000');
      await analysis.getByLabel('Public source for the property’s living area').fill('https://surface.invalid/subject');
      for(let i=0;i<3;i++){
        await analysis.getByRole('button',{name:'Add reference'}).click();
        const group=analysis.getByRole('group',{name:'Reference '+(i+1)});
        await group.getByLabel('Price type').selectOption('sold');
        await group.getByLabel(/Address including/).fill('Unité fictive '+i);
        await group.getByLabel('Documented price (CAD)').fill(String(500000+i*25000));
        await group.getByLabel('Living area (sq. ft.)',{exact:true}).fill('1000');
        await group.getByLabel('Public source for price and features').fill('https://sale.invalid/'+i);
        await group.getByLabel('Sale date').fill('2026-11-02');
        await group.getByLabel('Date source was checked').fill('2026-11-20');
        await group.getByLabel('Features and differences').fill('État et tenure comparables, exemple fictif.');
        await group.getByRole('checkbox').check();
      }
      await analysis.getByText('Asking price within the selected sales range').waitFor();
      await analysis.getByRole('group',{name:'Reference 2'}).getByLabel('Price type').selectOption('asking');
      await analysis.getByText('At least three distinct comparable sales are required.').waitFor();
    } else {
      await analysis.getByText(/Local comparison listings \(2\)/).click();
      assert.equal(await analysis.getByRole('link',{name:/Asking price/}).count(),2);
    }
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    await opener.click();await analysis.waitFor();assert.equal(await analysis.locator('fieldset').count(),0);
    await page.keyboard.press('Escape');
    for (const [index,label] of [[1,'Listing photo unavailable'],[2,'No photo available']]) {
      await cards.nth(index).locator('h2 button').click();
      await analysis.getByText(label,{exact:true}).waitFor();
      assert.equal(await analysis.getByRole('img').count(),0);
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    console.log('PASS projects → '+kind+' '+width+'px, photo states, evidence, keyboard, recovery');await ctx.close();
  }
} finally {await browser.close();await new Promise(done=>server.close(done));}
