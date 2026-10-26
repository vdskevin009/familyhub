import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { localDate } from "../apps/worker/src/mortgage-model";
import { defaultMortgageAlertSettings } from "../apps/worker/src/mortgage-daily";
import type { DecisionProfile, DecisionTerms } from "../apps/worker/src/mortgage-decision";
import { snapshot, quote } from "./mortgage-fixture";

test("isolated assistant HTTP: private writes, null gates, reports, persistence and no remote collection", { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fh-mortgage-assistant-api-"));
  const portReservation = createServer(); portReservation.listen(0, "127.0.0.1"); await once(portReservation, "listening");
  const port = (portReservation.address() as { port: number }).port; await new Promise<void>(resolve => portReservation.close(() => resolve()));
  const key = "synthetic-assistant-pairing-key", privateMarker = "Synthetic-private-evidence-never-log";
  await writeFile(join(dir, "pairing-key.txt"), key);
  await writeFile(join(dir, "unrelated-sentinel.json"), '{"untouched":true}');
  // Process-local injection only: production code does not gain a test endpoint or alternate source.
  const preload = join(dir, "deny-network.mjs");
  await writeFile(preload, 'globalThis.fetch = async () => { throw new Error("Isolated HTTP test: external network denied"); };');
  const headers = { "x-familyhub-key": key, Origin: "https://vdskevin009.github.io", "content-type": "application/json" };
  const call = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...init, signal: AbortSignal.timeout(25000) });
  const post = (path: string, body: unknown) => call(path, { method: "POST", headers, body: JSON.stringify(body) });
  let child: ChildProcess | undefined, logs = "";
  async function start() {
    child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, process.env.FAMILYHUB_TEST_WORKER_ENTRY || "apps/worker/dist/index.js"], {
      env: { ...process.env, FAMILYHUB_WORKER_HOST: "127.0.0.1", FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: dir }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", data => { logs += String(data); }); child.stderr?.on("data", data => { logs += String(data); });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error("Isolated worker exited before readiness");
      try { if ((await call("/health", { headers })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error("Isolated worker did not become ready");
  }
  async function stop() { if (child && child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; } child = undefined; }
  try {
    await start();
    for (const path of ["profiles", "terms", "settings", "run-daily"]) {
      assert.equal((await call(`/mortgage/${path}`, { method: "POST", body: "{}" })).status, 401);
      assert.equal((await call(`/mortgage/${path}`, { method: "POST", headers: { ...headers, Origin: "https://untrusted.test" }, body: "{}" })).status, 403);
    }
    const health = await (await call("/health", { headers })).json(); assert.ok(health.capabilities.includes("mortgage-assistant-v1"));
    assert.deepEqual(await (await post("/mortgage/run-daily", {})).json(), { reportId: null, stored: false });
    const now = new Date(), day = localDate(now), stamp = now.toISOString();
    const unknown = () => ({ amount: null, source: null, asOf: null, validUntil: null, financed: false });
    const profile: DecisionProfile = { schema: 1, id: "synthetic-http-profile", recordedAt: stamp, source: privateMarker, balanceAsOf: null, principal: null, currentRate: 5, remainingMonths: null, maturityDate: null, nextPaymentDate: null, paymentAmount: null, rateType: "fixed", paymentMode: "fixed-payment", compounding: "semiannual", penalty: unknown(), currentCashbackClawback: unknown(), notes: [], evidenceStatus: "incomplete" };
    const offer = { ...quote(), id: "synthetic-http-offer", receivedDate: day, source: privateMarker };
    const terms: DecisionTerms = { schema: 1, id: "synthetic-http-terms", offerId: offer.id, recordedAt: stamp, source: privateMarker, validUntil: null, eligibility: "unconfirmed", offerStatus: "indicative", compounding: null, paymentAmount: null, fees: unknown(), cashback: unknown(), cashbackPaidOn: null, cashbackClawback: unknown(), conditions: [] };
    assert.equal((await post("/mortgage/terms", terms)).status, 400, "unknown offer is rejected before persistence");
    assert.equal((await post("/mortgage/profiles", profile)).status, 200);
    assert.equal((await (await post("/mortgage/profiles", profile)).json()).duplicate, true);
    assert.equal((await post("/mortgage/profiles", { ...profile, currentRate: 6 })).status, 409);
    assert.equal((await post("/mortgage/profiles", { ...profile, id: "invalid", principal: -1 })).status, 400);
    assert.equal((await post("/mortgage/profiles", { ...profile, padding: "x".repeat(33000) })).status, 400);
    const settings = { ...defaultMortgageAlertSettings(stamp), id: "synthetic-http-settings", minimumNetGain: 1500 };
    assert.equal((await post("/mortgage/settings", settings)).status, 200);
    assert.equal((await post("/mortgage/settings", { ...settings, id: "invalid-settings", minimumNetGain: -1 })).status, 400);
    const baseline = snapshot(); assert.equal((await post("/mortgage/snapshots", baseline)).status, 200);
    assert.equal((await post("/mortgage/quotes", offer)).status, 200);
    assert.equal((await post("/mortgage/terms", terms)).status, 200);
    assert.equal((await (await post("/mortgage/terms", terms)).json()).duplicate, true);
    const run = await post("/mortgage/run-daily", {}); assert.equal(run.status, 200);
    const confirmation = await run.json(); assert.equal(confirmation.stored, true); assert.ok(confirmation.reportId);
    const read = await call("/mortgage", { headers }); assert.equal(read.headers.get("cache-control"), "no-store");
    const state = await read.json(); assert.equal(state.profiles.length, 1); assert.equal(state.terms.length, 1); assert.equal(state.settings.length, 1);
    assert.equal(state.baselineSnapshotId, baseline.id); assert.deepEqual(state.snapshots[0], baseline);
    assert.equal(state.profiles[0].principal, null); assert.equal(state.terms[0].fees.amount, null);
    const report = state.reports.find((r: any) => r.id === confirmation.reportId);
    assert.equal(report.localDate, day); assert.equal(report.netGain, null); assert.equal(report.settings.minimumNetGain, 1500);
    assert.equal(report.comparisons.length, 1); assert.equal(report.comparisons[0].status, "unavailable");
    assert.ok(report.comparisons[0].uncertainties.some((s: string) => s.includes("Pénalité")));
    assert.ok(report.indicators.every((i: any) => i.status !== "observed" && i.value === null), "denied collection cannot manufacture fresh values");
    assert.ok(report.contextSources.every((s: any) => s.status !== "observed"));
    assert.equal((await post("/mortgage/reports", report)).status, 404, "daily reports have no external write route");
    await stop(); await start();
    const persisted = await (await call("/mortgage", { headers })).json();
    assert.deepEqual(persisted.profiles, state.profiles); assert.deepEqual(persisted.terms, state.terms);
    assert.ok(persisted.reports.some((r: any) => r.id === report.id));
    assert.equal(await readFile(join(dir, "unrelated-sentinel.json"), "utf8"), '{"untouched":true}');
    assert.ok(!logs.includes(key)); assert.ok(!logs.includes(privateMarker));
    const evidence = join(dir, "mortgage", "evidence"), names = await readdir(evidence);
    assert.ok(names.some(name => name.startsWith("profile-"))); assert.ok(names.some(name => name.startsWith("report-")));
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
