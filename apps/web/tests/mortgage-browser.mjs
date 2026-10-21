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
    await page.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin===new URL(base).origin){await route.continue();return;}
      if(req.method()!=="GET")writes.push(req.method()+" "+url.pathname);
      if(url.hostname!=="synthetic-mortgage.invalid") {await route.abort();return;}
      if(url.pathname!=="/mortgage"){await route.fulfill({status:404,body:"{}"});return;}
      if(delay)await new Promise(r=>setTimeout(r,delay));
      if(mode==="error"){await route.fulfill({status:503,body:"{}"}).catch(()=>{});return;}
      const copy=structuredClone(state);
      if(mode==="empty"){copy.snapshots=[];copy.quotes=[];copy.assumptions=[];copy.baselineSnapshotId=null;}
      if(mode==="partial"){const s=snapshot("later","2026-10-21T01:30:00Z");s.status="partial";s.observations[3]={product:"variable-5",status:"unavailable",rate:null,lender:null,reason:"Table interrompue",eligibility:["Unknown"]};copy.snapshots.push(s);}
      if(mode==="failed"){const s=snapshot("failed","2026-10-21T01:45:00Z");s.status="failed";s.error="Source inaccessible";s.observations=s.observations.map(o=>({...o,status:"unavailable",rate:null,lender:null,reason:"Source inaccessible"}));copy.snapshots.push(s);}
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(copy)}).catch(()=>{});
    });
    const mortgage=()=>page.locator(".mortgage"),refresh=()=>mortgage().getByRole("button",{name:"Actualiser",exact:true});
    const navigate=async name=>{await page.getByRole("button",{name,exact:true}).locator("visible=true").first().click();};
    await page.goto(base+"?view=mortgage");await mortgage().getByText("Quatre produits observés aujourd’hui.").waitFor();
    assert.equal(await mortgage().getByRole("heading",{name:"Mortgage",exact:true}).count(),1);
    if(width<760){const rows=await page.locator(".bottom-nav button").evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().top));assert.equal(new Set(rows).size,1,"All seven tabs remain in one row");}
    const refreshBox=await refresh().boundingBox(),bellBox=await page.getByRole("button",{name:"Ouvrir les notifications",exact:true}).boundingBox();assert.ok(!refreshBox||!bellBox||refreshBox.x+refreshBox.width<=bellBox.x||refreshBox.y>=bellBox.y+bellBox.height,"Refresh is clear of shell notification control");
    await mortgage().getByLabel("Afficher l’estimation de négociation").focus();await page.keyboard.press("Space");await mortgage().getByRole("region",{name:"Estimation de négociation"}).waitFor();
    assert.equal(await mortgage().getByText(/écart \+0.05 pt/).count(),2);assert.equal(await mortgage().getByText(/écart -0.05 pt/).count(),1);
    await mortgage().getByLabel("Produit public comparé").selectOption("variable-5");assert.ok((await mortgage().innerText()).includes("aucune économie constante n’est garantie"));
    const quoteCards=mortgage().locator(".mortgage-quote");for(let i=0;i<3;i++){await quoteCards.nth(i).getByText("Comparer cette offre au taux actuel",{exact:true}).click();}assert.ok((await quoteCards.nth(2).innerText()).includes("Aucune économie de trésorerie n’est présumée"));assert.equal(await quoteCards.nth(2).locator("dd").count(),0);
    await mortgage().getByText("Observations, filtres et tentatives",{exact:true}).click();assert.ok((await mortgage().innerText()).includes("Personal eligibility unverified"));
    await page.evaluate(()=>scrollTo(0,0));
    const contrast=await mortgage().evaluate(el=>{
      const parse=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=rgb=>rgb.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0),ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const text=getComputedStyle(el.querySelector("p")).color,body=getComputedStyle(document.body).backgroundColor,button=getComputedStyle(el.querySelector("button")),focus=getComputedStyle(el).getPropertyValue("--accent").trim(),hex=focus.match(/[a-f0-9]{2}/gi).map(s=>parseInt(s,16));
      return {text,body,textRatio:ratio(parse(text),parse(body)),buttonRatio:ratio(parse(button.color),parse(button.backgroundColor)),focusRatio:ratio(hex,parse(body))};
    });assert.ok(contrast.textRatio>=4.5);assert.ok(contrast.buttonRatio>=4.5);assert.ok(contrast.focusRatio>=3);
    await page.screenshot({path:join(output,`mortgage-${width}.png`),fullPage:true});await page.screenshot({path:join(output,`overview-${width}.png`)});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"No page overflow at "+width);
    mode="partial";await refresh().click();await mortgage().getByText("Collecte partielle : certains produits sont indisponibles.").waitFor();assert.ok((await mortgage().locator(".mortgage-rates").innerText()).includes("Table interrompue"));
    mode="failed";await refresh().click();await mortgage().getByText("Collecte échouée : Source inaccessible").waitFor();assert.equal(await mortgage().locator(".mortgage-rates").getByText("Indisponible",{exact:true}).count(),4);
    mode="empty";await refresh().click();await mortgage().getByText(/Aucun historique enregistré/).waitFor();
    mode="error";await refresh().click();await mortgage().getByText("Historique indisponible. Vérifiez le PC puis actualisez.").waitFor();
    mode="complete";delay=400;await refresh().click();await navigate("Courses");await navigate("Mortgage");delay=0;await mortgage().getByText("Quatre produits observés aujourd’hui.").waitFor();
    for(let n=0;n<3;n++){await navigate("Courses");await navigate("Mortgage");await mortgage().getByText("Quatre produits observés aujourd’hui.").waitFor();}
    await page.goBack();await page.goForward();await mortgage().getByText("Quatre produits observés aujourd’hui.").waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem("unrelated-mortgage-test-sentinel")),"preserved");assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    report.push({width,complete:true,partial:true,failed:true,empty:true,errorRecovery:true,keyboard:true,interruptedNavigation:true,repeatedNavigation:true,noWrites:true,contrast});await context.close();
  }
  await writeFile(join(output,"browser-report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();await new Promise(r=>server.close(r));}
