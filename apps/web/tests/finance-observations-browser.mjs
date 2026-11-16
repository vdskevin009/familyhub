/** Synthetic-only capture/source-date UI. Never contacts a private worker or provider. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { financeFixture } from "../../../tests/finance-fixture.mjs";
import { observationsFixture } from "../../../tests/finance-observations-fixture.mjs";
import { FinanceLibrary } from "../../worker/dist/finance-library.js";
const root = resolve("apps/web/dist"), temp = await mkdtemp(join(tmpdir(), "familyhub-balance-ui-"));
const output = resolve("output/playwright/finance-observations"); await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
 const pathname = new URL(req.url, "http://localhost").pathname, file = resolve(root, "." + pathname.replace(/^\/familyhub/, ""));
 if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
 try { res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(file)] ?? "text/html"); res.end(await readFile(file === root || pathname.endsWith("/") ? join(root, "index.html") : file)); } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening"); const base = "http://127.0.0.1:" + server.address().port + "/familyhub/?view=finances&tab=expenses";
let browser;
try {
 browser = await chromium.launch({ ...(process.env.FAMILYHUB_TEST_BROWSER_CHANNEL ? { channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL } : {}), headless: true });
 for (const width of [320, 390, 768, 1440]) {
  const lib = new FinanceLibrary(join(temp, String(width))), fixture = financeFixture();
  for (let i = 0; i < 5; i++) fixture.accounts.push({ ...fixture.accounts[0], accountId: "extra" + i, alias: "Compte historique " + i });
  const before = (await lib.import({ bundle: fixture, apply: true, expectedRevision: "empty" })).state;
  let state = (await lib.import({ bundle: observationsFixture(before), apply: true, expectedRevision: before.revision })).state;
  const olderBundle = observationsFixture(state, "2026-10-20T12:34:56Z");
  olderBundle.accounts = olderBundle.accounts.filter(a => a.accountId === "bank"); olderBundle.collection.accountIds = ["bank"];
  olderBundle.balanceObservations = olderBundle.balanceObservations.filter(o => o.accountId === "bank"); olderBundle.balanceObservations[0].balanceCents = 100000;
  state = (await lib.import({ bundle: olderBundle, apply: true, expectedRevision: state.revision })).state;
  const middleBundle = observationsFixture(state, "2026-10-25T12:34:56Z"); middleBundle.accounts = olderBundle.accounts; middleBundle.collection.accountIds = ["bank"];
  middleBundle.balanceObservations = middleBundle.balanceObservations.filter(o => o.accountId === "bank"); middleBundle.balanceObservations[0].balanceCents = 150000;
  state = (await lib.import({ bundle: middleBundle, apply: true, expectedRevision: state.revision })).state;
  // Receipt replay stays one stored point; the newest received amount remains authoritative.
  const replay = await lib.import({ bundle: middleBundle, apply: true, expectedRevision: state.revision }); assert.equal(replay.alreadyImported, true);
  const saved = JSON.stringify(state), context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "America/Vancouver", serviceWorkers: "block", reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [], writes = []; page.setDefaultTimeout(10000); page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: "https://synthetic-worker.invalid", ApiKey: "synthetic-key" })));
  await context.route("https://synthetic-worker.invalid/**", async route => {
   const req = route.request(), path = new URL(req.url()).pathname;
   if (req.method() === "OPTIONS") return route.fulfill({ json: {} });
   if (req.method() !== "GET") { writes.push(path); return route.fulfill({ status: 403, json: {} }); }
   const body = path === "/finances" ? state : path === "/health" ? { status: "ok", version: "2.25.0" } : path === "/invoices" ? { items: [], reconciliations: [], unmatchedReimbursements: [], setupRequired: true, accounts: [] } : path === "/savings/contracts" ? { records: [] } : { records: [], jobs: [], items: [], state: "idle" };
   return route.fulfill({ json: body });
  });
  await page.goto(base); const note = page.locator(".finance-collection-note"); await note.waitFor(); assert.match(await note.innerText(), /1 compte sur 9/); assert.equal(await note.locator("time").getAttribute("datetime"), "2026-10-25T12:34:56Z"); assert.match(await note.innerText(), /UTC|HNP|HAP/);
  await page.getByRole("button", { name: "Comptes", exact: true }).click();
  const bank = page.locator('[data-investment-account="bank"]'), rrsp = page.locator('[data-investment-account="rrsp"]');
  assert.match(await bank.innerText(), /1\s?234,56/); assert.match(await rrsp.innerText(), /3\s?234,56/); assert.match(await bank.innerText(), /Date bancaire inconnue/); assert.match(await bank.innerText(), /Reçu le/);
  assert.equal(await page.locator('.finance-historical-accounts').getAttribute('open'), null); await page.locator('.finance-historical-accounts > summary').click();
  assert.match(await page.locator('[data-investment-account="gic"]').innerText(), /Observation historique/);
  for (let i = 0; i < 5; i++) assert.match(await page.locator('[data-investment-account="extra' + i + '"]').innerText(), /Observation historique/);
  await page.locator('.finance-historical-accounts > summary').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: join(output, "accounts-" + width + ".png"), fullPage: true });
  for (let i = 0; i < 2; i++) {
   await bank.click(); await page.getByRole("heading", { name: "Compte courant", exact: true }).waitFor();
   await page.getByText("Historique des soldes reçus", { exact: true }).click(); await page.getByText(/Valeur historique conservée/).waitFor();
   assert.match(await page.getByText(/Valeur historique conservée/).innerText(), /2026-10-09/);
   const history = page.locator(".finance-received-evolution"); await history.getByRole("heading", { name: "Évolution des soldes reçus" }).waitFor();
   assert.equal(await history.getByRole("img", { name: "Évolution des soldes reçus", exact: true }).count(), 1);
   assert.equal(await history.locator("[data-received-point]").count(), 3); assert.equal(await history.locator("li").count(), 3);
   assert.match(await history.locator(".finance-received-change").innerText(), /\+234,56/); assert.match(await history.innerText(), /pas un rendement/); assert.match(await history.innerText(), /Date bancaire inconnue/);
   assert.equal(await history.locator("[data-received-point='2026-10-09']").count(), 0); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
   if (i === 0) await history.screenshot({ path: join(output, "evolution-" + width + ".png") });
   await page.getByRole("button", { name: "Retour aux comptes", exact: true }).click();
  }
  await rrsp.click(); await page.getByText("Historique des soldes reçus", { exact: true }).click();
  await page.getByText("Une seule réception datée : l’évolution sera disponible après une autre réception réelle.", { exact: true }).waitFor();
  assert.equal(await page.locator(".finance-received-evolution [data-received-point]").count(), 0); assert.equal(await page.locator(".finance-received-evolution li").count(), 1);
  await page.getByRole("button", { name: "Retour aux comptes", exact: true }).click();
  await page.getByRole("button", { name: "Actualiser", exact: true }).click(); await page.getByText("Données enregistrées sur le PC rechargées. Aucune nouvelle connexion bancaire.", { exact: true }).waitFor(); assert.equal(JSON.stringify(state), saved);
  for (const tab of ["Dépenses", "Tendances", "Comptes"]) {
   await page.getByRole("button", { name: tab, exact: true }).click();
   if (tab === "Comptes") assert.equal(await note.count(), 0);
   else if(tab === "Tendances") {
    assert.match(await page.locator('.trend-collection').innerText(),/Collecté le/);
    await page.getByRole('button',{name:'Informations : Lecture des tendances',exact:true}).click();
    const method=page.getByRole('dialog',{name:'Lecture des tendances',exact:true});
    assert.match(await method.innerText(),/1 compte sur 9/);assert.match(await method.innerText(),/fraîcheur bancaire/);
    await page.keyboard.press('Escape');
   } else assert.match(await note.innerText(), /1 compte sur 9/);
  }
  // A newer bank-dated value can supersede the observation without hiding its history.
  state = structuredClone(state); state.data.accounts.find(a => a.id === "bank").asOf = "2031-01-01";
  await page.getByRole("button", { name: "Actualiser", exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-investment-account="bank"]')?.textContent?.includes('2031-01-01')); if (await page.locator('.finance-historical-accounts').getAttribute('open') === null) await page.locator('.finance-historical-accounts > summary').click(); await bank.waitFor(); await bank.click(); await page.getByText("Historique des soldes reçus", { exact: true }).click(); assert.match(await page.getByText(/Valeur historique conservée/).innerText(), /2031-01-01/); assert.equal(await page.locator(".finance-received-evolution li").count(), 3);
  if (width === 320) {
   // A long real receipt series is bounded visually, but every exact record remains keyboard-accessible.
   const template = state.data.balanceObservations.find(o => o.accountId === "bank");
   state = structuredClone(state); state.data.balanceObservations = Array.from({ length: 125 }, (_, i) => ({ ...template, capturedAt: new Date(Date.parse("2026-11-02T12:00:00Z") + i * 60000).toISOString(), balanceCents: 100000 + i }));
   await page.reload(); await page.getByRole("button", { name: "Comptes", exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-investment-account="bank"]')?.textContent?.includes('2031-01-01')); if (await page.locator('.finance-historical-accounts').getAttribute('open') === null) await page.locator('.finance-historical-accounts > summary').click(); await page.locator('[data-investment-account="bank"]').click(); await page.getByText("Historique des soldes reçus", { exact: true }).click();
   const longHistory = page.locator(".finance-received-evolution"); assert.equal(await longHistory.locator("[data-received-point]").count(), 100); assert.equal(await longHistory.locator("li").count(), 20);
   const more = longHistory.getByRole("button", { name: /^Voir les réceptions précédentes/ });
   await more.focus(); await page.keyboard.press("Enter"); assert.equal(await longHistory.locator("li").count(), 40);
   for (let i = 0; i < 5; i++) await more.click(); assert.equal(await longHistory.locator("li").count(), 125); assert.equal(await more.count(), 0);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  }
  // Old workers omit capture metadata; import time and collectedOn never become fallback timestamps.
  state = structuredClone(before); await page.reload(); await note.waitFor(); assert.match(await note.innerText(), /Date et heure de la dernière collecte non disponibles/); assert.equal(await note.locator("time").count(), 0);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []); await context.close(); console.log("PASS received-date evolution, single-capture unknown, dedup, historical separation, timestamps and reload at " + width + "px");
 }
} finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true }); }
