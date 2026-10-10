import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { FinanceLibrary } from "../apps/worker/dist/finance-library.js";
import { SavingsLibrary } from "../apps/worker/dist/savings-library.js";
import { financeFixture } from "./finance-fixture.mjs";
import { contractEvidence } from "./notification-fixture.mjs";
test("paired notification HTTP API enforces authorization, bounds, conflicts and persistence without source mutations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "familyhub-notification-api-")), reservation = createServer();
  reservation.listen(0, "127.0.0.1"); await once(reservation, "listening"); const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const finance = new FinanceLibrary(join(dir, "finances")); const imported = await finance.import({ bundle: financeFixture(), apply: true, expectedRevision: "empty" }); await finance.decide({ id: "groceries", expectedRevision: imported.state.revision, decision: { nature: "expense", category: "groceries", note: "Synthetic manual choice retained" } });
  const savings = new SavingsLibrary(join(dir, "savings", "household-contracts.json")); await savings.import({ contracts: [contractEvidence()], documents: [] });
  const financialBefore = await readFile(join(dir, "finances", "ledger.json")), contractsBefore = await readFile(join(dir, "savings", "household-contracts.json"));
  await writeFile(join(dir, "pairing-key.txt"), "synthetic-notification-key");
  let child, logs = ""; const headers = { "x-familyhub-key": "synthetic-notification-key", Origin: "https://vdskevin009.github.io", "Content-Type": "application/json" };
  const call = (path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, init), post = body => call("/notifications", { method: "POST", headers, body: JSON.stringify(body) });
  async function start() {
    const env = { ...process.env, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: dir, FAMILYHUB_WORKER_HOST: "127.0.0.1" }; delete env.FAMILYHUB_PUSH_PUBLIC_KEY; delete env.FAMILYHUB_PUSH_PRIVATE_KEY;
    child = spawn(process.execPath, ["apps/worker/dist/index.js"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); child.stdout.on("data", d => logs += d); child.stderr.on("data", d => logs += d);
    for (let n = 0; n < 100; n++) { try { const r = await call("/notifications", { headers }); if (r.ok && (await r.json()).scannedAt) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
    throw Error("Synthetic notification worker failed: " + logs);
  }
  async function stop() { if (child) { const ended = once(child, "exit"); child.kill(); await ended; child = null; } }
  try {
    await start();
    for (const method of ["GET", "POST"]) { assert.equal((await call("/notifications", { method })).status, 401); assert.equal((await call("/notifications", { method, headers: { ...headers, Origin: "https://untrusted.invalid" } })).status, 403); }
    const read = await call("/notifications", { headers }); assert.equal(read.headers.get("cache-control"), "no-store"); let state = await read.json(); assert.equal(state.pushConfigured, false); assert.equal(state.publicKey, null);
    const revision = state.revision;
    let response = await post({ action: "preferences", expectedRevision: revision, preferences: { ...state.preferences, weekly: false } }); assert.equal(response.status, 200); state = await response.json();
    assert.equal((await post({ action: "preferences", expectedRevision: revision, preferences: state.preferences })).status, 409);
    assert.equal((await post({ action: "preferences", expectedRevision: state.revision, preferences: { weekly: true } })).status, 400);
    assert.equal((await post({ action: "enroll", expectedRevision: state.revision, permission: "granted", subscription: { endpoint: "http://127.0.0.1/private" } })).status, 400);
    assert.equal((await post({ action: "setup", expectedRevision: state.revision })).status, 400);
    assert.equal((await call("/notifications/unexpected", { headers })).status, 404);
    const oversized = await post({ action: "preferences", expectedRevision: state.revision, padding: "x".repeat(13000) }); assert.ok([400, 413].includes(oversized.status));
    await stop(); await start(); const after = await (await call("/notifications", { headers })).json(); assert.equal(after.preferences.weekly, false); assert.deepEqual(after.events.map(e => e.id), state.events.map(e => e.id));
    assert.deepEqual(await readFile(join(dir, "finances", "ledger.json")), financialBefore); assert.deepEqual(await readFile(join(dir, "savings", "household-contracts.json")), contractsBefore);
    assert.equal((await readdir(dir)).includes("notifications-vapid.private.json"), false); assert.equal(logs.includes("synthetic-notification-key"), false);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
