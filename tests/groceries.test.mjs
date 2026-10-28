import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { GroceryStore, validateSource } from "../apps/worker/dist/grocery-store.js";
import { emptyReceipt, blankItem, unitPrice, validateReceipt, receiptWarnings, monthlySummary } from "../apps/worker/dist/grocery-model.js";
const source = text => ({ name: "synthetic-receipt.txt", type: "text/plain", data: Buffer.from(text).toString("base64") });
const item = { ...blankItem(), name: "Synthetic brand oats", product: "Synthetic brand oats", amount: 4, quantity: 2, size: 500, unit: "g", evidence: "SOURCE 1: synthetic oats 4.00", uncertain: false };
const receipt = { ...emptyReceipt(), store: "Synthetic store", date: "2026-10-07", currency: "CAD", total: 7, delivery: 1, service: 1, tip: 1, tax: 0, discount: 0, items: [item] };
async function removeFixtureDirectory(directory, prefix) {
  const target = resolve(directory), allowed = resolve(tmpdir()) + sep;
  assert.ok(target.startsWith(allowed) && basename(target).startsWith(prefix));
  await rm(target, { recursive: true, force: true });
}
async function fixture(t, extractor = async () => receipt) { const directory = await mkdtemp(join(tmpdir(), "fh-grocery-test-")); t.after(() => removeFixtureDirectory(directory, "fh-grocery-test-")); return { directory, store: new GroceryStore(join(directory, "groceries"), extractor) }; }
const saved = (r, store, data = receipt, options = {}) => store.review(r.id, { receipt: data, expectedRevision: r.revision, save: true, confirmed: true, ...options });

test("source classification survives save/restart; original confirmations do not count as paid spending", async t => {
  const { store, directory } = await fixture(t);
  const draft = (await store.import({ sources: [source("Synthetic original confirmation")] })).record;
  const original = await saved(draft, store, { ...receipt, sourceType: "confirmation" });
  assert.equal(monthlySummary([original], "2026-10").currencies.length, 0);
  const restarted = new GroceryStore(join(directory, "groceries"), async () => receipt);
  assert.equal((await restarted.list()).records[0].receipt.sourceType, "confirmation");
  const final = await saved(original, restarted, { ...receipt, sourceType: "final-receipt" });
  assert.equal(final.receipt.sourceType, "final-receipt"); assert.equal(monthlySummary([final], "2026-10").currencies[0].total, 7);
  await assert.rejects(saved(original, restarted, { ...receipt, sourceType: "confirmation" }), /changé/);
  assert.equal((await restarted.list()).records[0].receipt.sourceType, "final-receipt");
});
test("dated fulfillment survives save/restart without converting an estimate into paid spending", async t => {
  const { store, directory } = await fixture(t);
  const draft = (await store.import({ sources: [source("Synthetic same-order confirmation and actual delivery proof")] })).record;
  const fulfillment = { date: "2026-10-08", evidence: "SOURCE 2: same synthetic order was delivered" };
  const original = await saved(draft, store, { ...receipt, sourceType: "confirmation", fulfillment });
  const restarted = new GroceryStore(join(directory, "groceries"), async () => receipt);
  assert.deepEqual((await restarted.list()).records[0].receipt.fulfillment, fulfillment);
  assert.equal(monthlySummary([original], "2026-10").currencies.length, 0);
  await assert.rejects(saved(original, restarted, { ...receipt, fulfillment: { ...fulfillment, date: "2026-02-30" } }), /livraison/);
  assert.deepEqual((await restarted.list()).records[0].receipt.fulfillment, fulfillment);
});

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
  const path = join(directory, "groceries", "purchases.json"), valid = await readFile(path, "utf8");
  for (const edit of [s => s.records[0].createdAt = 42, s => s.records[0].reviewedAt = null, s => s.records[0].duplicateOf = "missing"]) { const state = JSON.parse(valid); edit(state); const bytes = JSON.stringify(state); await writeFile(path, bytes); await assert.rejects(store.list(), /préservée/); await assert.rejects(store.import({ sources: [source("new")] }), /préservée/); assert.equal(await readFile(path, "utf8"), bytes); }
  assert.equal(unitPrice({ ...item, quantity: 1e-300, size: 1e-300 }), null);
  await writeFile(path, "damaged");
  await assert.rejects(store.list(), /préservée/); await assert.rejects(store.import({ sources: [source("new")] }), /préservée/); assert.equal(await readFile(path, "utf8"), "damaged");
});
test("authenticated real-worker API: origin, pairing, no-store, upload/review/source/restart", async t => {
  const directory = await mkdtemp(join(tmpdir(), "fh-grocery-api-"));
  let worker, logs = "", leakedSource = false, spawnError, lastHealth = "not-attempted";
  t.after(async () => { await stop(); await removeFixtureDirectory(directory, "fh-grocery-api-"); });
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening"); const port = reservation.address().port; await new Promise(r => reservation.close(r));
  assert.notEqual(port, 4713, "Synthetic tests must never use the installed service port.");
  const key = "synthetic-grocery-key", origin = "http://127.0.0.1:5173"; await writeFile(join(directory, "pairing-key.txt"), key);
  async function start() {
    logs = ""; spawnError = undefined; lastHealth = "not-attempted";
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^FAMILYHUB_PUSH_/i.test(name)));
    worker = spawn(process.execPath, [process.env.FAMILYHUB_TEST_WORKER_ENTRY || "apps/worker/dist/index.js"], { windowsHide: true, env: { ...childEnv, FAMILYHUB_WORKER_DATA: directory, FAMILYHUB_WORKER_HOST: "127.0.0.1", FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_ALLOWED_ORIGINS: origin }, stdio: ["ignore", "pipe", "pipe"] });
    worker.on("error", error => { spawnError = error; });
    const capture = x => {
      logs = (logs + x.toString()).slice(-12000);
      leakedSource ||= logs.includes("Synthetic API receipt");
    };
    worker.stdout.on("data", capture); worker.stderr.on("data", capture);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !spawnError && worker.exitCode === null && worker.signalCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-familyhub-key": key }, signal: AbortSignal.timeout(1000), redirect: "error" });
        lastHealth = `HTTP ${response.status}`;
        if (response.ok) { t.diagnostic(`Synthetic worker ready on loopback port ${port}.`); return; }
      } catch (error) { lastHealth = error.cause?.code || error.code || error.name; }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Synthetic worker did not start: spawn=${spawnError?.code || "ok"}; exit=${worker.exitCode}; signal=${worker.signalCode}; health=${lastHealth}\n${logs.replaceAll(key, "[synthetic key]")}`);
  }
  async function stop() {
    if (!worker) return;
    const current = worker;
    if (current.pid && current.exitCode === null && current.signalCode === null) {
      const exited = once(current, "exit", { signal: AbortSignal.timeout(5000) });
      current.kill(); await exited;
    }
    worker = null;
    t.diagnostic("Synthetic worker process stopped.");
  }
  await start();
  const request = (path, body, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "x-familyhub-key": key, "Content-Type": "application/json", Origin: origin, ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: "error" });
  assert.equal((await request("/groceries", undefined, { "x-familyhub-key": "wrong" })).status, 401);
  assert.equal((await request("/groceries", undefined, { Origin: "https://untrusted.invalid" })).status, 403);
  const health = await (await request("/health")).json(); assert.ok(health.capabilities.includes("grocery-source-type-v1")); assert.ok(health.capabilities.includes("grocery-receipts-v1"));
  assert.ok(health.capabilities.includes("grocery-collection-v1"));
  const collectionFile = join(directory, "groceries", "collection-status.json");
  const collectionStatus = await request("/groceries/collection-status");
  assert.equal(collectionStatus.status, 200); assert.equal(collectionStatus.headers.get("cache-control"), "no-store");
  assert.deepEqual((await collectionStatus.json()).accounts, []);
  await assert.rejects(readFile(collectionFile), { code: "ENOENT" }, "status reads do not create collection state");
  assert.equal((await request("/groceries/collect", {}, { "x-familyhub-key": "wrong" })).status, 401);
  assert.equal((await request("/groceries/collect", {}, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await request("/groceries/collect", {})).status, 202);
  let collection;
  for (let i = 0; i < 50; i++) {
    collection = await (await request("/groceries/collection-status")).json();
    if (!collection.busy) break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(collection.busy, false); assert.equal(collection.incomplete, true); assert.equal(collection.error, "setup-required");
  assert.equal(collection.lastSuccess, undefined); assert.equal(collection.counts.imported, 0);
  assert.deepEqual((await (await request("/groceries")).json()).records, []);
  assert.ok(health.capabilities.includes("grocery-weekly-v1")); assert.ok(health.capabilities.includes("grocery-fulfillment-v1"));
  assert.ok(health.capabilities.includes("grocery-comparison-evidence-v1")); assert.ok(health.capabilities.includes("grocery-source-estimates-v1"));
  assert.ok(health.capabilities.includes("grocery-items-300-v1")); assert.equal(health.version, "2.28.1");
  const plan = (await (await request("/groceries/planning")).json()); assert.equal(plan.schema, 1);
  plan.area = "Synthetic city";
  plan.items = [{ id: "synthetic-month", name: "Synthetic monthly packs", quantity: 3, size: null, unit: null, preference: "Format unknown", substitutions: false, active: false, origin: "", cadence: "month", every: 1, bucket: "household", measure: "pack", provisional: true, basketQuantity: null }];
  plan.items.push(...Array.from({ length: 76 }, (_, n) => ({ ...plan.items[0], id: "synthetic-expanded-" + n, name: "Synthetic article " + n, cadence: "unknown", cadenceNote: "Synthetic retained note", preference: "Synthetic preference " + n })));
  const savedPlan = await request("/groceries/planning", { plan, expectedRevision: "" }); assert.equal(savedPlan.status, 200); assert.equal(savedPlan.headers.get("cache-control"), "no-store"); let planningRevision = (await savedPlan.json()).revision;
  assert.equal((await request("/groceries/planning", { plan, expectedRevision: "" })).status, 409);
  assert.equal((await request("/groceries/planning", { plan, expectedRevision: planningRevision }, { "x-familyhub-key": "wrong" })).status, 401);
  const maximum = structuredClone(plan); maximum.revision = planningRevision;
  maximum.items.push(...Array.from({ length: 223 }, (_, n) => ({ ...plan.items[0], id: "synthetic-max-" + n, name: "Synthetic maximum article " + n, preference: "Synthetic preference ".repeat(20).trim() })));
  maximum.prices = maximum.items.map((item, n) => ({ id: "synthetic-price-" + n, itemId: item.id, retailerId: "synthetic-store", product: "Synthetic recorded product " + n, price: 3, size: 500, unit: "g", weighed: false, taxPercent: null, currency: "CAD", available: "unknown", substitution: false, approved: false, kind: "public", evidence: { title: "Synthetic observed source", url: "https://example.com/synthetic", date: "2026-10-13", until: null } }));
  maximum.retailers = [{ id: "synthetic-store", name: "Synthetic retailer", delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, areaConfirmed: false, otherFeesReviewed: false, evidence: { title: "Synthetic source", url: "https://example.com/synthetic", date: "2026-10-13", until: null } }];
  assert.ok(Buffer.byteLength(JSON.stringify({ plan: maximum, expectedRevision: planningRevision })) > 100_000);
  const maximumResponse = await request("/groceries/planning", { plan: maximum, expectedRevision: planningRevision }); assert.equal(maximumResponse.status, 200); const maximumSaved = await maximumResponse.json(); planningRevision = maximumSaved.revision;
  assert.deepEqual(maximumSaved, { ...maximum, revision: planningRevision });
  const overLimit = structuredClone(maximumSaved); overLimit.items.push({ ...overLimit.items[0], id: "synthetic-over-limit" });
  assert.equal((await request("/groceries/planning", { plan: overLimit, expectedRevision: planningRevision })).status, 400);
  // The existing streaming bound can reject with HTTP 400 or close the oversized stream.
  await request("/groceries/planning", { plan: maximumSaved, expectedRevision: planningRevision, padding: "x".repeat(10_000_000) }, { Connection: "close" }).then(response => assert.equal(response.status, 400), error => {
    assert.equal(error.message, "fetch failed"); assert.ok(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(error.cause?.code));
  });
  assert.deepEqual(await (await request("/groceries/planning")).json(), maximumSaved);
  assert.equal((await request("/groceries/research", { product: "oats", area: "123 exact address", confirmed: true })).status, 400);
  const r = (await (await request("/groceries/import", { sources: [source("Synthetic API receipt")] })).json()).record;
  const reviewed = await request(`/groceries/${r.id}/review`, { receipt, expectedRevision: r.revision, save: true, confirmed: true }); assert.equal(reviewed.status, 200); assert.equal(reviewed.headers.get("cache-control"), "no-store");
  assert.equal((await request(`/groceries/${r.id}/review`, { receipt, expectedRevision: r.revision, save: true, confirmed: true })).status, 409);
  const bytes = await (await request(`/groceries/${r.id}/sources/${r.sources[0].hash}`)).json(); assert.equal(Buffer.from(bytes.data, "base64").toString(), "Synthetic API receipt");
  const malformed = await fetch(`http://127.0.0.1:${port}/groceries/import`, { method: "POST", headers: { "x-familyhub-key": key }, body: "{private-source-content" }); assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes("private-source-content"));
  await stop(); await start(); assert.equal((await (await request("/groceries")).json()).records[0].status, "saved");
  assert.equal((await (await request("/groceries/planning")).json()).revision, planningRevision);
  assert.deepEqual((await (await request("/groceries/planning")).json()), maximumSaved);
  // Startup logs predate this module; never output private source text from a Courses route.
  await stop(); assert.equal(leakedSource, false);
});
