/** Real resolution store with fictional receipts. No installed worker, account or real purchase. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, extname, join } from "node:path";
import { emptyPlan, emptyEvidence } from "../../worker/dist/grocery-planning.js";
import { emptyReceipt, blankItem } from "../../worker/dist/grocery-model.js";
import { purchaseLineKey } from "../../worker/dist/grocery-purchase-evidence.js";
import { GroceryPurchaseResolutionStore } from "../../worker/dist/grocery-purchase-resolution-store.js";
const now = new Date(), today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const record = { id: "synthetic-purchase", revision: "r1", status: "saved", extraction: "complete", reviewedAt: null, createdAt: now.toISOString(), duplicateOf: null, sources: [], receipt: { ...emptyReceipt(), sourceType: "confirmation", store: "PC Express synthetic", date: today, fulfillment: { date: today, evidence: "Synthetic delivered source" }, total: 43, currency: "CAD", items: ["Synthetic grain", "Synthetic vegetables", "Synthetic protein", "Synthetic ambiguous", "Synthetic unknown"].map((product, i) => ({ ...blankItem(), name: product, product, quantity: i === 0 ? 2 : 1, evidence: "Synthetic original confirmation, final payment unknown" })) } };
const plan = { ...emptyPlan(), items: [{ id: "grain", name: "Synthetic grain", quantity: null, size: null, unit: null, preference: "", substitutions: false, active: false, origin: "synthetic" }], retailers: [{ id: "wm", name: "Walmart", membershipStatus: "none", mode: "pickup", locality: "Synthetic branch", areaConfirmed: true, otherFeesReviewed: false, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, evidence: emptyEvidence() }], prices: [{ id: "grain-price", itemId: "grain", retailerId: "wm", product: "Synthetic grain", price: 3, size: 400, unit: "g", weighed: false, taxPercent: null, currency: "CAD", available: "yes", substitution: false, approved: true, kind: "public", mode: "pickup", locality: "Synthetic branch", localityConfirmed: true, matchNote: "Exact synthetic product and format reviewed", evidence: { title: "Synthetic public observation", url: "https://example.com/grain", date: today, until: today } }] };
const candidates = record.receipt.items.slice(0,4).map((line, lineIndex) => ({ id: "candidate-" + lineIndex, recordId: record.id, lineIndex, lineKey: purchaseLineKey(line), product: line.product, brand: "Synthetic brand", productId: "1234567" + lineIndex + "_EA", itemId: lineIndex === 0 ? "grain" : null, size: lineIndex === 3 ? null : 400, unit: lineIndex === 3 ? null : "g", formatLabel: lineIndex === 3 ? "Selling unit, physical weight unknown" : "400 g", formatBasis: lineIndex === 2 ? "household-assumption" : "public-source", sourceUrl: "https://example.com/synthetic-candidate-" + lineIndex, observedAt: new Date(now.getTime()-60000).toISOString(), note: "Synthetic source with dated provenance. Historical purchase requires an explicit choice." }));
const dir = await mkdtemp(join(tmpdir(), "familyhub-resolution-browser-")), store = new GroceryPurchaseResolutionStore(dir, async () => ({ records: [record] }), async () => plan);
await store.mutate({ action: "add-candidates", expectedRevision: "empty", candidates });
let posts = 0, failingPost = false, unavailable = false, empty = false, oldWorker = false;
const errors = [], external = [], original = JSON.stringify({ record, plan });
const api = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key"); res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.end();
  if (req.url === "/groceries/purchase-resolution") {
    if (unavailable) { res.writeHead(503); return res.end("{}"); }
    if (req.method === "POST") { posts++; if (failingPost) { res.writeHead(409); return res.end(JSON.stringify({ error: "Synthetic revision conflict. No decision saved." })); }
      try { const chunks=[]; for await (const part of req) chunks.push(part); const result=await store.mutate(JSON.parse(Buffer.concat(chunks).toString())); return res.end(JSON.stringify(result)); }
      catch(e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
    }
    return res.end(JSON.stringify(await store.read()));
  }
  res.end(JSON.stringify(req.url === "/health" ? { capabilities: oldWorker ? [] : ["grocery-purchase-resolution-v1"] } : req.url === "/groceries" ? { records: empty ? [] : [record] } : req.url === "/groceries/planning" ? plan : {}));
});
const root = resolve("apps/web/dist"), output = resolve("output/playwright/purchase-resolution");
const site = createServer(async (req, res) => {
  const path = new URL(req.url,"http://localhost").pathname.replace(/^\/familyhub/,""), file = resolve(root,"."+(path.endsWith("/")?path+"index.html":path));
  if (relative(root,file).startsWith("..")) { res.writeHead(403); return res.end(); }
  try { res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"})[extname(file)]||"application/octet-stream"); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  api.listen(0,"127.0.0.1"); site.listen(0,"127.0.0.1"); await Promise.all([once(api,"listening"),once(site,"listening")]); await mkdir(output,{recursive:true});
  browser = await chromium.launch({headless:true, channel:process.env.FAMILYHUB_TEST_BROWSER_CHANNEL||undefined});
  for (const width of [320,390,1280]) {
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block",reducedMotion:"reduce"});
    await context.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():(external.push(route.request().url()),route.abort()));
    await context.addInitScript(endpoint=>localStorage.setItem("familyhub.worker.v1",JSON.stringify({Endpoint:endpoint,ApiKey:"synthetic"})),"http://127.0.0.1:"+api.address().port);
    const page=await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror",e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:"+site.address().port+"/familyhub/?view=groceries&tab=tickets");
    const card=page.locator(".grocery-purchase-card"); await card.getByText(/0\/5 articles/).first().waitFor();
    await card.getByRole("button",{name:/Voir les produits/}).click();
    const dialog=page.getByRole("dialog",{name:/^Achat du/}), line=dialog.locator(".grocery-purchase-line").first();
    await dialog.waitFor(); await line.getByText("Format d'achat inconnu",{exact:true}).waitFor();
    await line.getByText("Compléter cette ligne",{exact:true}).click();
    await line.getByText("Correspondance candidate — à confirmer",{exact:true}).waitFor();
    assert.equal(await line.getByRole("link",{name:"Examiner la fiche source"}).getAttribute("href"),"https://example.com/synthetic-candidate-0");
    const button=line.getByRole("button",{name:"Confirmer ce produit et ce format",exact:true}), checkbox=line.getByRole("checkbox");
    assert.equal(await button.isEnabled(),false); const before=posts;
    await checkbox.check(); await page.screenshot({path:join(output,"candidate-"+width+".png"),animations:"disabled"});
    await line.getByRole("button",{name:"Annuler",exact:true}).click(); assert.equal(posts,before); assert.equal((await store.read()).decisions["candidate-0"]?.state==="confirmed",false);
    await line.getByText("Compléter cette ligne",{exact:true}).click(); assert.equal(await checkbox.isChecked?.()??await checkbox.evaluate(e=>e.checked),false);
    await checkbox.check(); await button.click(); await dialog.getByText(/Produit et format confirmés pour cette ligne/).waitFor();
    await dialog.locator(".grocery-purchase-detail > .grocery-purchase-totals").getByText(/1\/5 articles.*sous-total partiel 6,00 CAD/).waitFor();
    assert.equal(posts,before+1); assert.match(await line.innerText(),/Format dérivé confirmé/); assert.equal(JSON.stringify({record,plan}),original);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||[...document.querySelectorAll("dialog[open] .sheet-content")].some(e=>e.scrollWidth>e.clientWidth+1)),false);
    await page.screenshot({path:join(output,"confirmed-"+width+".png"),animations:"disabled"});
    await line.getByRole("button",{name:"Retirer cette confirmation",exact:true}).click(); await dialog.getByText(/Confirmation retirée/).waitFor();
    assert.equal((await store.read()).decisions["candidate-0"].state,"unconfirmed"); assert.equal(posts,before+2);
    failingPost=true; await checkbox.check(); await button.click(); await line.getByText(/Synthetic revision conflict/).waitFor();
    assert.equal((await store.read()).decisions["candidate-0"].state,"unconfirmed"); failingPost=false;
    await page.screenshot({path:join(output,"error-"+width+".png"),animations:"disabled"});
    await line.getByRole("button",{name:"Réessayer la lecture des confirmations",exact:true}).click(); await checkbox.waitFor({state:"visible"}); await page.waitForFunction(()=>!document.querySelector(".grocery-resolution fieldset")?.disabled);
    const ambiguous=dialog.locator(".grocery-purchase-line").nth(3); await ambiguous.getByText("Compléter cette ligne",{exact:true}).click(); await ambiguous.getByText(/Format insuffisant pour comparer/).waitFor(); assert.equal(await ambiguous.getByRole("button",{name:"Confirmer ce produit et ce format",exact:true}).count(),0);
    if(width===390) {
      unavailable=true; await page.reload(); await card.waitFor(); await card.getByRole("button",{name:/Voir les produits/}).click(); await dialog.getByText(/Candidats et confirmations non vérifiables/).waitFor(); unavailable=false;
      oldWorker=true; await page.reload(); await page.getByText(/Mettez à jour le worker PC pour confirmer/).first().waitFor(); oldWorker=false;
      empty=true; await page.reload(); await page.getByText(/Aucun achat PC Express terminé/).waitFor(); empty=false;
    }
    await context.close(); console.log("PASS actionable 0/5, candidate/cancel/confirm/undo/conflict, unchanged raw data and layout at "+width);
  }
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.equal(JSON.stringify({record,plan}),original);
  await writeFile(join(output,"verification.json"),JSON.stringify({synthetic:true,widths:[320,390,1280],posts,rawAndPricesUnchanged:true,errors,external},null,2));
} finally { await browser?.close(); await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>site.close(r))]); await rm(dir,{recursive:true,force:true}); }
