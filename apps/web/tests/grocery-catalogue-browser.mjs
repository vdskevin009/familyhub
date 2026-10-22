/** Local servers and fresh browser profiles, synthetic data only. No installed worker or retailer access. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative, extname } from "node:path";
import { once } from "node:events";
import { emptyPlan } from "../../worker/dist/grocery-planning.js";
import { emptyReceipt } from "../../worker/dist/grocery-model.js";
const today = new Date().toISOString().slice(0, 10), capturedAt = new Date().toISOString();
const names = ["Café démo", "Flocons démo", "Savon démo avec une identité volontairement très longue pour vérifier les retours à la ligne et le format inconnu", "Produit ancien démo", "Lait démo", "Sans Superstore démo"];
const plan = { ...emptyPlan(), revision: "synthetic-revision", area: "Ville démo", areaConfirmed: true };
plan.items = names.map((name, n) => ({ id: "i" + n, name, quantity: null, size: null, unit: n === 4 ? "l" : "kg", preference: "", substitutions: n === 1, active: n === 2, origin: "synthetic", cadence: n === 1 ? "month" : "unknown", every: 1 }));
const evidence = { title: "Catalogue synthétique pour revue", url: "https://example.com/synthetic", date: today, until: null };
plan.retailers = ["Superstore", "Walmart", "Costco", "Fresh St. Market"].map((name, n) => ({ id: "r" + n, name, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, areaConfirmed: true, otherFeesReviewed: false, mode: "store", locality: plan.area, evidence }));
const price = (id, itemId, retailerId, amount, patch = {}) => ({ id, itemId, retailerId, product: names[Number(itemId.slice(1))], price: amount, size: 500, unit: "g", weighed: false, taxPercent: null, currency: "CAD", available: "yes", substitution: false, approved: true, kind: "public", evidence, mode: "store", locality: plan.area, localityConfirmed: true, ...patch });
plan.prices = [price("p0", "i0", "r0", 10), price("p1", "i0", "r1", 16, { size: 1000 }), price("p2", "i0", "r2", 5, { size: 250 }), price("p3", "i1", "r0", 4), price("p4", "i1", "r3", 3, { product: "Flocons variante démo", substitution: true, matchNote: "Équivalence de qualité revue pour le test" }), price("p5", "i3", "r0", 4, { evidence: { ...evidence, date: "2000-01-01" } }), price("p6", "i3", "r1", 2, { evidence: { ...evidence, date: "2000-01-01" } }), price("p7", "i4", "r0", 6, { size: 2000, unit: "ml" }), price("p8", "i4", "r1", 4, { size: 2, unit: "l", mode: "delivery" }), price("p9", "i5", "r1", 3)];
const records = [{ id: "synthetic-ticket", revision: "1", status: "saved", createdAt: capturedAt, sources: [], extraction: "complete", reviewedAt: capturedAt, duplicateOf: null, receipt: { ...emptyReceipt(), store: "Magasin démo", date: today, items: [{ name: names[0], product: "Café démo", amount: null, quantity: null, size: 500, unit: "g", evidence: "Article rapproché : i0.", uncertain: false }, { name: "Produit du ticket seulement", product: "Produit du ticket seulement", amount: null, quantity: null, size: null, unit: null, evidence: "Ligne relue", uncertain: false }] } }];
const snapshot = { schema: 1, source: "pcexpress", capturedAt, complete: true, items: [{ itemId: "i0", product: "Café démo", brand: "Marque démo", size: 500, unit: "g", quantity: 2 }, { itemId: "i1", product: "Flocons démo", brand: null, size: 500, unit: "g", quantity: 1 }, { itemId: null, product: "Produit du panier seulement", brand: "Marque démo", size: 1, unit: "each", quantity: 1 }] };
const original = structuredClone(plan), root = resolve("apps/web/dist"), evidenceDir = resolve("artifacts/groceries/catalogue");
let writes = 0, failReads = false, browser; const errors = [], external = [];
const api = createServer((req, res) => { res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key"); if (req.method === "OPTIONS") { res.end(); return; } if (req.method !== "GET") writes++; res.setHeader("Content-Type", "application/json"); if (failReads) { res.writeHead(503); res.end('{}'); return; } if (req.url === "/groceries/planning") res.end(JSON.stringify(plan)); else if (req.url === "/groceries") res.end(JSON.stringify({ records })); else { res.writeHead(404); res.end('{}'); } });
const site = createServer(async (req, res) => { const pathname = new URL(req.url, "http://localhost").pathname.replace(/^\/familyhub/, ""), file = resolve(root, "." + (pathname || "/index.html")); if (relative(root, file).startsWith("..")) { res.writeHead(403); res.end(); return; } try { const target = pathname.endsWith("/") ? join(file, "index.html") : file; res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(target)] || "application/octet-stream"); res.end(await readFile(target)); } catch { res.writeHead(404); res.end(); } });
async function importCart(page, cart) { await page.getByText("Sources et outils", { exact: true }).click(); await page.getByLabel("Importer le snapshot PCExpress privé").setInputFiles({ name: "synthetic-cart.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(cart)) }); await page.getByText("Sources et outils", { exact: true }).click(); }
async function noOverflow(page, width) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('dialog[open] .sheet-content')].some(el => el.scrollWidth > el.clientWidth + 1)), false, `No horizontal overflow at ${width}`); }
async function readableBadge(locator) {
  const ratio = await locator.evaluate(el => {
    const style = getComputedStyle(el);
    const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const a = luminance(style.color), b = luminance(style.backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  assert.ok(ratio >= 4.5, `Badge text contrast ${ratio}`);
}
try {
  api.listen(0, "127.0.0.1"); site.listen(0, "127.0.0.1"); await Promise.all([once(api, "listening"), once(site, "listening")]); await mkdir(evidenceDir, { recursive: true });
  const endpoint = `http://127.0.0.1:${api.address().port}`, base = `http://127.0.0.1:${site.address().port}/familyhub/?view=groceries`;
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  for (const width of [320, 360, 390, 412, 432, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.route("**/*", route => { if (new URL(route.request().url()).hostname !== "127.0.0.1") { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    await context.addInitScript(({ endpoint }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: "synthetic-key" })), { endpoint });
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message)); await page.goto(base); await page.getByText("7 produits", { exact: true }).waitFor();
    assert.equal(await page.locator(".grocery-price-rows").count(), 0); assert.equal(await page.getByRole("button", { name: "Proposer les besoins de la semaine" }).count(), 0);
    assert.equal(await page.locator(".grocery-catalogue-article").count(), 7);
    const cardStyle = await page.locator('.grocery-catalogue-article').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius }));
    assert.deepEqual(cardStyle, { background: 'rgb(255, 255, 255)', radius: '15px' });
    assert.equal(await page.locator('.grocery-catalogue-cards').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.grocery-catalogue-tools')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    const toggle = page.getByRole('switch', { name: 'Comparaisons', exact: true });
    assert.ok((await toggle.boundingBox()).height >= 44);
    await toggle.focus(); await page.keyboard.press('Space'); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Space'); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.getByRole('radio', { name: 'Tous les produits', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('radio', { name: 'Panier actuel', exact: true }).isChecked(), true);
    await page.keyboard.press('ArrowLeft'); assert.equal(await page.getByRole('radio', { name: 'Tous les produits', exact: true }).isChecked(), true);
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('.grocery-catalogue-article').count(), 7);
    await page.screenshot({ path: join(evidenceDir, `catalogue-${width}.png`), fullPage: true }); await page.screenshot({ path: join(evidenceDir, `catalogue-viewport-${width}.png`) });
    await page.getByRole("radio", { name: "Panier actuel", exact: true }).locator("..").click(); await page.getByText(/Panier PCExpress indisponible/).waitFor(); assert.equal(await page.locator(".grocery-catalogue-article").count(), 0);
    await importCart(page, snapshot); await page.getByText("3 produits dans le snapshot PCExpress", { exact: true }).waitFor();
    await page.getByRole("switch", { name: "Comparaisons", exact: true }).click(); assert.equal(await page.locator(".grocery-catalogue-article").count(), 3); assert.equal(await page.locator(".grocery-price-rows").count(), 3);
    const coffee = page.locator(".grocery-catalogue-article").filter({ has: page.getByRole("heading", { name: "Café démo", exact: true }) });
    assert.match(await coffee.innerText(), /Marque démo/); const stores = await coffee.locator(".grocery-price-row > strong").allTextContents(); assert.equal(stores[0], "Walmart");
    await page.getByLabel("Rechercher un article").fill("Savon"); assert.equal(await page.locator(".grocery-catalogue-article").count(), 0);
    await page.getByRole("radio", { name: "Tous les produits", exact: true }).locator("..").click(); assert.equal(await page.locator(".grocery-catalogue-article").count(), 1); await page.getByLabel("Rechercher un article").fill(""); assert.equal(await page.locator(".grocery-catalogue-article").count(), 8);
    await noOverflow(page, width); await page.screenshot({ path: join(evidenceDir, `comparisons-${width}.png`), fullPage: true }); await page.screenshot({ path: join(evidenceDir, `comparisons-viewport-${width}.png`) });
    const trigger = page.getByRole("button", { name: "Détails de Café démo", exact: true }); await trigger.focus(); await page.keyboard.press("Enter"); const dialog = page.getByRole("dialog", { name: "Détails du produit" }); await dialog.waitFor();
    assert.equal(await dialog.locator(".grocery-offer-card").count(), 4); assert.match(await dialog.locator('.grocery-product-format').innerText(), /500 g/); assert.equal(await dialog.locator('.grocery-product-heading h3').evaluate(el => getComputedStyle(el).fontSize), '22px'); await noOverflow(page, width); await page.screenshot({ path: join(evidenceDir, `details-${width}.png`) });
    await dialog.locator(".grocery-offer-source summary").first().click(); await noOverflow(page, width); if (width === 320) await page.screenshot({ path: join(evidenceDir, "details-expanded-320.png") });
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await trigger.click(); await dialog.getByRole("button", { name: "Retour aux prix" }).click(); await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Moins cher ailleurs", exact: true }).click(); assert.equal(await page.locator(".grocery-target-article").count(), 2); const targets = await page.locator(".grocery-target-article").allTextContents(); assert.ok(targets.some(t => /Café démo.*−20 %/s.test(t))); assert.ok(!targets.some(t => /50 %/.test(t))); assert.ok(targets.some(t => /Substitution revue/.test(t)));
    assert.equal(await page.locator('.grocery-target-store').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    await noOverflow(page, width); await page.screenshot({ path: join(evidenceDir, `target-${width}.png`), fullPage: true }); await page.screenshot({ path: join(evidenceDir, `target-viewport-${width}.png`) });
    await page.locator(".grocery-target-article .grocery-info summary").first().click(); await noOverflow(page, width);
    // Observations stay useful without silently approving source, equivalence, zone or availability.
    plan.items[0].preference = "Café en grains";
    for (const p of plan.prices) { p.approved = false; p.available = "unknown"; p.localityConfirmed = false; }
    for (const r of plan.retailers) r.areaConfirmed = false;
    for (const p of plan.prices.filter(p => p.itemId === "i0")) { p.product = "Café démo en grains"; p.substitution = true; }
    plan.prices.find(p => p.id === "p2").price = 4;
    plan.prices.find(p => p.id === "p2").mode = "delivery";
    plan.retailers.find(r => r.id === "r2").mode = "delivery";
    const observedPlan = structuredClone(plan);
    await page.reload(); await page.getByText("8 produits", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Moins cher ailleurs", exact: true }).click();
    assert.equal(await page.locator(".grocery-target-article").count(), 3);
    assert.equal(await page.locator(".grocery-target-badge").filter({ hasText: "À vérifier" }).count(), 3);
    const costcoTarget = page.locator(".grocery-target-store").filter({ has: page.getByRole("heading", { name: "Costco", exact: true }) });
    assert.match(await costcoTarget.innerText(), /[−-]20 %/); assert.match(await costcoTarget.innerText(), /Modes différents/);
    assert.match(await costcoTarget.innerText(), /Substitution non autorisée/);
    assert.equal(await page.locator(".grocery-target-badge.is-validated").count(), 0);
    await readableBadge(page.locator('.grocery-store-status').first());
    await readableBadge(costcoTarget.locator('.grocery-target-saving'));
    await noOverflow(page, width);
    await page.screenshot({ path: join(evidenceDir, `target-observed-${width}.png`), fullPage: true });
    await page.screenshot({ path: join(evidenceDir, `target-observed-viewport-${width}.png`) });
    await costcoTarget.locator(".grocery-target-article > .grocery-info > summary").click();
    assert.match(await costcoTarget.innerText(), /Frais \/ taxes à vérifier/);
    assert.equal(await costcoTarget.getByText("Le moins cher", { exact: true }).count(), 0);
    await noOverflow(page, width);
    if (width === 320) await page.screenshot({ path: join(evidenceDir, "target-observed-expanded-320.png"), fullPage: true });
    await page.getByLabel("Références validées seulement").check();
    assert.equal(await page.locator(".grocery-target-article").count(), 0);
    await page.getByText(/Aucune référence entièrement validée/).waitFor();
    await page.getByLabel("Références validées seulement").uncheck();
    assert.equal(await page.locator(".grocery-target-article").count(), 3);
    // Explicit type conflict and a missing baseline never receive a synthetic saving.
    plan.prices.find(p => p.id === "p2").product = "Café démo instantané";
    await page.reload(); await page.getByText("8 produits", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Moins cher ailleurs", exact: true }).click();
    assert.equal(await page.locator(".grocery-target-article").count(), 2);
    assert.equal(await page.locator(".grocery-target-store").filter({ has: page.getByRole("heading", { name: "Costco", exact: true }) }).count(), 0);
    plan.prices = plan.prices.filter(p => p.id !== "p0");
    await page.reload(); await page.getByText("8 produits", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Moins cher ailleurs", exact: true }).click();
    assert.equal(await page.locator(".grocery-target-article").count(), 1);
    await page.getByText(/Références manquantes ou non comparables/).click();
    assert.match(await page.locator(".grocery-info[open]").last().innerText(), /Café démo.*Référence Superstore manquante/s);
    assert.deepEqual(observedPlan.items[0].substitutions, false);
    Object.assign(plan, structuredClone(original));
    await page.reload(); await page.getByText("8 produits", { exact: true }).waitFor();
    await page.getByRole("switch", { name: "Comparaisons", exact: true }).click();
    await page.getByRole("button", { name: "Catalogue", exact: true }).click(); assert.equal(await page.getByRole("switch", { name: "Comparaisons", exact: true }).getAttribute("aria-checked"), "true"); await page.getByRole("switch", { name: "Comparaisons", exact: true }).click(); assert.equal(await page.locator(".grocery-price-rows").count(), 0);
    await importCart(page, { ...snapshot, capturedAt: "2000-01-01T00:00:00Z" }); await page.getByRole("radio", { name: "Panier actuel", exact: true }).locator("..").click(); await page.getByText(/Snapshot ancien/).waitFor(); assert.equal(await page.locator(".grocery-catalogue-article").count(), 0);
    await importCart(page, snapshot); await page.reload(); await page.getByText("8 produits", { exact: true }).waitFor(); await page.getByRole("radio", { name: "Panier actuel", exact: true }).locator("..").click(); await page.getByText("3 produits dans le snapshot PCExpress", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Achats", exact: true }).click(); await page.getByRole("heading", { name: "Achats récents", exact: true }).waitFor();
    await page.getByRole("button", { name: "Catalogue", exact: true }).click(); await page.getByText("8 produits", { exact: true }).waitFor(); failReads = true; await page.getByText("Sources et outils", { exact: true }).click(); await page.getByRole("button", { name: "Relire le catalogue PC" }).click(); await page.getByText(/Certaines sources PC sont indisponibles/).waitFor(); failReads = false;
    await context.close(); console.log(`Catalogue, combined filters, honest target, receipt navigation and details pass at ${width}px`);
  }
  assert.equal(writes, 0); assert.deepEqual(plan, original); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(join(evidenceDir, "verification.json"), JSON.stringify({ widths: [320, 360, 390, 412, 432, 1280], synthetic: true, writes, externalRequests: external.length, browserErrors: errors, checks: "all/cart x comparison on/off, search, inactive/unpriced/receipt-only/cart-only products, snapshot age, unit ordering, Superstore percent, substitution, incompatible mode, observed vs validated Target, known-mode differences, fees/source disclosures, forbidden substitution, incompatible coffee forms, missing Superstore baseline, details Enter/Escape/Return and focus restore, receipt navigation, reload, unavailable PC, overflow" }, null, 2));
} finally { await browser?.close(); api.close(); site.close(); }
