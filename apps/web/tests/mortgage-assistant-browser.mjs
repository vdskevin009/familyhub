/** End-to-end built PWA walkthrough with synthetic private evidence. No lender or production access. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep, join } from "node:path";
import { once } from "node:events";
import { snapshot, quote, assumptions } from "../../../tests/mortgage-fixture.ts";
import { emptyMortgage } from "../../worker/src/mortgage-model.ts";
import { compareMortgage } from "../../worker/src/mortgage-decision.ts";
import { buildMortgageDailyReport } from "../../worker/src/mortgage-daily.ts";
import { unavailableMortgageContext } from "../../worker/src/mortgage-sources.ts";

const root=resolve("apps/web/dist"),output=resolve("artifacts/mortgage-assistant");
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{const url=new URL(req.url,"http://localhost"),path=resolve(root,"."+url.pathname.replace(/^\/familyhub/,""));if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}try{const file=path===root||url.pathname.endsWith("/")?join(root,"index.html"):path;res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png"})[extname(file)]||"application/octet-stream");res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}/familyhub/`;
const day="2026-10-23", now=new Date(day+"T20:00:00Z"),source="Synthetic source, never household evidence";
const cost=(amount,financed=false)=>({amount,source,asOf:day,validUntil:"2026-11-23",financed});
const profile={schema:1,id:"synthetic-decision-profile",recordedAt:day+"T18:00:00Z",source,evidenceStatus:"documented",balanceAsOf:day,principal:400000,currentRate:5,remainingMonths:240,maturityDate:"2027-10-23",nextPaymentDate:"2026-11-23",paymentAmount:2600,rateType:"fixed",paymentMode:"fixed-payment",compounding:"semiannual",penalty:cost(1000,true),currentCashbackClawback:cost(0),notes:[]};
const fixed={...quote(),rate:3.2,receivedDate:"2026-10-16"},variable={...quote("adjustable-payment"),rate:3,receivedDate:"2026-10-16"};
const makeTerms=q=>({schema:1,id:"terms-"+q.id,offerId:q.id,recordedAt:day+"T18:00:00Z",source,validUntil:"2026-10-28",eligibility:"confirmed",offerStatus:"confirmed",compounding:q.variant==="fixed"?"semiannual":"monthly",paymentAmount:null,fees:cost(500),cashback:cost(0),cashbackPaidOn:null,cashbackClawback:cost(0),conditions:["Synthetic complete terms"]});
const makeSnapshot=(date,id,status="complete")=>{const s=snapshot(id,date+"T18:00:00Z");s.localDate=date;s.source.publishedAt=date+" 06:00";if(status==="failed"){s.status="failed";s.error="Synthetic failed rate collection";s.observations=s.observations.map(o=>({...o,status:"unavailable",rate:null,lender:null,reason:s.error}));}return s;};
const state=emptyMortgage();
state.snapshots=[makeSnapshot("2026-10-20","baseline"),makeSnapshot("2026-10-21","failed","failed"),makeSnapshot("2026-10-22","day22"),makeSnapshot(day,"day23")];state.baselineSnapshotId="baseline";state.quotes=[fixed,variable];state.assumptions=[assumptions()];state.profiles=[profile];state.terms=[makeTerms(fixed),makeTerms(variable)];state.settings=[];
const indicators=[{id:"synthetic-policy",key:"policy-rate",label:"Taux directeur",value:3,unit:"percent",observationDate:day,collectedAt:now.toISOString(),lastSuccessAt:now.toISOString(),status:"observed",reliability:"official",sourceUrl:"https://www.bankofcanada.ca/valet/observations/V39079/json",sourceTitle:"Banque du Canada · source synthétique de test",conditions:["Synthetic observed indicator, not a mortgage offer"],error:null},{id:"synthetic-bond-failed",key:"bond-5",label:"Obligation canadienne 5 ans",value:null,unit:"percent",observationDate:null,collectedAt:now.toISOString(),lastSuccessAt:"2026-10-22T18:00:00Z",status:"failed",reliability:"official",sourceUrl:"https://www.bankofcanada.ca/valet/observations/V39053/json",sourceTitle:"Banque du Canada · source synthétique de test",conditions:["Synthetic source failure"],error:"Source indisponible",lastKnown:{value:3.1,observationDate:"2026-10-22",collectedAt:"2026-10-22T18:00:00Z"}}];
const comparisons=state.quotes.map(q=>({...compareMortgage(profile,q,state.terms.find(t=>t.offerId===q.id),day),validUntil:"2026-10-28"}));
assert.ok(comparisons.every(c=>c.status==="estimated"));
const previous=buildMortgageDailyReport({state,now:new Date("2026-10-22T20:00:00Z"),indicators:[],comparisons:[]});
const contextSources=unavailableMortgageContext();contextSources[0]={...contextSources[0],status:"observed",date:"2026-10-28",collectedAt:now.toISOString(),detail:"Synthetic observed official calendar date"};
state.reports=[previous,buildMortgageDailyReport({state,now,previous:[previous],indicators,contextSources,comparisons})];
const browser=await chromium.launch({headless:true,channel:process.env.FAMILYHUB_TEST_BROWSER_CHANNEL||undefined,args:["--no-sandbox"]}),report=[];
try {
  for(const width of [320,360,384,412,768]) {
    const context=await browser.newContext({viewport:{width,height:900},timezoneId:"America/Vancouver",serviceWorkers:"block",reducedMotion:"reduce"}),page=await context.newPage(),errors=[],writes=[];
    await page.clock.setFixedTime(now);page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem("familyhub.worker.v1",JSON.stringify({Endpoint:"https://synthetic-mortgage.invalid",ApiKey:"synthetic-key"}));localStorage.setItem("mortgage-assistant-sentinel","preserved");});
    let mode="complete",savedSettings=[];
    await page.route("**/*",async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===new URL(base).origin){await route.continue();return;}if(url.hostname!=="synthetic-mortgage.invalid"){await route.abort();return;}
      if(req.method()!=="GET"){writes.push({method:req.method(),path:url.pathname});if(url.pathname==="/mortgage/settings"){savedSettings.push(req.postDataJSON());await route.fulfill({status:200,contentType:"application/json",body:'{"duplicate":false}'});return;}await route.fulfill({status:404,body:"{}"});return;}
      if(url.pathname==="/health"){await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({capabilities:mode==="no-capability"?[]:["mortgage-assistant-v1"]})});return;}if(url.pathname!=="/mortgage"){await route.fulfill({status:404,body:"{}"});return;}if(mode==="error"){await route.fulfill({status:503,body:"{}"});return;}
      const copy=structuredClone(state);copy.settings=savedSettings;
      if(mode==="empty"){copy.reports=[];copy.profiles=[];copy.terms=[];copy.snapshots=[];copy.quotes=[];copy.baselineSnapshotId=null;}
      if(mode==="stale")copy.reports=[previous];
      if(mode==="missing"){copy.profiles=[{...profile,maturityDate:null,penalty:{...profile.penalty,amount:null}}];}
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(copy)});
    });
    const app=page.getByRole("region",{name:"Assistant hypothécaire",exact:true}),tab=name=>app.getByRole("tab",{name,exact:true});
    await page.goto(base+"?view=mortgage");
    await app.locator(".ma-decision").getByRole("heading",{name:"Une opportunité à examiner",exact:true}).waitFor();
    assert.match(await app.locator(".ma-upcoming").innerText(),/28 oct/);assert.match(await app.locator(".ma-key-number").innerText(),/Gain net estimé/);assert.ok(!(await app.locator(".ma-key-number strong").innerText()).includes("confirmer"));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Today overflow "+width);
    await page.screenshot({path:join(output,"today-"+width+".png")});
    await app.getByRole("button",{name:"Voir le graphique",exact:true}).click();
    assert.equal(await tab("Taux").getAttribute("aria-selected"),"true");
    assert.equal(await app.locator(".ma-series [aria-pressed=true]").count(),2);
    assert.equal(await app.locator('[data-rate-series="fixed-3"]').count(),2,"Failed date breaks observed line");
    await app.getByLabel("Date du graphique",{exact:true}).selectOption("2026-10-21");
    assert.equal(await app.locator(".ma-selected-observation dd").filter({hasText:"Indisponible"}).count(),2);
    for(const name of ["7 jours","1 mois","3 mois","6 mois","Tout"])await app.getByRole("button",{name,exact:true}).click();
    await app.getByRole("button",{name:"Fixe · 5 ans",exact:true}).click();assert.equal(await app.locator(".ma-series [aria-pressed=true]").count(),3);
    await app.getByRole("checkbox",{name:"Référence figée du 20 octobre 2026",exact:true}).uncheck();
    await app.getByLabel("Date du graphique",{exact:true}).selectOption(day);await app.getByText("Sources et conditions du 23 oct.",{exact:true}).click();assert.match(await app.locator(".ma-selected-observation").innerText(),/Synthetic public observation/);
    await page.screenshot({path:join(output,"rates-"+width+".png")});
    await tab("Indicateurs").click();assert.match(await app.getByRole("region",{name:"Indicateurs du marché"}).innerText(),/Dernière valeur connue.*3,10/);assert.equal(await app.locator('.ma-indicator[data-status="failed"] strong').innerText(),"Indisponible");assert.equal(await app.getByRole("region",{name:"Contexte économique et calendrier",exact:true}).count(),1);
    await tab("Simulations").click();await app.getByRole("region",{name:"Comparaison financière"}).waitFor();assert.match(await app.locator(".ma-simulation-summary").innerText(),/Gain net estimé/);
    await app.getByLabel("Proposition à comparer",{exact:true}).selectOption(variable.id);
    const stable=await app.locator(".ma-simulation-summary dd").first().innerText();
    await app.getByRole("button",{name:"Hausse 0,50 point",exact:true}).click();assert.notEqual(await app.locator(".ma-simulation-summary dd").first().innerText(),stable);assert.match(await app.innerText(),/2026-11-23/);
    await app.getByRole("button",{name:"Intérêts",exact:true}).click();assert.equal(await app.getByRole("heading",{name:"Intérêts cumulés (CAD)",exact:true}).count(),1);
    assert.equal(await app.locator(".ma-simulation-chart path[stroke-dasharray]").count(),2);
    await app.getByText("Coûts, remise et récupération",{exact:true}).click();assert.match(await app.innerText(),/produit|génère des intérêts/);
    await page.screenshot({path:join(output,"simulation-"+width+".png")});
    await tab("Rapports").click();await app.getByLabel("Rapport à consulter",{exact:true}).selectOption(previous.id);assert.match(await app.locator(".ma-report-header").innerText(),/22 oct/);await app.locator(".ma-report-body summary").filter({hasText:/^Faits observés/}).click();
    await app.getByText("Seuils des alertes",{exact:true}).click();await app.getByRole("spinbutton",{name:"Gain net significatif",exact:true}).fill("2000");assert.equal(writes.length,0);
    await Promise.all([page.waitForResponse(r=>r.url().endsWith("/mortgage/settings")),app.getByRole("button",{name:"Enregistrer les seuils",exact:true}).click()]);await page.waitForFunction(()=>document.querySelector('.ma-threshold-form input')?.value==="2000");
    assert.deepEqual(writes,[{method:"POST",path:"/mortgage/settings"}]);assert.equal(savedSettings.length,1);assert.equal(savedSettings[0].minimumNetGain,2000);
    mode="no-capability";await app.getByRole("button",{name:"Enregistrer les seuils",exact:true}).click();await app.getByText(/Le worker ne confirme pas la capacité Mortgage assistant/).waitFor();assert.equal(writes.length,1,"Missing capability sends no POST");assert.equal(await app.getByRole("button",{name:"Enregistrer les seuils",exact:true}).isDisabled(),true);mode="complete";await app.getByRole("button",{name:"Actualiser",exact:true}).first().click();await page.waitForFunction(()=>!document.querySelector('.ma-threshold-form button[type="submit"]')?.disabled);assert.equal(writes.length,1,"Refresh never retries a write");
    await tab("Offres et contacts").click();await app.locator(".mortgage-offer-row").first().waitFor();await app.getByRole("tab",{name:"Contacts",exact:true}).click();assert.match(await app.innerText(),/Aucun contact privé enregistré/);
    await tab("Aujourd’hui").focus();await page.keyboard.press("ArrowRight");assert.equal(await tab("Taux").getAttribute("aria-selected"),"true");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Flow overflow "+width);
    mode="missing";await app.getByRole("button",{name:"Actualiser",exact:true}).first().click();await tab("Simulations").click();await app.getByText("Gain net indisponible",{exact:true}).waitFor();assert.match(await app.innerText(),/Échéance actuelle exacte à confirmer|Pénalité de remboursement/);
    mode="stale";await app.getByRole("button",{name:"Actualiser",exact:true}).first().click();await tab("Aujourd’hui").click();await app.getByRole("heading",{name:"L’analyse du jour est attendue",exact:true}).waitFor();assert.equal(await app.locator(".ma-key-number strong").innerText(),"À confirmer");
    mode="empty";await app.getByRole("button",{name:"Actualiser",exact:true}).first().click();await tab("Rapports").click();await app.getByText(/Aucun rapport quotidien enregistré/).waitFor();
    mode="error";await app.getByRole("button",{name:"Actualiser",exact:true}).first().click();await app.getByText("Historique indisponible. Vérifiez le PC puis actualisez.",{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem("mortgage-assistant-sentinel")),"preserved");assert.deepEqual(errors,[]);
    report.push({width,overview:true,chartGaps:true,ranges:true,indicatorsFailure:true,variableScenario:true,costs:true,history:true,settingsExplicitWrite:1,staleReport:true,missing:true,empty:true,error:true,noExternalRequests:true});
    await context.close();
  }
  await writeFile(join(output,"browser-report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
