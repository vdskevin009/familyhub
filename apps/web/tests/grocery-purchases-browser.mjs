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
const today = new Date().toISOString().slice(0, 10);
const plan = { ...emptyPlan(), items: [{ id: "eggs", name: "Œufs démo", quantity: 1, size: 12, unit: "each", preference: "", substitutions: true, active: true, origin: "synthetic", countUnit: "œufs" }], retailers: [{ id: "store", name: "Costco", membershipStatus: "existing", mode: "store", locality: "Magasin démo", areaConfirmed: true, otherFeesReviewed: false, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, evidence: emptyEvidence() }], prices: [{ id: "price", itemId: "eggs", retailerId: "store", product: "Œufs comparables démo", substitution: true, approved: true, price: 6, size: 15, unit: "each", weighed: false, taxPercent: null, currency: "CAD", available: "yes", kind: "public", mode: "store", locality: "Magasin démo", localityConfirmed: true, matchNote: "Même qualité et type revus pour la démo", evidence: { title: "Source synthétique", url: "https://example.com/eggs", date: today, until: today } }] };
const record = { id: "demo", revision: "1", status: "saved", reviewedAt: today, extraction: "complete", createdAt: today, duplicateOf: null, sources: [], receipt: { ...emptyReceipt(), sourceType: "final-receipt", store: "Magasin du reçu démo", currency: "CAD", date: today, total: 5, items: [{ ...blankItem(), name: "Œufs démo", product: "Œufs du reçu démo", quantity: 1, size: 12, unit: "each", amount: 5, uncertain: false, evidence: "SOURCE 1 : Article rapproché : eggs. 12 œufs 5.00" }] } };
const confirmation = structuredClone(record); confirmation.id = "confirmation"; confirmation.receipt.sourceType = "confirmation"; confirmation.receipt.store = "Commande démo";
let fail = false, writes = 0, browser; const errors = [], external = [], original = JSON.stringify({ plan, record });
const api = createServer((req, res) => { res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key"); if (req.method === "OPTIONS") return res.end(); if (req.method !== "GET") writes++; res.setHeader("Content-Type", "application/json"); if (fail) { res.writeHead(503); return res.end('{}'); } res.end(JSON.stringify(req.url === "/mortgage" ? emptyMortgage() : req.url === "/groceries/planning" ? plan : req.url === "/groceries" ? { records: [record, confirmation] } : {})); });
const root = resolve("apps/web/dist"), directory = resolve("artifacts/achats");
const site = createServer(async (req, res) => { const path = new URL(req.url, "http://localhost").pathname.replace(/^\/familyhub/, ""), file = resolve(root, "." + (path || "/index.html")); if (relative(root, file).startsWith("..")) { res.writeHead(403); return res.end(); } try { const target = path.endsWith("/") ? join(file, "index.html") : file; res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(target)] || "application/octet-stream"); res.end(await readFile(target)); } catch { res.writeHead(404); res.end(); } });
try {
  api.listen(0, "127.0.0.1"); site.listen(0, "127.0.0.1"); await Promise.all([once(api, "listening"), once(site, "listening")]); await mkdir(directory, { recursive: true });
  const endpoint = `http://127.0.0.1:${api.address().port}`, base = `http://127.0.0.1:${site.address().port}/familyhub/?view=groceries`;
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const width of [320, 390, 768, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.route("**/*", route => { if (new URL(route.request().url()).hostname !== "127.0.0.1") { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    await context.addInitScript(({ endpoint }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: "synthetic" })), { endpoint });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on("pageerror", e => errors.push(e.message)); await page.goto(base); await page.getByRole("button", { name: "Achats", exact: true }).click();
    const open = page.getByRole("button", { name: /Ouvrir l'achat Magasin du reçu démo/ }); await open.waitFor();
    await page.locator(".grocery-purchase-card").first().getByText(/4,80 CAD/).waitFor();
    assert.equal(await page.locator(".grocery-purchase-card").count(), 2); assert.ok(await page.getByText(/Confirmation originale/).count());
    await page.screenshot({ path: join(directory, `overview-${width}.png`) });
    await open.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Achat chez Magasin du reçu démo", exact: true }); await dialog.waitFor();
    await dialog.getByText("Calculé", { exact: true }).waitFor(); await dialog.getByText(/Œufs comparables démo · 15 œufs/).waitFor();
    const details = dialog.getByText("Détails du prix et du calcul", { exact: true }); await details.focus(); await page.keyboard.press("Enter");
    await dialog.getByText(/6,00 CAD × 12\/15 = 4,80 CAD/).waitFor(); await dialog.getByText(/1 paquet\(s\) entier\(s\)/).waitFor();
    assert.ok(await dialog.getByText(/Total du panier indisponible/).count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll("dialog[open] .sheet-content")].some(el => el.scrollWidth > el.clientWidth + 1)), false);
    await page.screenshot({ path: join(directory, `detail-${width}.png`) });
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); assert.equal(await open.evaluate(el => document.activeElement === el), true);
    await open.click(); await dialog.waitFor(); await dialog.getByRole("button", { name: "Voir les sources et vérifier le ticket" }).click(); await page.getByRole("dialog", { name: "Vérifier le ticket", exact: true }).waitFor();
    await page.keyboard.press("Escape"); assert.equal(await open.evaluate(el => document.activeElement === el), true); await page.getByRole("button", { name: "Catalogue", exact: true }).click(); await page.getByRole("button", { name: "Achats", exact: true }).click(); await open.waitFor();
    // Both newly integrated areas remain reachable; returning retains receipt cards and data.
    await page.getByRole("button", {name:"Mortgage",exact:true}).locator("visible=true").first().click(); await page.locator(".mortgage").getByText(/Aucun historique enregistré/).waitFor();
    await page.getByRole("button", {name:"Courses",exact:true}).locator("visible=true").first().click(); await page.getByRole("button",{name:"Achats",exact:true}).click(); await open.waitFor();
    // Equal formats have no calculation badge. Repeat visits never mutate the shared plan.
    plan.prices[0].size = 12; await page.reload(); await page.getByRole("button", { name: "Achats", exact: true }).click(); await open.click(); await dialog.waitFor(); assert.equal(await dialog.getByText("Calculé", { exact: true }).count(), 0);
    plan.prices[0].size = 15; await page.reload(); await page.getByRole("button", { name: "Achats", exact: true }).click(); await page.locator(".grocery-purchase-card").first().getByText(/4,80 CAD/).waitFor();
    fail = true; await page.reload(); await page.getByRole("button", { name: "Achats", exact: true }).click(); await page.getByText(/Historique en cache/).waitFor(); await open.click(); await dialog.waitFor(); await dialog.getByText("Calculé", { exact: true }).waitFor(); fail = false;
    await context.close(); console.log(`PASS Achats cards, 15-egg pack, 12/15 calculation, payment status, missing coverage, keyboard/reopen/import/cache and no overflow at ${width}px`);
  }
  assert.equal(writes, 0); assert.equal(JSON.stringify({ plan, record }), original); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(join(directory, "verification.json"), JSON.stringify({ synthetic: true, widths: [320,390,768,1280], writes, errors, external }, null, 2));
} finally { await browser?.close(); await Promise.all([new Promise(r => api.close(r)), new Promise(r => site.close(r))]); }
