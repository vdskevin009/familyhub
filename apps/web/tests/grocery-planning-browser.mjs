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
import { retailerTemplate } from "../../worker/dist/grocery-weekly.js";
const dir = await mkdtemp(join(tmpdir(), "fh-grocery-planning-ui-")), store = new GroceryPlanningStore(join(dir, "groceries"));
const root = resolve("apps/web/dist"), errors = [], key = "synthetic-plan-key";
let browser, offline = false, failSave = false, researchBody, weeklySupported = true, malformedRead = false;
const api = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); if (req.method === "OPTIONS") { res.end(); return; }
  if (offline) { req.socket.destroy(); return; } res.setHeader("Content-Type", "application/json"); if (req.headers["x-familyhub-key"] !== key) { res.writeHead(401); res.end("{}"); return; }
  try { const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    let result;
    if (req.url === "/health") result = { capabilities: ["grocery-planning-v1", "grocery-receipts-v1", ...(weeklySupported ? ["grocery-weekly-v1"] : [])] };
    else if (req.url === "/groceries/planning") { if (body && failSave) { failSave = false; throw new Error("Échec synthétique de sauvegarde ; brouillon conservé."); } result = body ? await store.save(body) : malformedRead ? { state: "idle" } : await store.read(); }
    else if (req.url === "/groceries/research") { researchBody = body; result = { summary: "Synthetic catalogue only", prices: [] }; }
    else if (req.url === "/groceries") result = { records: [] };
    else throw new Error("Unknown synthetic route"); res.end(JSON.stringify(result));
  } catch (e) { res.writeHead(409); res.end(JSON.stringify({ error: e.message })); }
});
const site = createServer(async (req, res) => { const pathname = new URL(req.url, "http://localhost").pathname.replace(/^\/familyhub/, ""), file = resolve(root, "." + (pathname || "/index.html")); if (relative(root, file).startsWith("..")) { res.writeHead(403); res.end(); return; } try { const target = pathname.endsWith("/") ? join(file, "index.html") : file; res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(target)] || "application/octet-stream"); res.end(await readFile(target)); } catch { res.writeHead(404); res.end(); } });
async function planning(page, base) { await page.goto(base); await page.getByRole("button", { name: "Besoins", exact: true }).click(); await page.getByRole("button", { name: "Ajouter un produit", exact: true }).waitFor(); }
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
  await product.getByLabel("Quantité habituelle").fill("2"); await product.getByLabel("Taille d'un format souhaité").fill("500"); await product.getByLabel("Unité", { exact: true }).selectOption("g"); await product.getByLabel("Marque / préférences").fill("Synthetic exact brand"); await product.getByRole("button", { name: "Conserver dans la liste" }).click(); await product.waitFor({ state: "hidden" });
  await page.getByText("Info et filtres", { exact: true }).click(); await page.getByLabel("Ville ou préfixe postal de domicile").fill("Montréal"); await page.getByLabel(/J'ai confirmé la zone réelle/).check();
  failSave = true; await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Échec synthétique/).waitFor();
  await page.reload(); await page.getByRole("button", { name: "Besoins", exact: true }).click(); await page.getByRole("button", { name: /Synthetic oats.*2 x 500 g/ }).waitFor(); await page.getByText("Info et filtres", { exact: true }).click(); assert.equal(await page.getByLabel("Ville ou préfixe postal de domicile").inputValue(), "Montréal");
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Liste et prix conservés sur le PC/).waitFor();
  await page.getByRole("button", { name: "Magasins et prix", exact: true }).click(); await page.getByRole("button", { name: "Ajouter un magasin" }).click(); const retailer = page.getByRole("dialog", { name: "Magasin et conditions" }); await retailer.waitFor(); await retailer.getByLabel("Magasin", { exact: true }).fill("Synthetic market");
  await retailer.getByRole("button", { name: "Conserver le magasin" }).click(); await retailer.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Ajouter un prix", exact: true }).click(); const offer = page.getByRole("dialog", { name: "Revoir un prix" }); await offer.waitFor(); assert.equal(await offer.getByLabel("Prix du format (avant taxes séparées)").inputValue(), "");
  await offer.getByLabel("Produit exact / marque / variante").fill("Synthetic exact oats"); await offer.getByLabel("Prix du format (avant taxes séparées)").fill("3"); await offer.getByLabel("Taille du format proposé").fill("500"); await offer.getByLabel("Unité", { exact: true }).selectOption("g"); await offer.getByLabel("Source / conditions").fill("Synthetic observation"); const now = new Date().toISOString().slice(0, 10); await offer.getByLabel("Date observée").fill(now); await offer.getByLabel(/J'ai vérifié la source/).check();
  await offer.getByRole("button", { name: "Conserver le prix vérifié" }).click(); await offer.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Comparer", exact:true }).click(); await page.getByText(/Totaux complets non confirmés/).waitFor();
  const market = page.locator(".grocery-store-card").filter({ has: page.getByRole("heading", { name: "Synthetic market", exact: true }) });
  await market.getByText("Montant inconnu", { exact: true }).waitFor();
  await market.locator("summary").click(); await market.getByText(/minimum de commande inconnu/).waitFor();
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Liste et prix conservés sur le PC/).waitFor();
  // Supply fully sourced synthetic conditions to test rendering; production defaults remain unknown.
  const p = await store.read(); const until = new Date(Date.now() + 86400000).toISOString().slice(0, 10); Object.assign(p.retailers[0], { delivery: 1, service: 0, servicePercent: 0, feesTaxPercent: 0, minimum: 0, areaConfirmed: true, otherFeesReviewed: true, mode: "delivery", locality: "Synthetic city", slots: "yes", membershipStatus: "none", membershipWeekly: 0, evidence: { title: "Synthetic conditions", url: "https://example.com/terms", date: now, until } }); Object.assign(p.prices[0], { mode: "delivery", locality: "Synthetic city", localityConfirmed: true, depositPerPack: 0, taxPercent: 0, available: "yes", evidence: { title: "Synthetic catalogue", url: "https://example.com/oats", date: now, until } }); await store.save({ plan: p, expectedRevision: p.revision });
  await page.getByRole("button", { name: "Relire le PC" }).click(); await market.getByText("Panier complet estimé", { exact: true }).waitFor(); await market.getByText("7.00 CAD", {exact:true}).waitFor();
  await mkdir("artifacts/groceries", { recursive: true }); for (const width of [320, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.screenshot({ path: `artifacts/groceries/planning-${width}.png`, fullPage: true }); }
  await page.getByRole("button", { name: "Magasins et prix", exact: true }).click(); await page.getByText("Recherche publique", { exact: true }).click(); await page.getByLabel("Produit générique pour la recherche").fill("rolled oats"); await page.getByLabel(/J'ai vérifié le nom générique/).check(); await page.getByRole("button", { name: "Rechercher et revoir les sources" }).click(); await page.getByText("Synthetic catalogue only").waitFor(); assert.deepEqual(researchBody, { product: "rolled oats", area: "Montréal", confirmed: true });
  const second = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await second.addInitScript(({ endpoint, key }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: key })), { endpoint, key }); const pc = await second.newPage(); pc.on("pageerror", e => errors.push(e.message)); await planning(pc, base); await pc.getByRole("button", { name: /Synthetic oats.*2 x 500 g/ }).waitFor();
  // Two devices edit the same revision; only the first succeeds. The second draft survives refresh/reload.
  await page.getByRole("button", { name: "Ma liste", exact: true }).click(); await page.getByText("Info et filtres", { exact: true }).click(); await page.getByLabel("Pourboire optionnel par commande (0 = aucun)").fill("2"); await pc.getByText("Info et filtres", { exact: true }).click(); await pc.getByLabel("Pourboire optionnel par commande (0 = aucun)").fill("1"); await pc.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await pc.getByText(/Liste et prix conservés sur le PC/).waitFor();
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/La liste a changé sur le PC/).waitFor(); await page.getByRole("button", { name: "Relire le PC" }).click(); await page.getByRole("heading", { name: "Conflit entre appareils" }).waitFor(); assert.equal(await page.getByLabel("Pourboire optionnel par commande (0 = aucun)").inputValue(), "2");
  offline = true; await planning(page, base); await page.getByRole("button", { name: /Synthetic oats.*2 x 500 g/ }).waitFor(); await page.getByText("Info et filtres", {exact:true}).click(); assert.equal(await page.getByLabel("Pourboire optionnel par commande (0 = aucun)").inputValue(), "2"); assert.deepEqual(errors, []);
  offline = false;
  await page.getByRole("button", { name: "Relire le PC" }).click();
  await page.getByRole("heading", { name: "Conflit entre appareils" }).waitFor();
  await page.getByRole("button", { name: "Charger le PC, archiver mon brouillon" }).click();
  await page.getByText(/Version PC chargée/).waitFor();
  await page.getByRole("button", { name: /Synthetic oats.*2 x 500 g/ }).click();
  await product.getByText("Fréquence et budget", { exact: true }).click();
  await product.getByLabel("Fréquence du besoin").selectOption("week");
  await product.getByRole("button", { name: "Conserver dans la liste" }).click(); await product.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Ajouter un produit", exact: true }).click();
  await product.getByLabel("Produit", { exact: true }).fill("Synthetic monthly coffee");
  await product.getByLabel("Quantité habituelle").fill("3");
  await product.getByLabel("Type de quantité").selectOption("pack");
  await product.getByText("Fréquence et budget", { exact: true }).click();
  await product.getByLabel("Fréquence du besoin").selectOption("month");
  await product.getByRole("button", { name: "Conserver dans la liste" }).click(); await product.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Proposer les besoins de la semaine", exact: true }).click();
  await page.getByRole("button", {name:"Tous les besoins",exact:true}).click();
  assert.equal(await page.getByLabel("Inclure Synthetic monthly coffee dans ce panier", { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel("Inclure Synthetic oats dans ce panier", { exact: true }).isChecked(), true);
  await page.getByRole("button", { name: /Synthetic oats.*2 x 500 g/ }).click();
  await product.getByText("Quantité pour ce panier", { exact: true }).click();
  await product.getByLabel(/Nombre pour ce panier seulement/).fill("1");
  await product.getByRole("button", { name: "Conserver dans la liste" }).click(); await product.waitFor({ state: "hidden" });
  weeklySupported = false;
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Mettez à jour le worker/).waitFor();
  assert.equal((await store.read()).items.length, 1);
  weeklySupported = true;
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Liste et prix conservés sur le PC/).waitFor();
  const weekly = await store.read(); assert.equal(weekly.items[0].quantity, 2); assert.equal(weekly.items[0].basketQuantity, 1); assert.equal(weekly.items[1].quantity, 3); assert.equal(weekly.items[1].cadence, "month"); assert.equal(weekly.items[1].active, false);
  await page.reload(); await page.getByRole("button", {name:"Tous les besoins",exact:true}).click(); await page.getByRole("button", { name: /Synthetic monthly coffee.*3 format/ }).waitFor();
  assert.equal(await page.getByText("Info et filtres", { exact: true }).locator("..").getAttribute("open"), null);
  await page.getByRole("button", { name: /Synthetic monthly coffee.*3 format/ }).click();
  await product.getByLabel("Quantité habituelle").fill("99"); await product.getByRole("button", { name: "Close Produit habituel", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic monthly coffee.*3 format/ }).waitFor();
  await page.getByRole("button", { name: "Magasins et prix", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter les magasins proposés" }).click(); await page.getByRole("button", { name: "Ajouter les magasins proposés" }).click();
  await page.getByRole("button", { name: "Enregistrer sur le PC" }).click(); await page.getByText(/Liste et prix conservés sur le PC/).waitFor();
  const stores = (await store.read()).retailers; for (const name of ["Walmart", "Superstore", "Costco", "Fresh St. Market"]) assert.equal(stores.filter(r => r.name === name).length, 1);
  await page.getByRole("button", { name: "Besoins", exact: true }).click();
  await page.getByRole("button", { name: "Proposer les besoins de la semaine", exact: true }).waitFor();
  malformedRead = true; await page.getByRole("button", { name: "Relire le PC", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: /Synthetic oats.*1 x 500 g/ }).waitFor();
  malformedRead = false; await page.getByRole("button", { name: "Relire le PC", exact: true }).click();
  await page.getByText("Liste relue depuis le PC.", { exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.screenshot({ path: `artifacts/groceries/weekly-needs-${width}.png`, fullPage: true }); }
  await page.getByRole("button", { name: "Comparer", exact: true }).click();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.screenshot({ path: `artifacts/groceries/weekly-compare-${width}.png`, fullPage: true }); }
  // Representative compact catalogue: 52 fictional needs, 14 selected; observations are unapproved.
  const fixture = { ...emptyPlan(), revision: (await store.read()).revision, currency: "CAD", area: "Synthetic city", areaConfirmed: true };
  fixture.items = Array.from({ length: 52 }, (_, n) => ({ id: `fiction-${n}`, name: `Fictional article ${n + 1}`, quantity: n === 1 ? null : n === 2 ? 7 : 10.5, size: n === 2 ? null : 1, unit: n === 2 ? null : "each", preference: "", substitutions: true, active: n < 14, origin: "synthetic", cadence: n < 14 ? "week" : "unknown", measure: n === 2 ? "uses" : "physical", bucket: n === 2 ? "household" : "food" }));
  fixture.retailers = ["Fresh St. Market", "Walmart", "Costco", "Superstore"].map((name, n) => ({ ...retailerTemplate(`store-${n}`, name), mode: n === 2 ? "delivery" : "pickup", locality: "Synthetic city" }));
  fixture.prices = fixture.retailers.flatMap((r, index) => fixture.items.slice(0, index === 2 ? 11 : index === 1 ? 13 : 14).map((i, n) => ({ id: `price-${index}-${n}`, itemId: i.id, retailerId: r.id, product: `Synthetic reference ${n + 1}`, price: 2.5 + index, size: 6, unit: "each", weighed: false, taxPercent: null, depositPerPack: null, currency: "CAD", available: "unknown", substitution: true, approved: false, kind: "public", mode: r.mode, locality: "Synthetic city", localityConfirmed: false, evidence: { title: "Fictional dated catalogue", url: "https://example.com/synthetic", date: now, until: null } })));
  await store.save({ plan: fixture, expectedRevision: fixture.revision });
  await page.getByRole("button", { name: "Relire le PC", exact: true }).click();
  await page.getByText("14/14 articles avec un prix observé", { exact: true }).waitFor();
  assert.equal(await page.locator(".grocery-article-comparison").count(), 14);
  assert.equal(await page.locator(".grocery-store-card").count(), 4);
  const initialFixture = await store.read();
  assert.equal(await page.locator(".grocery-card-info[open]").count(), 0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const [name, count] of [["Fresh St.", 14], ["Walmart", 13], ["Costco", 11], ["Superstore", 14]]) {
      const card = page.locator(".grocery-store-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await card.getByText(new RegExp(`${count}/14 prix`)).waitFor();
      await card.getByText("Sous-total partiel observé", { exact: true }).waitFor();
      assert.ok(await card.locator("summary").evaluate(el => el.getBoundingClientRect().height) >= 44);
    }
    await page.screenshot({ path: `artifacts/groceries/compact-articles-${width}.png`, fullPage: true });
  }
  const firstInfo = page.locator("summary[aria-label='Info prix Fictional article 1']");
  const storeInfo = page.locator("summary[aria-label='Info Fresh St. Market']");
  await storeInfo.click();
  await storeInfo.locator("..").getByText(/Maison non chiffrable/).waitFor();
  assert.equal(await storeInfo.locator("..").getByText(/Maison 0\.00 CAD/).count(), 0);
  await storeInfo.click();
  await firstInfo.focus(); await firstInfo.press("Enter");
  await firstInfo.locator("..").getByText("Équivalent proportionnel du besoin : 4.375 CAD.", { exact: false }).waitFor();
  assert.equal(await firstInfo.locator("..").getAttribute("open"), "");
  await firstInfo.press("Space"); assert.equal(await firstInfo.locator("..").getAttribute("open"), null);
  assert.deepEqual(await store.read(), initialFixture);
  await page.reload(); await page.getByRole("button", { name: "Comparer", exact: true }).click();
  await page.getByText("14/14 articles avec un prix observé", { exact: true }).waitFor();
  assert.deepEqual(await store.read(), initialFixture);
  assert.equal(await page.getByText("Prix manquant", { exact: true }).count(), 4);
  console.log("PASS: compact article-first 52/14 fixture, four store coverage/mode/partial totals, missing dashes, 320/390/768/1440, 44px Info, Enter/Space, unchanged selection/quantities/approval and reload.");
  // Unit ranking fixture: package ordering differs from unit ordering; all observations stay unapproved.
  const unitFixture = await store.read();
  for (const [storeIndex, [price, size]] of [[6, 12], [9, 30], [10, 20], [4, 10]].entries()) Object.assign(unitFixture.prices.find(p => p.id === `price-${storeIndex}-0`), { price, size });
  for (const storeIndex of [0, 1]) Object.assign(unitFixture.prices.find(p => p.id === `price-${storeIndex}-1`), { price: storeIndex ? 6 : 4, size: storeIndex ? 1 : 500, unit: storeIndex ? "kg" : "g" });
  Object.assign(unitFixture.prices.find(p => p.id === "price-2-1"), { price: 5, size: 1, unit: "l" });
  Object.assign(unitFixture.prices.find(p => p.id === "price-3-1"), { matchNote: "Format non confirmé" });
  for (const [storeIndex, [price, size, uses]] of [[10, 1, 25], [20, 2, 100]].entries()) Object.assign(unitFixture.prices.find(p => p.id === `price-${storeIndex}-2`), { price, size, unit: "l", usesPerPack: uses });
  for (const storeIndex of [0, 1]) Object.assign(unitFixture.prices.find(p => p.id === `price-${storeIndex}-3`), { price: storeIndex ? 6 : 3, size: storeIndex ? 24 : 12 });
  Object.assign(unitFixture.prices.find(p => p.id === "price-0-4"), { price: 0 });
  await store.save({ plan: unitFixture, expectedRevision: unitFixture.revision });
  await page.getByRole("button", { name: "Relire le PC", exact: true }).click();
  const firstArticle = page.locator(".grocery-article-comparison").filter({ has: page.getByRole("heading", { name: "Fictional article 1", exact: true }) });
  await firstArticle.getByText("+33,3 %", { exact: true }).waitFor();
  const preservedUnitFixture = await store.read();
  const ratio = (foreground, background) => {
    const luminance = color => { const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]; };
    const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  };
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.deepEqual(await firstArticle.locator(".grocery-price-row > strong").allTextContents(), ["Walmart", "Superstore", "Fresh St. Market", "Costco"]);
    await firstArticle.getByText("9.00 CAD", { exact: true }).waitFor(); // Not the cheapest pack.
    await firstArticle.getByText("Plus bas observé · 0 %", { exact: true }).waitFor();
    const massArticle = page.locator(".grocery-article-comparison").filter({ has: page.getByRole("heading", { name: "Fictional article 2", exact: true }) });
    assert.equal((await massArticle.locator(".grocery-price-row > strong").allTextContents())[0], "Walmart");
    const volumeRow = massArticle.locator(".grocery-price-row").filter({ has: page.getByText("Costco", { exact: true }) });
    await volumeRow.getByText("Non comparable", { exact: true }).waitFor();
    const zeroArticle = page.locator(".grocery-article-comparison").filter({ has: page.getByRole("heading", { name: "Fictional article 5", exact: true }) });
    await zeroArticle.getByText("Prix nul observé", { exact: true }).waitFor();
    assert.equal(await zeroArticle.getByText("Plus bas observé · 0 %", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const cls of ["minimum", "higher", "neutral"]) {
      const colors = await page.locator(`.grocery-unit-gap-${cls}`).first().evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
      assert.ok(ratio(colors.foreground, colors.background) >= 4.5, `Unit badge contrast ${cls}`);
    }
    await firstArticle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/groceries/unit-ranking-${width}.png` });
  }
  await firstInfo.focus(); await firstInfo.press("Enter");
  await firstInfo.locator("..").getByText(/Écart = \(prix unitaire/).waitFor();
  await firstInfo.press("Space");
  assert.deepEqual(await store.read(), preservedUnitFixture);
  await page.reload(); await page.getByRole("button", { name: "Comparer", exact: true }).click();
  await firstArticle.getByText("+33,3 %", { exact: true }).waitFor(); assert.deepEqual(await store.read(), preservedUnitFixture);
  console.log("PASS: unit-ranked article rows preserve pack prices/modes/quality; percentage, mixed units, zero minimum, contrast≥4.5, keyboard/reload/no mutation at320/390/768/1440.");
  assert.deepEqual(errors, []);
  console.log("PASS: explicit Plan copy/dedup/preservation, editable quantity/format/preferences, blank prices, save failure/reload/retry, incomplete and sourced basket, 320/390/768/1280 layouts, minimal public query, shared persistence, stale conflict and offline draft. Weekly/monthly separation, current-basket override, cancel, old-worker capability gate, suggested retailers dedup and 1440px also pass. Zero page errors."); await second.close();
} finally { await browser?.close(); await Promise.all([new Promise(r => api.close(r)), new Promise(r => site.close(r))]); await rm(dir, { recursive: true, force: true }); }
