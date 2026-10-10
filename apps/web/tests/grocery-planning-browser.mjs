/** Fresh profiles, temporary store, synthetic catalogue. No installed data or external calls. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, extname } from "node:path";
import { once } from "node:events";
import { GroceryPlanningStore } from "../../worker/dist/grocery-planning-store.js";
import { emptyPlan } from "../../worker/dist/grocery-planning.js";
const dir = await mkdtemp(join(tmpdir(), "fh-grocery-planning-ui-")), store = new GroceryPlanningStore(join(dir, "groceries"));
const root = resolve("apps/web/dist"), errors = [], key = "synthetic-plan-key";
let browser, offline = false, failSave = false, researchBody;
const api = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); if (req.method === "OPTIONS") { res.end(); return; }
  if (offline) { req.socket.destroy(); return; } res.setHeader("Content-Type", "application/json"); if (req.headers["x-familyhub-key"] !== key) { res.writeHead(401); res.end("{}"); return; }
  try { const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    let result;
    if (req.url === "/health") result = { capabilities: ["grocery-planning-v1", "grocery-receipts-v1"] };
    else if (req.url === "/groceries/planning") { if (body && failSave) { failSave = false; throw new Error("Échec synthétique de sauvegarde ; brouillon conservé."); } result = body ? await store.save(body) : await store.read(); }
    else if (req.url === "/groceries/research") { researchBody = body; result = { summary: "Synthetic catalogue only", prices: [] }; }
    else if (req.url === "/groceries") result = { records: [] };
    else throw new Error("Unknown synthetic route"); res.end(JSON.stringify(result));
  } catch (e) { res.writeHead(409); res.end(JSON.stringify({ error: e.message })); }
});
const site = createServer(async (req, res) => { const pathname = new URL(req.url, "http://localhost").pathname.replace(/^\/familyhub/, ""), file = resolve(root, "." + (pathname || "/index.html")); if (relative(root, file).startsWith("..")) { res.writeHead(403); res.end(); return; } try { const target = pathname.endsWith("/") ? join(file, "index.html") : file; res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(target)] || "application/octet-stream"); res.end(await readFile(target)); } catch { res.writeHead(404); res.end(); } });
async function planning(page, base) { await page.goto(base); await page.getByRole("button", { name: "Liste et paniers", exact: true }).click(); await page.getByRole("button", { name: "Ajouter un produit", exact: true }).waitFor(); }
try {
  api.listen(0, "127.0.0.1"); site.listen(0, "127.0.0.1"); await Promise.all([once(api, "listening"), once(site, "listening")]);
  const endpoint = `http://127.0.0.1:${api.address().port}`, base = `http://127.0.0.1:${site.address().port}/familyhub/?view=groceries`;
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined }); const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const original = { SchemaVersion: 1, Recipes: [], Meals: [], GroceryItems: [{ Id: "synthetic-plan-id", Name: "Synthetic oats", Quantity: "2 packs, format unknown", Checked: false, Source: "manual" }] };
  await context.addInitScript(({ endpoint, key, original }) => { if (!localStorage.getItem("familyhub.worker.v1")) localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: key })); if (!localStorage.getItem("familyhub.planner.v1")) localStorage.setItem("familyhub.planner.v1", JSON.stringify(original)); }, { endpoint, key, original });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message)); await planning(page, base);
  await page.getByRole("button", { name: "Copier les produits non cochés de Plan" }).click(); await page.getByText(/Produits non cochés de Plan copiés/).waitFor();
  await page.getByRole("button", { name: "Copier les produits non cochés de Plan" }).click(); assert.equal(await page.getByRole("button", { name: /Synthetic oats.*Quantité à préciser/ }).count(), 1);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("familyhub.planner.v1"))), original);
  await page.getByRole("button", { name: /Synthetic oats.*Quantité à préciser/ }).click(); const product = page.getByRole("dialog", { name: "Produit habituel" }); await product.waitFor();
  await product.getByLabel("Nombre de formats souhaités").fill("2"); await product.getByLabel("Taille d'un format souhaité").fill("500"); await product.getByLabel("Unité", { exact: true }).selectOption("g"); await product.getByLabel("Marque / préférences").fill("Synthetic exact brand"); await product.getByRole("button", { name: "Conserver dans la liste" }).click(); await product.waitFor({ state: "hidden" });
  await page.getByLabel("Ville ou préfixe postal de domicile").fill("Montréal"); await page.getByLabel(/J'ai confirmé la zone réelle/).check();
  failSave = true; await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Échec synthétique/).waitFor();
  await page.reload(); await page.getByRole("button", { name: "Liste et paniers" }).click(); await page.getByRole("button", { name: /Synthetic oats.*2 × 500 g/ }).waitFor(); assert.equal(await page.getByLabel("Ville ou préfixe postal de domicile").inputValue(), "Montréal");
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Liste et prix conservés sur le PC/).waitFor();
  await page.getByRole("button", { name: "Magasins et prix", exact: true }).click(); await page.getByRole("button", { name: "Ajouter un magasin" }).click(); const retailer = page.getByRole("dialog", { name: "Magasin et conditions" }); await retailer.waitFor(); await retailer.getByLabel("Magasin", { exact: true }).fill("Synthetic market");
  await retailer.getByRole("button", { name: "Conserver le magasin" }).click(); await retailer.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Ajouter un prix", exact: true }).click(); const offer = page.getByRole("dialog", { name: "Revoir un prix" }); await offer.waitFor(); assert.equal(await offer.getByLabel("Prix du format (avant taxes séparées)").inputValue(), "");
  await offer.getByLabel("Produit exact / marque / variante").fill("Synthetic exact oats"); await offer.getByLabel("Prix du format (avant taxes séparées)").fill("3"); await offer.getByLabel("Taille du format proposé").fill("500"); await offer.getByLabel("Unité", { exact: true }).selectOption("g"); await offer.getByLabel("Source / conditions").fill("Synthetic observation"); const now = new Date().toISOString().slice(0, 10); await offer.getByLabel("Date observée").fill(now); await offer.getByLabel(/J'ai vérifié la source/).check();
  await offer.getByRole("button", { name: "Conserver le prix vérifié" }).click(); await offer.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Comparer les paniers" }).click(); await page.getByText(/Aucun panier complet avec tous les prix/).waitFor(); await page.getByText("Total incomplet", { exact: true }).waitFor(); await page.getByText(/minimum de commande inconnu/).waitFor();
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Liste et prix conservés sur le PC/).waitFor();
  // Supply fully sourced synthetic conditions to test rendering; production defaults remain unknown.
  const p = await store.read(); const until = new Date(Date.now() + 86400000).toISOString().slice(0, 10); Object.assign(p.retailers[0], { delivery: 1, service: 0, servicePercent: 0, feesTaxPercent: 0, minimum: 0, areaConfirmed: true, otherFeesReviewed: true, evidence: { title: "Synthetic conditions", url: "https://example.com/terms", date: now, until } }); Object.assign(p.prices[0], { taxPercent: 0, available: "yes", evidence: { title: "Synthetic catalogue", url: "https://example.com/oats", date: now, until } }); await store.save({ plan: p, expectedRevision: p.revision });
  await page.getByRole("button", { name: "Relire le PC" }).click(); await page.getByText(/Synthetic market — 7.00 CAD/).waitFor();
  await mkdir("artifacts/groceries", { recursive: true }); for (const width of [320, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.screenshot({ path: `artifacts/groceries/planning-${width}.png`, fullPage: true }); }
  await page.getByRole("button", { name: "Magasins et prix", exact: true }).click(); await page.getByLabel("Produit générique pour la recherche").fill("rolled oats"); await page.getByLabel(/J'ai vérifié le nom générique/).check(); await page.getByRole("button", { name: "Rechercher et revoir les sources" }).click(); await page.getByText("Synthetic catalogue only").waitFor(); assert.deepEqual(researchBody, { product: "rolled oats", area: "Montréal", confirmed: true });
  const second = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await second.addInitScript(({ endpoint, key }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: key })), { endpoint, key }); const pc = await second.newPage(); pc.on("pageerror", e => errors.push(e.message)); await planning(pc, base); await pc.getByRole("button", { name: /Synthetic oats.*2 × 500 g/ }).waitFor();
  // Two devices edit the same revision; only the first succeeds. The second draft survives refresh/reload.
  await page.getByRole("button", { name: "Ma liste", exact: true }).click(); await page.getByLabel("Pourboire optionnel par commande (0 = aucun)").fill("2"); await pc.getByLabel("Pourboire optionnel par commande (0 = aucun)").fill("1"); await pc.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await pc.getByText(/Liste et prix conservés sur le PC/).waitFor();
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/La liste a changé sur le PC/).waitFor(); await page.getByRole("button", { name: "Relire le PC" }).click(); await page.getByRole("heading", { name: "Conflit entre appareils" }).waitFor(); assert.equal(await page.getByLabel("Pourboire optionnel par commande (0 = aucun)").inputValue(), "2");
  offline = true; await planning(page, base); await page.getByRole("button", { name: /Synthetic oats.*2 × 500 g/ }).waitFor(); assert.equal(await page.getByLabel("Pourboire optionnel par commande (0 = aucun)").inputValue(), "2"); assert.deepEqual(errors, []);
  console.log("PASS: explicit Plan copy/dedup/preservation, editable quantity/format/preferences, blank prices, save failure/reload/retry, incomplete and sourced basket, 320/390/768/1280 layouts, minimal public query, shared persistence, stale conflict and offline draft. Zero page errors."); await second.close();
} finally { await browser?.close(); await Promise.all([new Promise(r => api.close(r)), new Promise(r => site.close(r))]); await rm(dir, { recursive: true, force: true }); }
