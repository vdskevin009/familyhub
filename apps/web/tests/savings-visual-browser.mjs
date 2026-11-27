/** Existing recurring UI, synthetic evidence only. No real worker or provider requests. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { once } from "node:events";
import { newContract } from "../../worker/dist/savings-model.js";
import { parseFinancePreparation } from "../../worker/dist/finance-import.js";
import { financeFixture } from "../../../tests/finance-fixture.mjs";

const root = resolve("apps/web/dist"), output = resolve("output/playwright/savings-visual");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  try { res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] ?? "text/html"); res.end(await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file)); }
  catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}/familyhub/`;
const contracts = [
  { ...newContract("telecom", "network"), name: "Forfait Internet + TV", provider: "TELUS", price: 100, taxesIncluded: true,
    services: [{ id: "internet", name: "Internet", pricing: "documented", monthlyAmount: 100, taxesIncluded: true, source: "Synthetic terms" }, { id: "tv", name: "TV incluse", pricing: "included", monthlyAmount: null, taxesIncluded: null, source: "Synthetic terms" }] },
  { ...newContract("subscription", "music"), name: "Musique", provider: "Spotify", price: 20, taxesIncluded: true },
  { ...newContract("home-insurance", "home"), name: "Assurance habitation", provider: "TD Insurance", price: 100, taxesIncluded: true },
  { ...newContract("other", "unknown"), name: "Frais à confirmer", provider: "Unconfirmed" },
  { ...newContract("other", "reference"), name: "Référence sans paiement", provider: "Reference", price: 400, taxesIncluded: true },
  { ...newContract("subscription", "usd"), name: "Abonnement USD", provider: "Example", billing: { amount: 15, currency: "USD", count: 1, unit: "months", asOf: "2026-10-01", source: "Synthetic reference", taxesIncluded: true } },
];
contracts.forEach(contract => { contract.updatedAt = "2026-10-10T12:00:00Z"; });
const transaction = (id, description, date, outflowCents, currency = "CAD") => ({ id, description, date, outflowCents, currency, accountId: "card", status: "posted", occurrence: 1, fingerprint: id, hints: [], sources: [{ name: "synthetic-payments.csv", sha256: "a".repeat(64), record: 2 }] });
let finance = { schema: 1, revision: "synthetic", importedAt: null, data: { ...parseFinancePreparation(financeFixture()), transactions: [transaction("network-debit", "TELUS SYNTHETIC", "2026-10-02", 9500), transaction("network-refund", "TELUS REFUND", "2026-10-03", -500), transaction("music", "SPOTIFY SYNTHETIC", "2026-10-04", 2000), transaction("home", "TD INS SYNTHETIC", "2026-10-04", 10000), transaction("usd", "EXAMPLE SYNTHETIC", "2026-10-05", 1500, "USD")] }, decisions: {}, decisionHistory: [], imports: [] };
finance.decisions = Object.fromEntries(finance.data.transactions.map(row => [row.id, { nature: row.outflowCents < 0 ? "refund" : "expense", category: "other", note: "Synthetic", updatedAt: "" }]));
const before = JSON.stringify(finance);
const includedFinance = {
  ...finance,
  data: { ...finance.data, transactions: [...finance.data.transactions, transaction("netflix", "NETFLIX SYNTHETIC", "2026-10-06", 2000)] },
  decisions: { ...finance.decisions, netflix: { nature: "expense", category: "subscriptions", note: "Synthetic", updatedAt: "" } },
};
const includedContracts = [
  ...contracts.map(contract => contract.id === "network" ? {
    ...contract,
    services: [...contract.services, { id: "streaming", name: "Netflix", pricing: "included", monthlyAmount: null, taxesIncluded: null, source: "Synthetic package terms" }],
  } : contract),
  { ...newContract("subscription", "netflix"), name: "Netflix autonome fictif", provider: "Netflix", price: 20, taxesIncluded: true, updatedAt: "2026-10-10T12:00:00Z" },
];
const includedBefore = JSON.stringify([includedFinance, includedContracts]);
let browser;
try {
  browser = await chromium.launch({ ...(process.env.FAMILYHUB_TEST_BROWSER_CHANNEL ? { channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL } : {}), headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    const page = await context.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
    await page.addInitScript(() => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" })));
    let auditingIncluded = false;
    let release; const heldFinance = new Promise(resolve => { release = resolve; });
    await context.route("https://synthetic-worker.invalid/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = json => route.fulfill({ json });
      if (request.method() === "OPTIONS") return reply({});
      if (request.method() !== "GET") { writes.push(path); return route.fulfill({ status: 403, json: { error: "Read only synthetic test" } }); }
      if (path === "/finances") { await heldFinance; return reply(auditingIncluded ? includedFinance : finance); }
      if (path === "/savings/contracts") return reply({ records: (auditingIncluded ? includedContracts : contracts).map(contract => ({ contract, revision: "synthetic-" + contract.id + (auditingIncluded ? "-included" : "") })) });
      if (path === "/savings/research") return reply({ jobs: [], schedule: null, daily: null });
      if (path === "/invoices") return reply({ items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] });
      return reply({ state: "idle", accounts: [], jobs: [], records: [] });
    });
    await page.goto(base + "?view=savings");
    await page.getByRole("status").filter({ hasText: "Chargement des paiements" }).waitFor();
    assert.equal(await page.locator(".recurring-source-link").count(), 0, "Pending read must not ask to import an existing history");
    release();
    const summary = page.locator('.recurring-paid[aria-busy="false"]'), cad = summary.locator('[data-paid-currency="CAD"]');
    try { await cad.getByText("3/5 contrats rapprochés · partiel", { exact: true }).waitFor(); }
    catch (error) { console.log(await page.locator(".savings-view").innerText()); await page.screenshot({path:join(output,`failure-${width}.png`),fullPage:true}); throw error; }
    assert.match(await cad.locator(".recurring-paid-amount").innerText(), /210,00/);
    assert.match(await summary.locator('[data-paid-currency="USD"] .recurring-paid-amount').innerText(), /15,00/);
    assert.deepEqual(await cad.locator("[data-paid-category]").evaluateAll(rows => rows.map(row => row.dataset.paidCategory)), ["home-insurance", "telecom", "subscription"]);
    assert.equal(await cad.locator('[data-paid-category="other"]').count(), 0, "Unknown and reference-only contracts never enter chart");
    const network = page.locator('[data-recurring-contract="network"]');
    assert.match(await network.innerText(), /Forfait · 2 services/);
    assert.match(await network.innerText(), /2 opérations · période/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "No overflow at " + width);
    assert.equal(await summary.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, "Summary stays inside its surface");
    await page.screenshot({ path: join(output, `recurrents-${width}.png`), fullPage: true });
    await network.click();
    const details = page.getByRole("dialog", { name: "Contrat · Forfait Internet + TV", exact: true });
    assert.equal(await details.locator("[data-service-id]").count(), 2);
    assert.equal(await details.locator(".recurring-payment-row").count(), 2);
    await details.locator(".recurring-payment-row .finance-evidence > summary").first().click();
    assert.match(await details.innerText(), /synthetic-payments.csv/);
    for (const action of ["Modifier", "Comparer les offres publiques", "Retour aux services"]) assert(await details.getByRole("button", { name: action, exact: true }).isVisible());
    await page.keyboard.press("Escape"); await page.waitForFunction(() => document.activeElement?.getAttribute("data-recurring-contract") === "network");
    await page.getByLabel("Filtrer les contrats").selectOption("telecom");
    assert.equal(await summary.locator("[data-paid-category]").count(), 1);
    assert.match(await summary.locator(".finance-totals").innerText(), /90,00/);
    await page.getByRole("button", { name: "Mois suivant", exact: true }).click();
    assert.match(await summary.innerText(), /Non disponible/);
    assert.equal(await summary.locator("[data-paid-category]").count(), 0);
    assert.match(await network.innerText(), /Référence \/mois/);
    await page.getByRole("button", { name: "Mois précédent", exact: true }).click();
    assert.match(await summary.locator(".finance-totals").innerText(), /90,00/);
    assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.equal(JSON.stringify(finance), before);
    auditingIncluded=true;
    await page.getByLabel('Filtrer les contrats').selectOption('all');
    await page.reload();
    await page.locator('.recurring-paid[aria-busy="false"]').waitFor();
    const netflix=page.locator('[data-recurring-contract="netflix"]');
    await netflix.waitFor();
    assert.match(await netflix.innerText(), /20,00/);
    assert.match(await page.locator('[data-paid-currency="CAD"] .recurring-paid-amount').innerText(), /230,00/);
    const banner=page.locator('.recurring-review-banner');
    await banner.getByText('1 élément(s) à vérifier',{exact:true}).waitFor();
    await banner.focus();await page.keyboard.press('Enter');
    const review=page.getByRole('dialog',{name:'Éléments à vérifier',exact:true});
    await review.getByText('1 paiement(s) à vérifier',{exact:true}).click();
    await review.getByText('Paiement rapproché de son abonnement. Le montant reste affecté à ce contrat.',{exact:true}).waitFor();
    assert.equal(await review.getByRole('button',{name:'Catégoriser dans Finances',exact:true}).count(),0);
    await review.locator('.finance-evidence > summary').click();
    assert.match(await review.innerText(),/synthetic-payments.csv/);
    assert.ok(await review.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await review.screenshot({path:join(output,'included-after-'+width+'.png')});
    await review.getByRole('button',{name:'Voir le contrat Forfait Internet + TV',exact:true}).click();
    const bundle=page.getByRole('dialog',{name:'Contrat · Forfait Internet + TV',exact:true});
    await bundle.locator('[data-service-id="streaming"]').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement?.classList.contains('recurring-review-banner'));
    await page.getByLabel('Filtrer les contrats').selectOption('subscription');
    await banner.click();await review.getByText('1 paiement(s) à vérifier',{exact:true}).click();
    await review.getByRole('button',{name:'Voir le contrat Forfait Internet + TV',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('Filtrer les contrats').selectOption('telecom');
    assert.match(await page.locator('[data-paid-currency="CAD"] .recurring-paid-amount').innerText(),/90,00/);
    await banner.click();await review.getByText('1 paiement(s) à vérifier',{exact:true}).click();
    await review.getByRole('button',{name:'Voir le contrat Netflix autonome fictif',exact:true}).click();
    await page.getByRole('dialog',{name:'Contrat · Netflix autonome fictif',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement?.classList.contains('recurring-review-banner'));
    await page.getByRole('button',{name:'Mois suivant',exact:true}).click();
    assert.equal(await banner.count(),0);
    await page.getByRole('button',{name:'Mois précédent',exact:true}).click();
    await banner.waitFor();
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(JSON.stringify(finance),before);
    assert.equal(JSON.stringify([includedFinance, includedContracts]), includedBefore);
    console.log('PASS included service, preserved total/source, contract navigation, keyboard and period '+width);
    await context.close();
  }
  console.log("Savings visual acceptance passed at 320, 390, 768 and 1440px; synthetic data only.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
