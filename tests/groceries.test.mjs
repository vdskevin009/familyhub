import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { GroceryStore, validateSource } from "../apps/worker/dist/grocery-store.js";
import { emptyReceipt, blankItem, unitPrice, validateReceipt, receiptWarnings, monthlySummary } from "../apps/worker/dist/grocery-model.js";
const source = text => ({ name: "synthetic-receipt.txt", type: "text/plain", data: Buffer.from(text).toString("base64") });
const item = { ...blankItem(), name: "Synthetic brand oats", product: "Synthetic brand oats", amount: 4, quantity: 2, size: 500, unit: "g", evidence: "SOURCE 1: synthetic oats 4.00", uncertain: false };
const receipt = { ...emptyReceipt(), store: "Synthetic store", date: "2026-10-07", currency: "CAD", total: 7, delivery: 1, service: 1, tip: 1, tax: 0, discount: 0, items: [item] };
async function fixture(t, extractor = async () => receipt) { const directory = await mkdtemp(join(tmpdir(), "fh-grocery-test-")); t.after(() => rm(directory, { recursive: true, force: true })); return { directory, store: new GroceryStore(join(directory, "groceries"), extractor) }; }
const saved = (r, store, data = receipt, options = {}) => store.review(r.id, { receipt: data, expectedRevision: r.revision, save: true, confirmed: true, ...options });
test("multi-photo source batch deduplication, reordered replay and overlapping imports", async t => {
  const { store } = await fixture(t);
  const a = source("synthetic top"), b = source("synthetic bottom");
  const first = await store.import({ sources: [a, a, b] }); assert.equal(first.record.sources.length, 2);
  assert.equal((await store.import({ sources: [b, a] })).record.id, first.record.id);
  assert.equal((await store.list()).records.length, 1);
  await assert.rejects(store.import({ sources: [a, source("another source")] }), /déjà/);
});
test("extraction saves a reviewable draft; confirmation, revision protection and month fees", async t => {
  const { store, directory } = await fixture(t);
  const imported = (await store.import({ sources: [source("synthetic")] })).record;
  const extracted = await store.extract(imported.id, { expectedRevision: imported.revision });
  assert.equal(extracted.status, "draft"); assert.equal(monthlySummary([extracted], "2026-10").currencies.length, 0);
  await assert.rejects(store.review(extracted.id, { receipt, expectedRevision: extracted.revision, save: true }), /confirmez/);
  const record = await saved(extracted, store);
  const group = monthlySummary([record], "2026-10").currencies[0]; assert.equal(group.total, 7); assert.equal(group.fees, 3); assert.equal(group.products[0].observations[0].price, 4);
  await assert.rejects(saved(extracted, store), /changé/);
  await assert.rejects(store.extract(record.id, { expectedRevision: record.revision }), /corr/);
  const restarted = new GroceryStore(join(directory, "groceries"), async () => { throw new Error("must not auto-extract"); });
  assert.deepEqual((await restarted.list()).records, [record]);
  const original = await restarted.source(record.id, record.sources[0].hash); assert.equal(Buffer.from(original.data, "base64").toString(), "synthetic");
});
test("similar purchases block save until distinct confirmation or explicit source linking", async t => {
  const { store } = await fixture(t);
  let first = (await store.import({ sources: [source("first")] })).record; first = await saved(first, store);
  let second = (await store.import({ sources: [source("rescan")] })).record;
  await assert.rejects(saved(second, store), /Même magasin/);
  second = await store.review(second.id, { expectedRevision: second.revision, receipt, save: false });
  const linked = await store.linkDuplicate(second.id, { expectedRevision: second.revision, targetId: first.id }); assert.equal(linked.sources.length, 2);
  assert.equal(monthlySummary((await store.list()).records, "2026-10").currencies[0].count, 1);
  assert.equal((await store.import({ sources: [source("rescan")] })).record.id, first.id);
  assert.equal((await store.import({ sources: [source("first")] })).record.id, first.id, "original batch replay remains idempotent after linking more sources");
  const third = (await store.import({ sources: [source("real distinct purchase")] })).record;
  await saved(third, store, receipt, { distinctPurchase: true }); assert.equal(monthlySummary((await store.list()).records, "2026-10").currencies[0].count, 2);
});
test("failed extraction preserves sources and can be retried; no replay on restart", async t => {
  let fail = true;
  const { store, directory } = await fixture(t, async () => { if (fail) throw new Error("private path/token must not escape"); return receipt; });
  const r = (await store.import({ sources: [source("retain me")] })).record;
  await assert.rejects(store.extract(r.id, { expectedRevision: r.revision }), /Sources|sources/);
  const latest = (await store.list()).records[0]; assert.equal(latest.extraction, "failed"); assert.equal(latest.receipt.items.length, 0);
  fail = false; const extracted = await store.extract(r.id, { expectedRevision: latest.revision }); assert.equal(extracted.extraction, "complete");
  const statePath = join(directory, "groceries", "purchases.json"), state = JSON.parse(await readFile(statePath, "utf8")); state.records[0].extraction = "running"; await writeFile(statePath, JSON.stringify(state));
  let called = false; const restart = new GroceryStore(join(directory, "groceries"), async () => { called = true; return receipt; });
  assert.equal((await restart.list()).records[0].extraction, "failed"); assert.equal(called, false);
});
test("an active extraction serializes starts and refuses concurrent editing", async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const { store } = await fixture(t, async () => { await pending; return receipt; });
  const a = (await store.import({ sources: [source("a")] })).record, b = (await store.import({ sources: [source("b")] })).record;
  const extracting = store.extract(a.id, { expectedRevision: a.revision });
  while ((await store.list()).records.find(r => r.id === a.id).extraction !== "running") await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(store.extract(b.id, { expectedRevision: b.revision }), /en cours/);
  await assert.rejects(saved(a, store), /en cours/); release(); await extracting;
});
test("source validation rejects malformed, spoofed, oversized and unsupported uploads", () => {
  for (const bad of [null, { ...source("x"), type: "text/html" }, { ...source("x"), data: "**notbase64**" }, { ...source("x"), type: "image/png" }, { ...source("x"), data: "" }, source("x".repeat(5 * 1024 * 1024 + 1))]) assert.throws(() => validateSource(bad));
});
test("unknowns, dates, negatives, comparison units and cross-month observed prices remain truthful", () => {
  assert.equal(unitPrice({ ...item, quantity: null }), null); assert.equal(unitPrice({ ...item, size: null }), null);
  assert.equal(unitPrice({ ...item, quantity: 1, size: 1000 }).price, unitPrice({ ...item, quantity: 1, size: 1, unit: "kg" }).price);
  for (const bad of [{ ...receipt, date: "2026-02-30" }, { ...receipt, total: -1 }, { ...receipt, total: 7.001 }, { ...receipt, items: [{ ...item, quantity: 0 }] }, { ...receipt, currency: "$" }]) assert.throws(() => validateReceipt(bad));
  assert.ok(receiptWarnings({ ...receipt, total: 99 }).some(w => w.includes("correspondent")));
  const record = (id, r) => ({ id, status: "saved", receipt: r });
  const earlier = record("earlier", { ...receipt, date: "2026-09-01", items: [{ ...item, amount: 3 }] });
  const summary = monthlySummary([record("now", receipt), earlier, record("eur", { ...receipt, currency: "EUR" }), record("unknown", { ...receipt, date: null })], "2026-10");
  assert.equal(summary.incomplete, 1); assert.equal(summary.currencies.length, 2); assert.equal(summary.currencies[0].total, 7);
  assert.equal(summary.currencies[0].products[0].observations.length, 2); assert.equal(summary.currencies[0].products[0].count, 1);
});
test("damaged storage fails closed and unrelated ledgers/contracts remain byte-identical", async t => {
  const { store, directory } = await fixture(t); const sentinel = '{"synthetic":"preserve"}';
  await writeFile(join(directory, "invoices.json"), sentinel); await mkdir(join(directory, "savings")); await writeFile(join(directory, "savings", "household-contracts.json"), sentinel);
  const r = (await store.import({ sources: [source("separate store")] })).record; await saved(r, store);
  assert.equal(await readFile(join(directory, "invoices.json"), "utf8"), sentinel); assert.equal(await readFile(join(directory, "savings", "household-contracts.json"), "utf8"), sentinel);
  const path = join(directory, "groceries", "purchases.json"); await writeFile(path, "damaged");
  await assert.rejects(store.list(), /préservée/); await assert.rejects(store.import({ sources: [source("new")] }), /préservée/); assert.equal(await readFile(path, "utf8"), "damaged");
});
test("authenticated real-worker API: origin, pairing, no-store, upload/review/source/restart", async t => {
  const directory = await mkdtemp(join(tmpdir(), "fh-grocery-api-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening"); const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const key = "synthetic-grocery-key", origin = "http://127.0.0.1:5173"; await writeFile(join(directory, "pairing-key.txt"), key);
  let worker, logs = "";
  async function start() {
    worker = spawn(process.execPath, ["apps/worker/dist/index.js"], { windowsHide: true, env: { ...process.env, FAMILYHUB_WORKER_DATA: directory, FAMILYHUB_WORKER_HOST: "127.0.0.1", FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_ALLOWED_ORIGINS: origin }, stdio: ["ignore", "pipe", "pipe"] });
    worker.stdout.on("data", x => { logs += x; }); worker.stderr.on("data", x => { logs += x; });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-familyhub-key": key } })).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
    throw new Error("Synthetic worker did not start.");
  }
  async function stop() { const exited = once(worker, "exit"); worker.kill(); await exited; worker = null; }
  t.after(async () => { if (worker?.exitCode === null) await stop(); }); await start();
  const request = (path, body, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "x-familyhub-key": key, "Content-Type": "application/json", Origin: origin, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await request("/groceries", undefined, { "x-familyhub-key": "wrong" })).status, 401);
  assert.equal((await request("/groceries", undefined, { Origin: "https://untrusted.invalid" })).status, 403);
  const health = await (await request("/health")).json(); assert.ok(health.capabilities.includes("grocery-receipts-v1"));
  const plan = (await (await request("/groceries/planning")).json()); assert.equal(plan.schema, 1);
  plan.area = "Synthetic city";
  const savedPlan = await request("/groceries/planning", { plan, expectedRevision: "" }); assert.equal(savedPlan.status, 200); assert.equal(savedPlan.headers.get("cache-control"), "no-store"); const planningRevision = (await savedPlan.json()).revision;
  assert.equal((await request("/groceries/planning", { plan, expectedRevision: "" })).status, 409);
  assert.equal((await request("/groceries/planning", { plan, expectedRevision: planningRevision }, { "x-familyhub-key": "wrong" })).status, 401);
  assert.equal((await request("/groceries/research", { product: "oats", area: "123 exact address", confirmed: true })).status, 400);
  const r = (await (await request("/groceries/import", { sources: [source("Synthetic API receipt")] })).json()).record;
  const reviewed = await request(`/groceries/${r.id}/review`, { receipt, expectedRevision: r.revision, save: true, confirmed: true }); assert.equal(reviewed.status, 200); assert.equal(reviewed.headers.get("cache-control"), "no-store");
  assert.equal((await request(`/groceries/${r.id}/review`, { receipt, expectedRevision: r.revision, save: true, confirmed: true })).status, 409);
  const bytes = await (await request(`/groceries/${r.id}/sources/${r.sources[0].hash}`)).json(); assert.equal(Buffer.from(bytes.data, "base64").toString(), "Synthetic API receipt");
  const malformed = await fetch(`http://127.0.0.1:${port}/groceries/import`, { method: "POST", headers: { "x-familyhub-key": key }, body: "{private-source-content" }); assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes("private-source-content"));
  await stop(); await start(); assert.equal((await (await request("/groceries")).json()).records[0].status, "saved");
  assert.equal((await (await request("/groceries/planning")).json()).revision, planningRevision);
  // Startup logs predate this module; never output private source text from a Courses route.
  assert.ok(!logs.includes("Synthetic API receipt")); await stop();
});
