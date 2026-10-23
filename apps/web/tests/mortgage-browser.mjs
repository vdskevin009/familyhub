/** Built PWA acceptance with synthetic rates/quotes; no real worker or provider access. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep, join } from "node:path";
import { once } from "node:events";
import { snapshot, quote, assumptions } from "../../../tests/mortgage-fixture.ts";
import { emptyMortgage } from "../../worker/dist/mortgage-model.js";
const root=resolve("apps/web/dist"), output=resolve("artifacts/mortgage");await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{const url=new URL(req.url,"http://localhost"),path=resolve(root,"."+url.pathname.replace(/^\/familyhub/,""));if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}try{const file=path===root||url.pathname.endsWith("/")?join(root,"index.html"):path;res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png"})[extname(file)]||"application/octet-stream");res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}/familyhub/`;
const browser=await chromium.launch({headless:true,channel:process.env.FAMILYHUB_TEST_BROWSER_CHANNEL||undefined,args:["--no-sandbox"]}), report=[];
try {
  for(const width of [320,390,768,1280]) {
    const context=await browser.newContext({viewport:{width,height:900},timezoneId:"America/Vancouver",serviceWorkers:"block",reducedMotion:"reduce"}),page=await context.newPage(),errors=[],writes=[];
    await page.clock.setFixedTime(new Date("2026-10-21T02:00:00Z"));
    page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem("familyhub.worker.v1",JSON.stringify({Endpoint:"https://synthetic-mortgage.invalid",ApiKey:"synthetic-key"}));localStorage.setItem("unrelated-mortgage-test-sentinel","preserved");});
    let mode="complete",delay=0;
    const state=emptyMortgage(),first=snapshot();state.snapshots=[first];state.baselineSnapshotId=first.id;state.quotes=[quote(),quote("adjustable-payment"),quote("fixed-payment")];state.assumptions=[assumptions()];
    state.contacts=Array.from({length:6},(_,i)=>({id:"synthetic-contact-"+i,contactId:"person-"+i,recordedAt:"2026-10-20T19:00:00Z",name:"Synthetic Contact "+(i+1),organization:"Synthetic Organization "+(i+1),status:["appointment","appointment","appointment","email-sent","awaiting-response","paused"][i],source:"SYNTHETIC_PRIVATE_SOURCE",notes:["SYNTHETIC_DETAIL_ONLY"],appointment:i<3?{startsAt:"2026-11-10T18:15:00Z",endsAt:i===0?"2026-11-10T18:35:00Z":null,source:"Synthetic invitation"}:null}));
    state.offers=state.quotes.map((q,i)=>({...q,id:q.id+"-extended",supersedes:q.id,contactId:"person-0",cashback:i===1?{amount:1700,basis:"cashback",conditions:["Synthetic adjustable eligibility"]}:i===2?{amount:2900,basis:"total-incentive",conditions:["Synthetic fixed-payment total components"]}:null}));
    state.offers.push({...quote(),id:"synthetic-historical",contactId:"person-3",status:"historical",product:"fixed-3",rate:4.9});
    await page.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin===new URL(base).origin){await route.continue();return;}
      if(req.method()!=="GET")writes.push(req.method()+" "+url.pathname);
      if(url.hostname!=="synthetic-mortgage.invalid") {await route.abort();return;}
      if(url.pathname!=="/mortgage"){await route.fulfill({status:404,body:"{}"});return;}
      if(delay)await new Promise(r=>setTimeout(r,delay));
      if(mode==="error"){await route.fulfill({status:503,body:"{}"}).catch(()=>{});return;}
      const copy=structuredClone(state);
      if(mode==="empty"){copy.snapshots=[];copy.quotes=[];copy.offers=[];copy.assumptions=[];copy.contacts=[];copy.baselineSnapshotId=null;}
      if(mode==="partial"){const s=snapshot("later","2026-10-21T01:30:00Z");s.status="partial";s.observations[3]={product:"variable-5",status:"unavailable",rate:null,lender:null,reason:"Table interrompue",eligibility:["Unknown"]};copy.snapshots.push(s);}
      if(mode==="failed"){const s=snapshot("failed","2026-10-21T01:45:00Z");s.status="failed";s.error="Source inaccessible";s.observations=s.observations.map(o=>({...o,status:"unavailable",rate:null,lender:null,reason:"Source inaccessible"}));copy.snapshots.push(s);}
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(copy)}).catch(()=>{});
    });

    const mortgage=()=>page.locator('.mortgage-compact'),refresh=()=>page.locator('.mortgage-assistant > .ma-heading').getByRole('button',{name:'Actualiser',exact:true});
    const navigate=async name=>{
      const nav=page.locator('.bottom-nav:visible, .app-rail nav:visible');
      if(name==='Hypothèque') {
        await nav.getByRole('button',{name:'Plus',exact:true}).click();
        await page.locator('.other-link').filter({hasText:'Hypothèque'}).click();
        await page.getByRole('tab',{name:'Offres et contacts',exact:true}).click();
      } else await nav.getByRole('button',{name,exact:true}).click();
    };
    await page.goto(base+'?view=mortgage');await page.getByRole('tab',{name:'Offres et contacts',exact:true}).click();await mortgage().locator('.mortgage-offer-row').first().waitFor();assert.equal(await mortgage().locator('.mortgage-offer-row').count(),2);
    assert.equal(await page.locator('.ma-heading').getByRole('heading',{name:'Mortgage',exact:true}).count(),1);
    await mortgage().getByRole('button',{name:'Remise ↓',exact:true}).click();assert.match(await mortgage().locator('.mortgage-offer-row').first().innerText(),/Fixes/);
    await mortgage().getByRole('button',{name:'Taux ↑',exact:true}).click();assert.match(await mortgage().locator('.mortgage-offer-row').first().innerText(),/ajustables/i);
    await mortgage().locator('.mortgage-offer-row').first().click();let dialog=page.getByRole('dialog');assert.equal(await dialog.getByText('Comparer cette offre au taux actuel',{exact:true}).count(),0);await dialog.getByRole('button',{name:'Comparer jusqu’à mon échéance actuelle',exact:true}).click();await page.getByRole('region',{name:'Simulations financières'}).waitFor();assert.match(await page.getByRole('region',{name:'Simulations financières'}).innerText(),/Gain net indisponible/);await page.getByRole('tab',{name:'Offres et contacts',exact:true}).click();await mortgage().locator('.mortgage-offer-row').first().click();dialog=page.getByRole('dialog');
    assert.equal(await dialog.getByText('Scénario de négociation',{exact:true}).count(),0);await dialog.getByRole('button',{name:'‹ Contact',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'3 propositions reçues',exact:true}).waitFor();await dialog.getByText('Historique',{exact:true}).click();assert.match(await dialog.innerText(),/version conservée.*Synthetic dated email/);await dialog.getByRole('button',{name:'‹ Contacts',exact:true}).click();assert.equal(await mortgage().getByRole('tab',{name:'Contacts',exact:true}).getAttribute('aria-selected'),'true');await mortgage().getByRole('tab',{name:'Taux',exact:true}).click();
    await mortgage().locator('.mortgage-offer-row').nth(1).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Comparer jusqu’à mon échéance actuelle',exact:true}).click();await page.getByRole('region',{name:'Simulations financières'}).waitFor();assert.equal(await page.locator('.ma-simulation-summary').count(),0);await page.getByRole('tab',{name:'Offres et contacts',exact:true}).click();
    await page.screenshot({path:join(output,'compact-rates-'+width+'.png')});
    await mortgage().getByRole('tab',{name:'Marché',exact:true}).click();await mortgage().getByRole('region',{name:'Marché public'}).waitFor();assert.equal(await mortgage().locator('.mortgage-offer-row').count(),0);assert.match(await mortgage().locator('.mortgage-market-rate').innerText(),/3,60/);
    await mortgage().getByRole('button',{name:'7 jours',exact:true}).click();assert.match(await mortgage().locator('.mortgage-delta').innerText(),/Indisponible/);await mortgage().getByRole('button',{name:'Référence',exact:true}).click();assert.match(await mortgage().locator('.mortgage-delta').innerText(),/0.00 pt/);
    assert.equal(await mortgage().getByText('Versements et intérêts · illustration brute',{exact:true}).count(),0);assert.equal(await mortgage().getByRole('button',{name:'Ouvrir les simulations jusqu’à mon échéance',exact:true}).count(),1);
    await mortgage().getByText('Observations, filtres et tentatives',{exact:true}).click();assert.match(await mortgage().innerText(),/Personal eligibility unverified/);
    await mortgage().getByRole('tab',{name:'Contacts',exact:true}).focus();await page.keyboard.press('Home');assert.equal(await mortgage().getByRole('tab',{name:'Taux',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('ArrowRight');
    await mortgage().locator('.mortgage-contact-card').first().waitFor();assert.equal(await mortgage().locator('.mortgage-contact-card').count(),6);assert.doesNotMatch(await mortgage().locator('.mortgage-contacts').innerText(),/SYNTHETIC_DETAIL_ONLY|SYNTHETIC_PRIVATE_SOURCE/);assert.match(await mortgage().locator('.mortgage-contact-card').nth(3).innerText(),/ancien/);
    await page.screenshot({path:join(output,'compact-contacts-'+width+'.png')});await mortgage().locator('.mortgage-contact-card').first().click();dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'3 propositions reçues',exact:true}).waitFor();assert.equal(await dialog.locator('.mortgage-offer-tile').count(),3);await dialog.getByText('Conditions et échanges',{exact:true}).click();assert.match(await dialog.innerText(),/SYNTHETIC_DETAIL_ONLY/);await page.screenshot({path:join(output,'compact-contact-detail-'+width+'.png')});await dialog.locator('.mortgage-offer-tile').first().click();await page.getByRole('dialog').getByRole('button',{name:'‹ Contact',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'3 propositions reçues',exact:true}).waitFor();await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width);
    await mortgage().getByRole('tab',{name:'Taux',exact:true}).click();await mortgage().getByRole('tab',{name:'Marché',exact:true}).click();
    mode='partial';await refresh().click();await mortgage().getByText('Collecte partielle : certains produits sont indisponibles.').waitFor();assert.match(await mortgage().locator('.mortgage-market-rate').innerText(),/Table interrompue/);
    mode='failed';await refresh().click();await mortgage().getByText('Collecte échouée : Source inaccessible').waitFor();assert.match(await mortgage().locator('.mortgage-market-rate').innerText(),/Indisponible/);
    mode='empty';await refresh().click();await mortgage().getByText(/Aucun historique enregistré/).waitFor();
    mode='error';await refresh().click();await mortgage().getByText('Historique indisponible. Vérifiez le PC puis actualisez.').waitFor();
    mode='complete';delay=400;await refresh().click();await navigate('Courses');await navigate('Hypothèque');delay=0;await mortgage().locator('.mortgage-offer-row').first().waitFor();
    for(let n=0;n<3;n++){await navigate('Courses');await navigate('Hypothèque');await mortgage().locator('.mortgage-offer-row').first().waitFor();}
    await page.goBack();await page.getByRole('heading',{name:'Plus',exact:true}).waitFor();await page.goForward();await page.getByRole('tab',{name:'Offres et contacts',exact:true}).click();await mortgage().locator('.mortgage-offer-row').first().waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-mortgage-test-sentinel')),'preserved');assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    report.push({width,compactOffers:true,optionSpecificIncentives:true,fixedPaymentCaution:true,marketSeparate:true,periodGaps:true,contacts:6,historical:true,keyboard:true,partial:true,failed:true,empty:true,interruptedNavigation:true,repeatedNavigation:true,noWrites:true});await context.close();
  }
  await writeFile(join(output,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
