/** Isolated synthetic insurance evidence; no household data or insurer is contacted. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join, resolve, relative, extname } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { syntheticInsuranceReference } from "../../../tests/fixtures/insurance-reference.mjs";
import { newContract } from "../../worker/dist/savings-model.js";
const directory = await mkdtemp(join(tmpdir(), "fh-phone-sharing-"));
const root = resolve("apps/web/dist");
const site = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname.replace(/^\/familyhub/, "");
  const file = resolve(root, "." + (pathname || "/index.html"));
  if (relative(root, file).startsWith("..")) { response.writeHead(403); response.end(); return; }
  try {
    const target = pathname.endsWith("/") ? join(file, "index.html") : file;
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(target)] || "application/octet-stream");
    response.end(await readFile(target));
  } catch { response.writeHead(404); response.end(); }
});
site.listen(0, "127.0.0.1"); await once(site, "listening");
const origin = `http://127.0.0.1:${site.address().port}`, base = origin + "/familyhub/?view=savings";
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const endpoint = `http://127.0.0.1:${port}`, key = "synthetic-phone-sharing-key";
await writeFile(join(directory, "pairing-key.txt"), key);
const worker = spawn(process.execPath, ["apps/worker/dist/index.js"], { windowsHide: true, env: { ...process.env, FAMILYHUB_WORKER_DATA: directory, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_HOST: "127.0.0.1", FAMILYHUB_ALLOWED_ORIGINS: origin }, stdio: ["ignore", "pipe", "pipe"] });
const exited = once(worker, "exit"); let browser, logs = "";
worker.stdout.on("data", chunk => logs += chunk); worker.stderr.on("data", chunk => logs += chunk);
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(endpoint + "/health", { headers: { "x-familyhub-key": key } })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ headless: true });
  const headers={"x-familyhub-key":key,"Content-Type":"application/json"};
  const contract={...newContract('home-insurance','synthetic-insurance-ui'),name:'Synthetic insurance reference',provider:'Synthetic insurer',updatedAt:new Date().toISOString(),insuranceReference:syntheticInsuranceReference()};
  contract.insuranceReference.records[2].status='awaiting_quote';contract.insuranceReference.records[2].requestedOn='2026-01-02';
  const imported=await fetch(endpoint+'/savings/contracts/import',{method:'POST',headers,body:JSON.stringify({contracts:[contract],documents:[]})});assert.equal(imported.status,200);
  assert.equal((await fetch(endpoint+'/savings/contracts')).status,401);
  for(const viewport of [{width:320,height:760},{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block',acceptDownloads:true});
    await context.addInitScript(({Endpoint,ApiKey})=>localStorage.setItem('familyhub.worker.v1',JSON.stringify({Endpoint,ApiKey})),{Endpoint:endpoint,ApiKey:key});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.getByRole('button',{name:/Ouvrir le contrat Synthetic insurance reference/}).click();
    const panel=page.getByRole('region',{name:'Référentiel assurances'});await panel.waitFor();
    const policySummary=panel.locator('summary').filter({hasText:'Synthetic policy'}).first();await policySummary.focus();await page.keyboard.press('Enter');await panel.getByText('Inconnu',{exact:true}).first().waitFor();
    await panel.locator('summary').filter({hasText:'Synthetic pending request'}).first().click();await panel.getByText(/Aucun devis reçu ni tarif confirmé/).waitFor();
    assert.match(await panel.innerText(),/En attente de devis/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mkdir('output/playwright/insurance-reference',{recursive:true});await page.screenshot({path:'output/playwright/insurance-reference/synthetic-'+viewport.width+'.png',fullPage:true});
    const downloaded=page.waitForEvent('download');await panel.getByRole('button',{name:/Exporter le référentiel privé/}).click();
    const exported=JSON.parse(await readFile(await(await downloaded).path(),'utf8'));assert.deepEqual(exported.reference,contract.insuranceReference);assert.ok(!JSON.stringify(exported).includes(key));
    await page.getByRole('button',{name:'Retour aux services',exact:true}).click();await page.getByRole('button',{name:/Ouvrir le contrat Synthetic insurance reference/}).click();
    await page.route(endpoint+'/**',route=>route.abort());await page.reload();await page.getByRole('button',{name:/Ouvrir le contrat Synthetic insurance reference/}).click();await page.getByRole('region',{name:'Référentiel assurances'}).waitFor();assert.deepEqual(errors,[]);
    await context.close();
  }
  assert.ok(!logs.includes(key));console.log('PASS: private insurance reference, mobile/desktop, unknowns, request/quote separation, export, repeated navigation and offline cache');
} finally {
  await browser?.close(); worker.kill(); await exited; await new Promise(resolve => site.close(resolve)); await rm(directory, { recursive: true, force: true });
}
