import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { FinanceLibrary } from "../apps/worker/src/finance-library.ts";
import { validateFinanceState } from "../apps/worker/src/finance-validation.ts";
import { latestBalanceObservation, archivedFinanceCollection } from "../apps/worker/src/finance-observations.ts";
import { financeFixture } from "./finance-fixture.mjs";
import { observationsFixture } from "./finance-observations-fixture.mjs";
const digest = raw => createHash("sha256").update(raw).digest("hex");
async function fixture(fn) {
 const dir = await mkdtemp(join(tmpdir(), "familyhub-observations-"));
 try { const lib = new FinanceLibrary(dir); await lib.import({ bundle: financeFixture(), apply: true, expectedRevision: "empty" }); await fn(lib, dir); }
 finally { await rm(dir, { recursive: true, force: true }); }
}
test("source-only observations preserve all historical facts and metadata, preview is read-only and replay does not invent a capture", () => fixture(async (lib, dir) => {
 let before = await lib.read(); before = await lib.decide({ expectedRevision: before.revision, id: "groceries", decision: { nature: "expense", category: "groceries", note: "Synthetic manual authority" } });
 const bundle = observationsFixture(before), bytes = await readFile(join(dir, "ledger.json"), "utf8"), files = await readdir(dir);
 const preview = await lib.import({ bundle }); assert.equal(preview.added, 0); assert.equal(preview.balanceObservations, 2); assert.equal(preview.capability, "finance-balance-observations-v1"); assert.deepEqual(await readdir(dir), files); assert.equal(await readFile(join(dir, "ledger.json"), "utf8"), bytes);
 const applied = await lib.import({ bundle, apply: true, expectedRevision: before.revision }), after = applied.state;
 const { balanceObservations, ...unchanged } = after.data; assert.equal(balanceObservations.length, 2); assert.deepEqual(unchanged, before.data); assert.deepEqual(after.decisions, before.decisions); assert.deepEqual(after.decisionHistory, before.decisionHistory);
 assert.deepEqual(after.imports.at(-1).collection, bundle.collection); assert.equal(after.data.collectedOn, before.data.collectedOn);
 assert.equal(latestBalanceObservation(after.data, "bank").balanceCents, 123456); assert.equal(latestBalanceObservation(after.data, "gic"), undefined);
 assert.deepEqual((await new FinanceLibrary(dir).read()).data, after.data);
 const replay = await lib.import({ bundle, apply: true, expectedRevision: before.revision }); assert.equal(replay.alreadyImported, true); assert.deepEqual(replay.state, after);
 const savedBytes = await readFile(join(dir, "ledger.json"), "utf8"); await lib.read(); assert.equal(await readFile(join(dir, "ledger.json"), "utf8"), savedBytes);
}));
test("older observations are retained without replacing the newest value; same-time contradictions stop atomically", () => fixture(async lib => {
 let state = await lib.read(); const first = observationsFixture(state); state = (await lib.import({ bundle: first, apply: true, expectedRevision: state.revision })).state;
 const older = observationsFixture(state, "2026-10-31T12:34:56Z"); older.balanceObservations[0].balanceCents = -999;
 state = (await lib.import({ bundle: older, apply: true, expectedRevision: state.revision })).state; assert.equal(state.data.balanceObservations.length, 4); assert.equal(latestBalanceObservation(state.data, "bank").balanceCents, 123456);
 const provenanceConflict = observationsFixture(state); provenanceConflict.balanceObservations[0].source.sha256 = "c".repeat(64);
 await assert.rejects(() => lib.import({ bundle: provenanceConflict }), /Conflicting balances/); assert.deepEqual(await lib.read(), state);
 const conflict = observationsFixture(state); conflict.balanceObservations[0].balanceCents++;
 await assert.rejects(() => lib.import({ bundle: conflict, apply: true, expectedRevision: state.revision }), /Conflicting balances/); assert.deepEqual(await lib.read(), state);
}));
test("source-only import rejects hidden changes, invalid timestamps, unknown identities, currencies and missing provenance", () => fixture(async lib => {
 const state = await lib.read();
 const changes = [b => b.accounts[0].observedBalanceCents++, b => b.accounts[0].alias = "Changed", b => b.accounts[0].observedOn = "2030-01-01", b => b.bankActivities.push(financeFixture().bankActivities[0]), b => b.coverage.push({ accountId: "bank", earliest: "2026-01-01", latest: "2030-01-01" }), b => b.pendingActivities.push({}), b => b.limits.push("Unapproved"), b => b.balanceObservations[0].accountId = "unknown", b => b.balanceObservations[0].currency = "USD", b => b.balanceObservations[0].source = "missing digest", b => b.balanceObservations[0].sourceAsOf = "2031-01-01", b => b.balanceObservations[0].capturedAt = "2030-04-01", b => b.balanceObservations[0].capturedAt = "2030-04-01T12:34:56", b => b.balanceObservations[0].capturedAt = "2030-02-30T12:34:56Z", b => b.collection.accountIds = ["bank"], b => { b.collection.retrievedAt = "2099-01-01T00:00:00Z"; for (const o of b.balanceObservations) o.capturedAt = b.collection.retrievedAt; }, b => b.balanceObservations = [], b => b.importMode = "unknown", b => b.balanceObservations.push(b.balanceObservations[0])];
 for (const change of changes) { const bundle = observationsFixture(state); change(bundle); await assert.rejects(() => lib.import({ bundle, apply: true, expectedRevision: state.revision })); assert.deepEqual(await lib.read(), state); }
}));
test("legacy archive recovers a hash-verified latest capture only and never writes on read", () => fixture(async (lib, dir) => {
 const state = await lib.read(), bundle = financeFixture(); bundle.pluginEvidence = { schema: "familyhub.finances-plugin-evidence.v1", retrievedAt: "2026-11-01T12:34:56Z", plan: { retrievedAt: "2026-11-01T12:34:56Z", accounts: Object.fromEntries(bundle.accounts.map((a, i) => ["synthetic-" + i, a.accountId])) } };
 const raw = JSON.stringify(bundle), hash = digest(raw); state.imports.push({ hash, at: "2030-04-02T19:00:00Z", added: 0 });
 const bytes = JSON.stringify(state); await writeFile(join(dir, "ledger.json"), bytes); await writeFile(join(dir, "sources", hash + ".json"), raw);
 assert.equal((await lib.read()).imports.at(-1).collection.retrievedAt, bundle.pluginEvidence.retrievedAt); assert.equal(await readFile(join(dir, "ledger.json"), "utf8"), bytes);
 await writeFile(join(dir, "sources", hash + ".json"), raw + " "); assert.equal((await lib.read()).imports.at(-1).collection, null);
 await rm(join(dir, "sources", hash + ".json")); assert.equal((await lib.read()).imports.at(-1).collection, null);
 assert.equal(archivedFinanceCollection({ ...bundle, pluginEvidence: { ...bundle.pluginEvidence, retrievedAt: "2030-04-01" } }, state.data.accounts.map(a => a.id)), null);
}));
test("new collection without timestamp does not reuse an earlier date and malformed saved observations fail closed", () => fixture(async lib => {
 let state = await lib.read(); state = (await lib.import({ bundle: observationsFixture(state), apply: true, expectedRevision: state.revision })).state;
 const legacy = financeFixture(); legacy.unrelatedExtension = "synthetic later import"; state = (await lib.import({ bundle: legacy, apply: true, expectedRevision: state.revision })).state;
 assert.equal(state.imports.at(-1).collection, null); assert.equal(state.data.balanceObservations.length, 2);
 const invalid = structuredClone(state); invalid.data.balanceObservations[0].capturedAt = "no date"; assert.throws(() => validateFinanceState(invalid));
 const futureHistorical = structuredClone(state.data); futureHistorical.accounts.find(a => a.id === "bank").asOf = "2031-01-01"; assert.equal(latestBalanceObservation(futureHistorical, "bank"), undefined);
}));

test("client capability check blocks old workers before preview or apply", async () => {
 const { importFinances } = await import("../apps/web/src/worker.ts");
 const original = globalThis.fetch, calls = [];
 globalThis.fetch = async (url, options) => { calls.push({ url, method: options?.method ?? "GET" }); return new Response(JSON.stringify({ capabilities: [] }), { status: 200 }); };
 try { for (const apply of [false, true]) await assert.rejects(() => importFinances({ Endpoint: "https://synthetic.invalid", ApiKey: "synthetic-key" }, { importMode: "balance-observations-only" }, "synthetic", apply), /PC service/); assert.equal(calls.length, 2); assert(calls.every(c => c.url.endsWith("/health") && c.method === "GET")); }
 finally { globalThis.fetch = original; }
});

test("client refuses dropped preview or apply observations without retrying the POST", async () => {
 const { importFinances } = await import("../apps/web/src/worker.ts"), original = globalThis.fetch;
 const bundle = { importMode: "balance-observations-only", balanceObservations: [{ accountId: "bank", currency: "CAD", balanceCents: 100, capturedAt: "2026-11-01T12:34:56Z", sourceAsOf: null, source: { sha256: "b".repeat(64) } }] };
 const config = { Endpoint: "https://synthetic.invalid", ApiKey: "synthetic-key" };
 try {
  for (const apply of [false, true]) {
   let posts = 0; globalThis.fetch = async (url, init) => { if (init?.method === "POST") posts++; return new Response(JSON.stringify(url.endsWith("/health") ? { capabilities: ["finance-balance-observations-v1"] } : { added: 0, state: { data: {} } }), { status: 200 }); };
   await assert.rejects(() => importFinances(config, bundle, "synthetic", apply), /confirm/i); assert.equal(posts, 1);
  }
 } finally { globalThis.fetch = original; }
});
