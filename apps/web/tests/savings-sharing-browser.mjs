/** Two isolated devices and a synthetic worker; no household data or real portal is used. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, relative, extname } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { baselineKey, publicBaseline } from "../../worker/dist/savings-model.js";
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
  const pcContext = await browser.newContext({ serviceWorkers: "block" });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", acceptDownloads: true });
  for (const context of [pcContext, phoneContext]) await context.addInitScript(({ Endpoint, ApiKey }) => localStorage.setItem("familyhub.worker.v1", JSON.stringify({ Endpoint, ApiKey })), { Endpoint: endpoint, ApiKey: key });
  const pc = await pcContext.newPage(), phone = await phoneContext.newPage(), errors = [];
  pc.on("pageerror", error => errors.push(error.message)); phone.on("pageerror", error => errors.push(error.message));
  await pc.goto(base);
  await pc.getByText("0 shared contracts available on paired devices.", { exact: true }).waitFor();
  await pc.getByRole("button", { name: "Add contract", exact: true }).click();
  const form = pc.getByRole("dialog", { name: "Add contract", exact: true });
  await form.getByLabel("Name", { exact: true }).fill("Synthetic shared internet");
  await form.getByLabel("Current provider", { exact: true }).fill("TELUS");
  await form.getByLabel("Current price (CAD, all-in)", { exact: true }).fill("60");
  await form.locator('input[type="file"]').setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic shared document") });
  await form.getByRole("button", { name: "Save contract", exact: true }).click();
  await pc.getByRole("button", { name: "Share device contracts with paired devices", exact: true }).click();
  await pc.getByText("1 shared contracts available on paired devices.", { exact: true }).waitFor();
  const headers = { "x-familyhub-key": key };
  assert.equal((await fetch(endpoint + "/savings/research")).status, 401);
  assert.deepEqual((await (await fetch(endpoint + "/savings/research", { headers })).json()).jobs, []);
  const sharedContract = (await (await fetch(endpoint + "/savings/contracts", { headers })).json()).records[0].contract;
  const dailyJob = { id: "synthetic-daily-job", contractId: sharedContract.id, baselineKey: createHash("sha256").update(baselineKey(sharedContract)).digest("hex"), baseline: publicBaseline(sharedContract), scheduledDate: "2026-10-03", createdAt: "2026-10-03T16:00:00Z", completedAt: "2026-10-03T16:01:00Z", status: "complete", report: { summary: "Synthetic daily comparison loaded from the PC", missing: [], offers: [] } };
  await phone.route(endpoint + "/savings/research", route => route.fulfill({ json: { jobs: [dailyJob], schedule: { enabled: true, at: "09:00", timeZone: "America/Vancouver" }, daily: { attemptedAt: dailyJob.createdAt, outcome: "complete", results: [{ outcome: "complete" }] } } }));
  await phone.goto(base);
  await phone.getByRole("heading", { name: "Synthetic shared internet", exact: true }).waitFor();
  await phone.getByText(/Every day at 09:00/).waitFor();
  await phone.getByRole("button", { name: "Results", exact: true }).click();
  await phone.getByText("Synthetic daily comparison loaded from the PC", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "Close Synthetic shared internet: comparison", exact: true }).click();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await phone.getByRole("button", { name: "Complete details", exact: true }).click();
  const phoneForm = phone.getByRole("dialog", { name: "Edit contract", exact: true });
  const downloadPromise = phone.waitForEvent("download"); await phoneForm.getByRole("button", { name: "Download", exact: true }).click();
  assert.equal(await readFile(await (await downloadPromise).path(), "utf8"), "synthetic shared document");
  await phoneForm.getByLabel("Current price (CAD, all-in)", { exact: true }).fill("70");
  await pc.getByRole("button", { name: "Complete details", exact: true }).click();
  const pcForm = pc.getByRole("dialog", { name: "Edit contract", exact: true });
  await pcForm.getByLabel("Current price (CAD, all-in)", { exact: true }).fill("65");
  await pcForm.getByRole("button", { name: "Save contract", exact: true }).click();
  await pc.getByText("Contract saved on this device and your paired PC.", { exact: true }).waitFor();
  await phoneForm.getByRole("button", { name: "Save contract", exact: true }).click();
  await phone.getByText(/This shared contract changed on another device/).waitFor();
  const saved = await (await fetch(endpoint + "/savings/contracts", { headers: { "x-familyhub-key": key } })).json();
  assert.equal(saved.records[0].contract.price, 65, "stale phone edit must not replace the PC version");
  await phone.getByRole("button", { name: "Refresh shared contracts", exact: true }).click();
  await phone.getByText(/contract versions differ/).waitFor();
  assert.match(await phone.locator(".savings-contract-heading").innerText(), /70\.00/);
  await phone.getByRole("button", { name: "Results", exact: true }).click();
  await phone.getByText("Synthetic daily comparison loaded from the PC", { exact: true }).waitFor();
  await phone.getByText(/Your contract changed after this research/).waitFor();
  await phone.getByRole("button", { name: "Close Synthetic shared internet: comparison", exact: true }).click();
  await phone.route(endpoint + "/**", route => route.abort());
  await phone.reload(); await phone.getByRole("heading", { name: "Synthetic shared internet", exact: true }).waitFor();
  assert.match(await phone.locator(".savings-contract-heading").innerText(), /70\.00/);
  assert.deepEqual(errors, []); assert.ok(!logs.includes(key));
  console.log("PASS: two devices, daily result load and stale protection, document bytes, revision conflicts, local-edit preservation and offline cache");
} finally {
  await browser?.close(); worker.kill(); await exited; await new Promise(resolve => site.close(resolve)); await rm(directory, { recursive: true, force: true });
}
