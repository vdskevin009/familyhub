/** Isolated servers, synthetic receipts and fresh profiles; never the installed worker. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative, extname } from "node:path";
import { once } from "node:events";
import { emptyPlan, emptyEvidence } from "../../worker/dist/grocery-planning.js";
import { emptyMortgage } from "../../worker/dist/mortgage-model.js";
import { emptyReceipt, blankItem } from "../../worker/dist/grocery-model.js";
// Rendering may finish before a queued IndexedDB write commits. Prove the fixture
// version is durable before reloading or introducing the synthetic PC outage.
async function waitForCachedReferenceSize(page, endpoint, size) {
  await page.waitForFunction(({ key, size }) => new Promise(resolve => {
    const open = indexedDB.open("familyhub.groceries.v1");
    open.onupgradeneeded = () => open.transaction.abort(); // A test read must not create or migrate the cache.
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("cache")) { db.close(); resolve(false); return; }
      const tx = db.transaction("cache", "readonly");
      const reference = tx.objectStore("cache").get(key);
      tx.oncomplete = () => { db.close(); resolve(reference.result?.prices?.find(price => price.id === "price")?.size === size); };
      tx.onabort = tx.onerror = () => { db.close(); resolve(false); };
    };
  }), { key: endpoint + ":purchase-comparison", size });
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plan = { ...emptyPlan(), items: [{ id: "eggs", name: "Œufs démo", quantity: 1, size: 12, unit: "each", preference: "", substitutions: true, active: true, origin: "synthetic", countUnit: "œufs" }], retailers: [{ id: "store", name: "Costco", membershipStatus: "existing", mode: "store", locality: "Magasin démo", areaConfirmed: true, otherFeesReviewed: false, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, evidence: emptyEvidence() }], prices: [{ id: "price", itemId: "eggs", retailerId: "store", product: "Œufs comparables démo", substitution: true, approved: true, price: 6, size: 15, unit: "each", weighed: false, taxPercent: null, currency: "CAD", available: "yes", kind: "public", mode: "store", locality: "Magasin démo", localityConfirmed: true, matchNote: "Même qualité et type revus pour la démo", evidence: { title: "Source synthétique", url: "https://example.com/eggs", date: today, until: today } }] };
const record = { id: "demo", revision: "1", status: "saved", reviewedAt: today, extraction: "complete", createdAt: today, duplicateOf: null, sources: [], receipt: { ...emptyReceipt(), sourceType: "final-receipt", store: "PC Express démo", currency: "CAD", date: today, total: 5, items: [{ ...blankItem(), name: "Œufs démo", product: "Œufs du reçu démo", quantity: 1, size: 12, unit: "each", amount: 5, uncertain: false, evidence: "SOURCE 1 : Article rapproché : eggs. 12 œufs 5.00" }] } };
const confirmation = structuredClone(record); confirmation.id = "confirmation"; confirmation.receipt.sourceType = "confirmation"; confirmation.receipt.store = "PC Express confirmation démo"; confirmation.receipt.fulfillment = {date:today,evidence:"Synthetic same-order delivered source"}; const legacy=structuredClone(record); legacy.id="legacy"; legacy.receipt.store="Archived synthetic store"; legacy.receipt.date="2020-01-01"; const undelivered=structuredClone(confirmation); undelivered.id="unfulfilled"; delete undelivered.receipt.fulfillment;
let fail = false, writes = 0, browser; const errors = [], external = [], original = JSON.stringify({ plan, record });
const api = createServer((req, res) => { res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key"); if (req.method === "OPTIONS") return res.end(); if (req.method !== "GET") writes++; res.setHeader("Content-Type", "application/json"); if (fail) { res.writeHead(503); return res.end('{}'); } res.end(JSON.stringify(req.url === "/mortgage" ? emptyMortgage() : req.url === "/groceries/planning" ? plan : req.url === "/groceries" ? { records: [record, confirmation, legacy, undelivered] } : {})); });
const root = resolve("apps/web/dist"), directory = resolve("artifacts/achats");
const site = createServer(async (req, res) => { const path = new URL(req.url, "http://localhost").pathname.replace(/^\/familyhub/, ""), file = resolve(root, "." + (path || "/index.html")); if (relative(root, file).startsWith("..")) { res.writeHead(403); return res.end(); } try { const target = path.endsWith("/") ? join(file, "index.html") : file; res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(target)] || "application/octet-stream"); res.end(await readFile(target)); } catch { res.writeHead(404); res.end(); } });
try {
  api.listen(0, "127.0.0.1"); site.listen(0, "127.0.0.1"); await Promise.all([once(api, "listening"), once(site, "listening")]); await mkdir(directory, { recursive: true });
  const endpoint = `http://127.0.0.1:${api.address().port}`, base = `http://127.0.0.1:${site.address().port}/familyhub/?view=groceries`;
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const width of [320, 390, 768, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", locale: "fr-CA", serviceWorkers: "block" });
    await context.route("**/*", route => { if (new URL(route.request().url()).hostname !== "127.0.0.1") { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    await context.addInitScript(({ endpoint }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: "synthetic" })), { endpoint });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on("pageerror", e => errors.push(e.message)); await page.goto(base); await page.getByRole("button", { name: "Purchases", exact: true }).click();
    const open = page.getByRole("button", { name: /Open purchase from PC Express démo/ }); await open.waitFor();
    await page.locator(".grocery-purchase-card").first().getByText(/4\.80 CAD/).waitFor();
    assert.equal(await page.locator(".grocery-purchases > .grocery-purchase-cards > .grocery-purchase-card").count(), 2); assert.equal(await page.locator(".grocery-purchase-card:visible").getByText("Estimated total",{exact:true}).count(),1); assert.equal(await page.locator(".grocery-purchase-card:visible").filter({hasText:/Delivered|final payment unknown/}).count(),0); assert.equal(await page.getByRole("button",{name:/Open.*Archived synthetic/}).isVisible(),false); await page.getByText("Archive and other receipts",{exact:false}).first().click(); await page.getByRole("button",{name:/Open.*Archived synthetic/}).waitFor(); await page.getByText("Archive and other receipts",{exact:false}).first().click();
    await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(directory, `overview-${width}.png`) });
    await open.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /^Purchase on/ }); await dialog.waitFor();
    await dialog.getByText("Calculated", { exact: true }).waitFor(); await dialog.getByText("15 œufs",{exact:true}).waitFor();
    const details = dialog.getByText("Pack sizes, calculations and sources", { exact: true }); await details.focus(); await page.keyboard.press("Enter");
    await dialog.getByText(/6\.00 CAD × 12\/15 = 4\.80 CAD/).waitFor(); await dialog.getByText(/1 whole pack\(s\)/).waitFor();
    assert.ok(await dialog.getByText(/Product family unknown and no reference has the same name/).count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll("dialog[open] .sheet-content")].some(el => el.scrollWidth > el.clientWidth + 1)), false);
    await page.screenshot({ path: join(directory, `detail-${width}.png`) });
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); await page.waitForFunction(el => document.activeElement === el, await open.elementHandle()); assert.equal(await open.evaluate(el => document.activeElement === el), true);
    await open.click(); await dialog.waitFor(); await dialog.getByText("Purchase evidence and limitations",{exact:true}).click(); await dialog.getByRole("button", { name: "View sources and review receipt" }).click(); await page.getByRole("dialog", { name: "Review receipt", exact: true }).waitFor();
    await page.keyboard.press("Escape"); await page.waitForFunction(el => document.activeElement === el, await open.elementHandle()); assert.equal(await open.evaluate(el => document.activeElement === el), true); assert.equal(await page.getByRole("button", { name: "Catalogue", exact: true }).count(), 0); assert.equal(await page.getByRole("button", { name: "Moins cher ailleurs", exact: true }).count(), 0); await open.click(); await dialog.waitFor(); await page.goBack(); await dialog.waitFor({ state: "hidden" }); await page.waitForFunction(el => document.activeElement === el, await open.elementHandle()); assert.equal(await open.evaluate(el => document.activeElement === el), true); await open.waitFor();
    // Both newly integrated areas remain reachable; returning retains receipt cards and data.
    const nav = page.locator(".bottom-nav:visible, .app-rail nav:visible");
    await nav.getByRole("button", {name:"More",exact:true}).click(); await page.locator(".other-link").filter({hasText:"Mortgage"}).click(); await page.getByRole("region",{name:"Mortgage Assistant",exact:true}).getByRole("heading",{name:"Mortgage",exact:true}).waitFor(); await page.getByRole("tab",{name:"Offers and contacts",exact:true}).click(); await page.locator(".mortgage-compact").getByText(/No history saved/).waitFor();
    await nav.getByRole("button", {name:"Projects",exact:true}).click(); await page.locator(".project-tiles").getByRole("button", {name:"Groceries",exact:true}).click(); await page.getByRole("button",{name:"Purchases",exact:true}).click(); await open.waitFor();
    // Equal formats have no calculation badge. Repeat visits never mutate the shared plan.
    plan.prices[0].size = 12; await page.reload(); await page.getByRole("button", { name: "Purchases", exact: true }).click();
    await waitForCachedReferenceSize(page, endpoint, 12);
    await open.click(); await dialog.waitFor();
    await dialog.locator(".grocery-purchase-match").getByText("6.00 CAD", { exact: true }).waitFor();
    assert.equal(await dialog.getByText("Calculated", { exact: true }).count(), 0);
    plan.prices[0].size = 15; await page.reload(); await page.getByRole("button", { name: "Purchases", exact: true }).click();
    await page.locator(".grocery-purchase-card").first().getByText(/4\.80 CAD/).waitFor();
    await waitForCachedReferenceSize(page, endpoint, 15);
    fail = true; await page.reload(); await page.getByRole("button", { name: "Purchases", exact: true }).click(); await page.getByText(/This device shows cached history/).waitFor(); await open.click(); await dialog.waitFor(); await dialog.getByText("Calculated", { exact: true }).waitFor(); fail = false;
    await context.close(); console.log(`PASS Achats cards, 15-egg pack, 12/15 calculation, payment status, missing coverage, keyboard/reopen/import/cache and no overflow at ${width}px`);
  }
  assert.equal(writes, 0); assert.equal(JSON.stringify({ plan, record }), original); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(join(directory, "verification.json"), JSON.stringify({ synthetic: true, widths: [320,390,768,1280], writes, errors, external }, null, 2));
} finally { await browser?.close(); await Promise.all([new Promise(r => api.close(r)), new Promise(r => site.close(r))]); }
