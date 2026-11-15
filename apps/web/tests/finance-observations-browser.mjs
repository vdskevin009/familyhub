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
server.listen(0, "127.0.0.1"); await once(server, "listening"); const base = "http://127.0.0.1:" + server.address().port + "/familyhub/?view=finances";
let browser;
try {
 browser = await chromium.launch({ ...(process.env.FAMILYHUB_TEST_BROWSER_CHANNEL ? { channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL } : {}), headless: true });
 for (const width of [320, 390, 768, 1440]) {
  const lib = new FinanceLibrary(join(temp, String(width))), fixture = financeFixture();
  for (let i = 0; i < 5; i++) fixture.accounts.push({ ...fixture.accounts[0], accountId: "extra" + i, alias: "Compte historique " + i });
  const before = (await lib.import({ bundle: fixture, apply: true, expectedRevision: "empty" })).state;
  let state = (await lib.import({ bundle: observationsFixture(before), apply: true, expectedRevision: before.revision })).state;
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
  await page.goto(base); const note = page.locator(".finance-collection-note"); await note.waitFor(); assert.match(await note.innerText(), /2 comptes sur 9/); assert.equal(await note.locator("time").getAttribute("datetime"), "2026-11-01T12:34:56Z"); assert.match(await note.innerText(), /UTC|HNP|HAP/);
  await page.getByRole("button", { name: "Investissements", exact: true }).click();
  const bank = page.locator('[data-investment-account="bank"]'), rrsp = page.locator('[data-investment-account="rrsp"]');
  assert.match(await bank.innerText(), /1\s?234,56/); assert.match(await rrsp.innerText(), /3\s?234,56/); assert.match(await bank.innerText(), /Date bancaire inconnue/); assert.match(await bank.innerText(), /Reçu le/);
  assert.match(await page.locator('[data-investment-account="gic"]').innerText(), /Observation historique/);
  for (let i = 0; i < 5; i++) assert.match(await page.locator('[data-investment-account="extra' + i + '"]').innerText(), /Observation historique/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: join(output, "accounts-" + width + ".png"), fullPage: true });
  for (let i = 0; i < 2; i++) {
   await bank.click(); await page.getByRole("heading", { name: "Compte courant", exact: true }).waitFor();
   await page.getByText("Historique des soldes reçus", { exact: true }).click(); await page.getByText(/Valeur historique conservée/).waitFor();
   assert.match(await page.getByText(/Valeur historique conservée/).innerText(), /2026-10-09/); await page.getByRole("button", { name: "Retour aux comptes", exact: true }).click();
  }
  await page.getByRole("button", { name: "Actualiser", exact: true }).click(); await page.getByText("Données enregistrées sur le PC rechargées. Aucune nouvelle connexion bancaire.", { exact: true }).waitFor(); assert.equal(JSON.stringify(state), saved);
  for (const tab of ["Dépenses", "Tendances", "Investissements"]) { await page.getByRole("button", { name: tab, exact: true }).click(); assert.match(await note.innerText(), /2 comptes sur 9/); }
  // A newer bank-dated value can supersede the observation without hiding its history.
  state = structuredClone(state); state.data.accounts.find(a => a.id === "bank").asOf = "2031-01-01";
  await page.getByRole("button", { name: "Actualiser", exact: true }).click(); await bank.waitFor(); await bank.click(); await page.getByText("Historique des soldes reçus", { exact: true }).click(); assert.match(await page.getByText(/Valeur historique conservée/).innerText(), /2031-01-01/);
  // Old workers omit capture metadata; import time and collectedOn never become fallback timestamps.
  state = structuredClone(before); await page.reload(); await note.waitFor(); assert.match(await note.innerText(), /Date et heure de la dernière collecte non disponibles/); assert.equal(await note.locator("time").count(), 0);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []); await context.close(); console.log("PASS capture timestamp, 2/9 scope, values, preserved history, old-worker fallback and reload at " + width + "px");
 }
} finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true }); }
