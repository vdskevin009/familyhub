import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GroceryPurchaseResolutionStore } from "../apps/worker/dist/grocery-purchase-resolution-store.js";
import { blankItem, emptyReceipt, validateReceipt } from "../apps/worker/dist/grocery-model.js";
import { emptyPlan } from "../apps/worker/dist/grocery-planning.js";
import { purchaseLineKey } from "../apps/worker/dist/grocery-purchase-evidence.js";
const now = new Date("2026-10-29T12:00:00.000Z");
const makeRecord = (id, reference) => ({ id, revision: "r", status: "saved", extraction: "complete", reviewedAt: null, createdAt: now.toISOString(), duplicateOf: null, sources: [], receipt: { ...emptyReceipt(), sourceType: "confirmation", store: "PC Express synthetic", currency: "CAD", date: "2026-10-28", items: [{ ...blankItem(), name: "Synthetic grain", product: "Synthetic grain", quantity: 2, evidence: "Synthetic original line", ...(reference ? { productReference: { provider: "pcexpress", id: reference } } : {}) }] } });
const makeCandidate = (record, extra = {}) => ({ id: "candidate-" + record.id, recordId: record.id, lineIndex: 0, lineKey: purchaseLineKey(record.receipt.items[0]), product: "Synthetic grain", brand: "Synthetic brand", productId: "12345678_EA", itemId: null, size: 400, unit: "g", formatLabel: "400 g", formatBasis: "public-source", sourceUrl: "https://example.com/source", observedAt: "2026-10-28T12:00:00.000Z", note: "Synthetic current catalogue evidence; historical match not inferred", ...extra });
async function sandbox(run) { const dir = await mkdtemp(join(tmpdir(), "familyhub-purchase-resolution-")); try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
async function add(store, candidate) { const s = await store.read(); return store.mutate({ action: "add-candidates", candidates: [candidate], expectedRevision: s.revision }, now); }
async function confirm(store, id, extra = {}) { const s = await store.read(); return store.mutate({ action: "confirm", id, expectedRevision: s.revision, confirmed: true, ...extra }, now); }

test("candidate inspection is silent; explicit confirmation and undo preserve raw purchases and prices", () => sandbox(async dir => {
  const record = makeRecord("source"), library = { records: [record] }, plan = emptyPlan(), before = JSON.stringify({ library, plan });
  const store = new GroceryPurchaseResolutionStore(dir, async () => library, async () => plan), c = makeCandidate(record);
  let s = await add(store, c); assert.deepEqual(s.decisions, {});
  await assert.rejects(store.mutate({ action: "confirm", id: c.id, expectedRevision: s.revision }, now), /explicitement/);
  s = await confirm(store, c.id, { confirmationEvidence: { at: "2026-10-29T11:00:00.000Z", source: "Synthetic explicit user statement" } });
  assert.equal(s.decisions[c.id].state, "confirmed"); assert.equal(s.decisions[c.id].evidence.at, "2026-10-29T11:00:00.000Z");
  s = await store.mutate({ action: "unconfirm", id: c.id, expectedRevision: s.revision }, now);
  assert.equal(s.decisions[c.id].state, "unconfirmed"); assert.equal(s.candidates.length, 1);
  assert.equal(JSON.stringify({ library, plan }), before);
  assert.deepEqual(await new GroceryPurchaseResolutionStore(dir, async () => library, async () => plan).read(), s);
}));
test("source changes, stale revisions, future evidence and candidate replacement fail closed", () => sandbox(async dir => {
  const record = makeRecord("source"), store = new GroceryPurchaseResolutionStore(dir, async () => ({ records: [record] }), async () => emptyPlan()), c = makeCandidate(record);
  const s = await add(store, c);
  await assert.rejects(store.mutate({ action: "unconfirm", id: c.id, expectedRevision: "stale" }, now), /changé/);
  await assert.rejects(add(store, { ...c, size: 500 }), /remplacée/);
  await assert.rejects(add(store, { ...c, id: "future", observedAt: "2030-01-01T00:00:00.000Z" }), /future/);
  record.receipt.items[0].quantity = 3; await assert.rejects(confirm(store, c.id), /source a changé/);
  assert.deepEqual(await store.read(), s);
  const bytes = await readFile(join(dir, "purchase-resolution.json")); await writeFile(join(dir, "purchase-resolution.json"), "corrupt");
  await assert.rejects(store.read(), /conservé/); assert.equal(await readFile(join(dir, "purchase-resolution.json"), "utf8"), "corrupt"); assert.ok(bytes.length);
}));
test("future exact-reference reuse is bounded, deduplicated and reversible; names or another SKU never suffice", () => sandbox(async dir => {
  const source = makeRecord("source"), next = makeRecord("next", "12345678_EA"), nameOnly = makeRecord("name-only"), other = makeRecord("other", "87654321_EA");
  const library = { records: [source, next, nameOnly, other] }, before = JSON.stringify(library), store = new GroceryPurchaseResolutionStore(dir, async () => library, async () => emptyPlan()), c = makeCandidate(source);
  await add(store, c); await confirm(store, c.id); let s = await store.reconcile(now);
  const reused = s.candidates.find(x => x.recordId === next.id); assert.ok(reused); assert.equal(s.decisions[reused.id].state, "confirmed");
  assert.equal(s.candidates.some(x => [nameOnly.id, other.id].includes(x.recordId)), false);
  assert.equal((await store.reconcile(now)).revision, s.revision);
  s = await store.mutate({ action: "unconfirm", id: reused.id, expectedRevision: s.revision }, now);
  assert.equal((await store.reconcile(now)).decisions[reused.id].state, "unconfirmed");
  assert.equal(JSON.stringify(library), before);
}));
test("stale public formats, household assumptions, conflicting formats and changed raw sizes require review", () => sandbox(async dir => {
  const source = makeRecord("source"), next = makeRecord("next", "12345678_EA"), library = { records: [source, next] };
  for (const [name, extra] of [["stale", { observedAt: "2026-09-01T12:00:00.000Z" }], ["assumption", { formatBasis: "household-assumption" }], ["size-conflict", {}]]) {
    const folder = join(dir, name), store = new GroceryPurchaseResolutionStore(folder, async () => library, async () => emptyPlan()), c = makeCandidate(source, extra);
    if (name === "size-conflict") Object.assign(next.receipt.items[0], { size: 300, unit: "g" });
    await add(store, c); await confirm(store, c.id); const s = await store.reconcile(now), r = s.candidates.find(x => x.recordId === next.id);
    assert.ok(r); assert.equal(s.decisions[r.id], undefined); next.receipt.items[0].size = null; next.receipt.items[0].unit = null;
  }
  const second = makeRecord("second"), store = new GroceryPurchaseResolutionStore(join(dir, "ambiguous"), async () => ({ records: [source, second, next] }), async () => emptyPlan());
  await add(store, makeCandidate(source)); await confirm(store, "candidate-source"); await add(store, makeCandidate(second, { size: 500, formatLabel: "500 g" })); await confirm(store, "candidate-second");
  const s = await store.reconcile(now); assert.equal(s.candidates.filter(c => c.recordId === next.id).length, 2); assert.equal(s.candidates.filter(c => c.recordId === next.id).some(c => s.decisions[c.id]), false);
}));

test("withdrawing a source confirmation invalidates automatic reuse but preserves an explicit new-purchase decision", () => sandbox(async dir => {
  const source = makeRecord("source"), next = makeRecord("next", "12345678_EA"), manual = makeRecord("manual", "12345678_EA"), library = { records: [source,next,manual] };
  const store = new GroceryPurchaseResolutionStore(dir, async () => library, async () => emptyPlan());
  await add(store, makeCandidate(source)); await confirm(store,"candidate-source"); let state = await store.reconcile(now);
  const reused = state.candidates.find(c => c.recordId === next.id), reviewed = state.candidates.find(c => c.recordId === manual.id);
  await confirm(store,reviewed.id);
  state = await store.read(); await store.mutate({ action:"unconfirm", id:"candidate-source", expectedRevision:state.revision },now);
  state = await store.reconcile(now); assert.equal(state.decisions[reused.id].state,"unconfirmed"); assert.equal(state.decisions[reviewed.id].state,"confirmed");
  assert.ok(state.candidates.some(c => c.id === reused.id)); assert.equal((await store.reconcile(now)).revision,state.revision);
}));
test("explicit product references survive validation; legacy evidence keys stay stable and SKU changes invalidate bindings", () => {
  const old = makeRecord("source"), line = old.receipt.items[0], key = purchaseLineKey(line);
  assert.equal(JSON.parse(key).length, 8);
  line.productReference = { provider: "pcexpress", id: "12345678_EA" };
  assert.notEqual(purchaseLineKey(line), key); assert.deepEqual(validateReceipt(old.receipt).items[0].productReference, line.productReference);
  assert.equal(purchaseLineKey(line), purchaseLineKey({ ...line, productReference: { id: "12345678_EA", provider: "pcexpress" } }));
  assert.throws(() => validateReceipt({ ...old.receipt, items: [{ ...line, productReference: { provider: "other", id: "12345678_EA" } }] }));
});
