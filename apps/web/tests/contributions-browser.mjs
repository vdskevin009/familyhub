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
const plan = {id:"synthetic-plan",kind:"rrsp",currency:"CAD",personalGoalCents:600000,identifiedCents:100000,deadline:"2030-03-01",attribution:"confirmed",beneficiaryConfirmed:false,payments:[{id:"synthetic-row",date:"2030-01-01",amountCents:100000,kind:"weekly"}],unassigned:[{id:"excluded",date:"2030-01-01",amountCents:12300,currency:"CAD"}],warnings:[],sourceFreshness:"unknown",weeklyProjection:{amountCents:25000,remainingOccurrences:4,futureCents:100000,assumption:"Hypothèse fictive : rythme hebdomadaire maintenu."}};
plan.inferredCents=12345;
plan.inferredPayments=[{id:"inferred-source",date:"2030-01-01",amountCents:12345,attribution:"inferred",rationale:"Même référence que des virements précédents.",evidenceTransactionIds:["historic-1","historic-2"],sourceKey:"fsi_"+"a".repeat(64),collectedAt:"2030-01-01T12:00:00Z",bankReceiptConfirmed:false}];
const snapshot = {schema:1,evaluatedOn:"2030-01-01",daysPerMonth:30,plans:[plan,{...plan,id:"synthetic-resp",kind:"resp",beneficiaryName:"Enfant fictif",attribution:"unconfirmed",personalGoalCents:100000,weeklyProjection:null}]};
let browser;
try {
  browser = await chromium.launch({headless:true, ...(process.platform === "win32" ? {channel:"chrome"} : {})});
  for (const width of [320,390,768,1440]) {
    const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"});
    const page = await context.newPage(); const errors=[]; page.on("pageerror", e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem("familyhub.worker.v1",JSON.stringify({Endpoint:"https://synthetic-worker.invalid",ApiKey:"synthetic-key"})));
    let mode="ready";
    await page.route("https://synthetic-worker.invalid/**",route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/health')return route.fulfill({json:{status:'ok',capabilities:[]}});
      if(path==='/finances')return route.fulfill({json:{schema:1,revision:'empty',data:null,imports:[],decisions:{},decisionHistory:[]}});
      if(path!=='/contributions/progress')return route.fulfill({json:{items:[],records:[],jobs:[],state:'idle'}});
      return route.fulfill({status:mode==="offline"?503:200,contentType:"application/json",body:JSON.stringify(mode==="invalid"?{schema:0}:mode==="empty"?{...snapshot,plans:[]}:snapshot)});});
    await page.goto(base+"?view=contributions");
    const trigger = page.getByRole("button",{name:"Voir les versements REER",exact:true}); await trigger.waitFor();
    if (process.env.CONTRIBUTIONS_TEST_FONT) await page.addStyleTag({content:`body { font-family: ${process.env.CONTRIBUTIONS_TEST_FONT} !important; }`});
    assert.equal(await page.locator(".contribution-card").count(),2);
    assert.equal(await page.locator(".contribution-card.reached").count(),0);
    assert.equal(await page.locator(".contribution-card.effort").count(),1);
    assert.equal(await page.locator(".contribution-card time").count(),0);
    assert.equal(await page.getByRole("progressbar").count(),2);
    assert.equal(await page.locator(".contribution-inferred-summary").count(),2);
    assert.match(await page.getByRole("progressbar").first().getAttribute("aria-valuetext"), /1.?000/);
    if (!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))) console.error(await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.body).fontFamily,overflow:[...document.querySelectorAll("body *")].map(el=>({tag:el.tagName,class:el.className,rect:el.getBoundingClientRect().toJSON(),minWidth:getComputedStyle(el).minWidth})).filter(item=>item.rect.right>innerWidth+1)})));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if (process.env.CONTRIBUTIONS_TEST_FONT && width === 320) console.log("Fallback heading geometry", JSON.stringify(await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,items:[".page-heading h1", ".page-heading-actions button", ".shell-tools button"].map(selector=>({selector,rect:document.querySelector(selector).getBoundingClientRect().toJSON()}))}))));
    for(let i=0;i<2;i++) {
      await trigger.focus(); await page.keyboard.press("Enter");
      const dialog=page.getByRole("dialog"); await dialog.waitFor();
      assert.ok(await dialog.getByText("Hebdomadaires réalisés",{exact:true}).isVisible());
      assert.ok(await dialog.getByText("Virements non attribués · exclus",{exact:true}).isVisible());
      assert.ok(await dialog.getByRole("heading",{name:/Attribution déduite/}).isVisible());
      assert.ok(await dialog.getByText("Même référence que des virements précédents.",{exact:true}).isVisible());
      assert.ok(await dialog.getByText(/Réception bancaire non confirmée/).isVisible());
      for(let j=0;j<5;j++) await page.keyboard.press("Tab");
      assert.ok(await page.evaluate(()=>document.querySelector("dialog[open]").contains(document.activeElement)));
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(),0);
      assert.ok(await trigger.evaluate(el=>el===document.activeElement));
    }
    await mkdir("output/playwright/contributions",{recursive:true});
    await page.screenshot({path:`output/playwright/contributions/cards-${width}${process.env.CONTRIBUTIONS_TEST_FONT ? "-fallback" : ""}.png`,fullPage:true});
    for(const next of ["empty","invalid","offline","ready"]) {
      mode=next; await page.getByRole("button",{name:"Actualiser les contributions",exact:true}).click();
      if(next==="ready") await trigger.waitFor();
      else { await page.getByText(next==="empty"?"Objectif privé non configuré":"Données indisponibles",{exact:true}).first().waitFor(); assert.equal(await page.getByRole("progressbar").count(),0); }
    }
    const more = page.getByRole("button",{name: "Plus",exact:true}); await more.last().click();
    await page.getByRole("button",{name:"Finances",exact:true}).last().click(); await page.getByRole("button",{name:"Contributions",exact:true}).click(); await trigger.waitFor();
    await page.goBack(); await page.getByRole("heading",{name:"Plus",exact:true}).waitFor();
    await page.goForward(); await page.getByRole("button",{name:"Contributions",exact:true}).click(); await trigger.waitFor();
    assert.deepEqual(errors,[]); await context.close();
    console.log(`Contributions ${width}px: cards, modal keyboard/focus, error/empty, history passed.`);
  }
} finally { await browser?.close(); server.close(); }
