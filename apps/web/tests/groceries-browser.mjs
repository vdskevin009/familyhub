/** Synthetic worker/extractor and a fresh browser profile; never the installed PC data. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, extname } from "node:path";
import { once } from "node:events";
import { GroceryStore } from "../../worker/dist/grocery-store.js";
import { emptyReceipt, blankItem } from "../../worker/dist/grocery-model.js";
const directory = await mkdtemp(join(tmpdir(), "fh-grocery-browser-"));
const root = resolve("apps/web/dist"), errors = [];
let browser, failExtraction = true, failSave = false, offline = false;
const extracted = { ...emptyReceipt(), store: "Synthetic grocery", date: "2026-10-07", currency: "CAD", total: 6, delivery: 1, tax: 0, tip: 0, service: 0, discount: 0,
  items: [{ ...blankItem(), name: "Synthetic oats", product: "Synthetic brand oats", amount: 5, evidence: "Photos 1–2: overlapping synthetic row, review required" }], warnings: ["Chevauchement des photos à vérifier."] };
const store = new GroceryStore(join(directory, "groceries"), async () => { if (failExtraction) throw new Error("synthetic extraction unavailable"); return extracted; });
const key = "synthetic-browser-pairing";
const api = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin || "*"); response.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key"); response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") { response.end(); return; }
  response.setHeader("Content-Type", "application/json");
  if (offline) { request.socket.destroy(); return; }
  if (request.headers["x-familyhub-key"] !== key) { response.writeHead(401); response.end("{}"); return; }
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const parts = new URL(request.url, "http://localhost").pathname.split("/").filter(Boolean);
    let result;
    if (parts[0] === "health") result = { capabilities: ["grocery-receipts-v1"] };
    else if (parts.length === 1) result = await store.list();
    else if (parts[1] === "import") result = await store.import(body);
    else if (parts[2] === "extract") result = await store.extract(parts[1], body);
    else if (parts[2] === "review") { if (failSave) { failSave = false; throw new Error("Échec fictif de sauvegarde ; corrections préservées."); } result = await store.review(parts[1], body); }
    else if (parts[2] === "sources") result = await store.source(parts[1], parts[3]);
    else if (parts[2] === "duplicate") result = await store.linkDuplicate(parts[1], body);
    else throw new Error("Unknown synthetic route");
    response.end(JSON.stringify(result));
  } catch (e) { response.writeHead(400); response.end(JSON.stringify({ error: e.message })); }
});
const site = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname.replace(/^\/familyhub/, ""), file = resolve(root, "." + (pathname || "/index.html"));
  if (relative(root, file).startsWith("..")) { response.writeHead(403); response.end(); return; }
  try { const target = pathname.endsWith("/") ? join(file, "index.html") : file; response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[extname(target)] || "application/octet-stream"); response.end(await readFile(target)); }
  catch { response.writeHead(404); response.end(); }
});
await mkdir("artifacts/groceries", { recursive: true });
try {
  api.listen(0, "127.0.0.1"); site.listen(0, "127.0.0.1"); await Promise.all([once(api, "listening"), once(site, "listening")]);
  const endpoint = `http://127.0.0.1:${api.address().port}`, base = `http://127.0.0.1:${site.address().port}/familyhub/?view=groceries`;
  browser = await chromium.launch({ headless: true, channel: process.env.FAMILYHUB_TEST_BROWSER_CHANNEL || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await context.addInitScript(({ endpoint, key }) => { if (!localStorage.getItem("familyhub.worker.v1")) localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: key })); }, { endpoint, key });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message)); await page.goto(base);
  await page.getByRole("heading", { name: "Courses", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Prendre une photo du ticket").getAttribute("capture"), "environment");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nV8AAAAASUVORK5CYII=", "base64");
  const photoA = { name: "synthetic-top.png", mimeType: "image/png", buffer: png }, photoB = { name: "synthetic-bottom.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from("second synthetic view")]) };
  const unpaired = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const newPhone = await unpaired.newPage(); newPhone.on("pageerror", e => errors.push(e.message)); await newPhone.goto(base);
  await newPhone.getByRole("button", { name: "Galerie ou reçu", exact: true }).waitFor();
  await newPhone.getByLabel("Choisir les photos ou le reçu numérique").setInputFiles([photoA]); await newPhone.getByText(/1 source\(s\) dans ce ticket/).waitFor();
  assert.equal(await newPhone.getByRole("button", { name: "Importer ce ticket", exact: true }).isDisabled(), true);
  await newPhone.evaluate(({ endpoint, key }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: key })), { endpoint, key });
  await newPhone.reload(); await newPhone.getByText(/1 source\(s\) dans ce ticket/).waitFor(); await unpaired.close();
  await page.getByLabel("Choisir les photos ou le reçu numérique").setInputFiles([photoA, photoA, photoB]);
  await page.getByText(/2 source\(s\) dans ce ticket/).waitFor(); await page.reload(); await page.getByText(/2 source\(s\) dans ce ticket/).waitFor();
  await page.getByRole("button", { name: "Importer ce ticket", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Vérifier le ticket", exact: true }); await dialog.waitFor();
  await dialog.getByRole("button", { name: "Extraire les produits", exact: true }).click(); await dialog.getByText(/Extraction indisponible/).waitFor();
  assert.equal((await store.list()).records.length, 1); assert.equal((await store.list()).records[0].sources.length, 2);
  await dialog.getByRole("button", { name: "Actualiser les tickets PC", exact: true }).click(); await dialog.getByText(/Tickets relus depuis le PC/).waitFor();
  await dialog.getByRole("button", { name: "Recharger la version PC", exact: true }).click(); failExtraction = false;
  await dialog.getByRole("button", { name: "Extraire les produits", exact: true }).click(); await dialog.getByLabel("Libellé du ticket", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Voir les 2 source(s)", exact: true }).click(); await dialog.getByText("Source 1 : synthetic-top.png").click();
  await dialog.getByAltText("Source 1 du ticket à vérifier").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await dialog.getByLabel("Nombre de formats / poids mesuré", { exact: true }).fill("2"); await dialog.getByLabel("Taille d'un format", { exact: true }).fill("500"); await dialog.getByLabel("Unité", { exact: true }).selectOption("g");
  await dialog.getByLabel("Ligne vérifiée dans la source", { exact: true }).check();
  await page.getByRole("button", { name: "Close Vérifier le ticket", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); await page.reload();
  await page.getByRole("button", { name: /Synthetic grocery.*Brouillon/ }).click(); await dialog.getByLabel("Nombre de formats / poids mesuré", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("Nombre de formats / poids mesuré", { exact: true }).inputValue(), "2");
  const confirm = dialog.getByLabel(/J'ai revu les sources/); await confirm.check();
  await page.screenshot({ path: "artifacts/groceries/mobile-review.png", fullPage: true });
  failSave = true; await dialog.getByRole("button", { name: "Enregistrer l'achat", exact: true }).click(); await dialog.getByText(/Échec fictif de sauvegarde/).waitFor();
  assert.equal(await dialog.getByLabel("Nombre de formats / poids mesuré", { exact: true }).inputValue(), "2");
  await dialog.getByRole("button", { name: "Enregistrer l'achat", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  await page.getByLabel("Mois", { exact: true }).fill("2026-10"); await page.getByText("1 achat(s) · 6.00 CAD").waitFor(); await page.getByText("Livraison, service et pourboires connus : 1.00 CAD").waitFor(); await page.getByText("5.00 CAD/kg", { exact: true }).waitFor();
  // A second device sees the persisted purchase, without the first device's cache.
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await desktop.addInitScript(({ endpoint, key }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint: endpoint, ApiKey: key })), { endpoint, key });
  const pc = await desktop.newPage(); pc.on("pageerror", e => errors.push(e.message)); await pc.goto(base); await pc.getByLabel("Mois", { exact: true }).fill("2026-10"); await pc.getByText("1 achat(s) · 6.00 CAD").waitFor();
  await pc.screenshot({ path: "artifacts/groceries/desktop-history.png", fullPage: true });
  await page.getByLabel("Choisir les photos ou le reçu numérique").setInputFiles([photoB, photoA]); await page.getByRole("button", { name: "Importer ce ticket", exact: true }).click(); await dialog.waitFor(); assert.equal((await store.list()).records.length, 1);
  await page.getByRole("button", { name: "Close Vérifier le ticket", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  offline = true; await page.reload(); await page.getByText(/Historique en cache/).waitFor(); await page.getByLabel("Mois", { exact: true }).fill("2026-10"); await page.getByText("1 achat(s) · 6.00 CAD").waitFor();
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }
  assert.deepEqual(errors, []);
  console.log("PASS: mobile photo batch, exact duplicate grouping/replay, unpaired-photo retention after pairing, upload recovery, extraction failure/retry, source review, correction/close/reload, save failure/retry, unit prices/fees, second-device persistence, offline history and 320/390/768/1280 layouts; zero browser errors.");
} finally { await browser?.close(); await Promise.all([new Promise(r => api.close(r)), new Promise(r => site.close(r))]); await rm(directory, { recursive: true, force: true }); }
