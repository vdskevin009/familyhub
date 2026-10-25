import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { GroceryStore, validateSource } from "../apps/worker/dist/grocery-store.js";
import { emptyReceipt, blankItem, monthlySummary } from "../apps/worker/dist/grocery-model.js";

// Entirely fictional orders/messages. No authenticated API, browser, Gmail or live store is used.
const orderId = "900000000000001";
const source = text => validateSource({ name: "synthetic-gmail-excerpt.txt", type: "text/plain", data: Buffer.from(text).toString("base64") });
const receipt = reference => ({ ...emptyReceipt(), sourceType: "confirmation", store: "PC Express", reference,
  date: "2026-10-24", currency: "CAD", total: 12.34,
  items: [{ ...blankItem(), name: "Synthetic oats", product: "Synthetic oats", quantity: 2,
    evidence: "Synthetic confirmation: two units; price remains estimated." }], warnings: ["Synthetic estimated confirmation, not a final receipt."] });
function pair(reference = orderId, accountId = "synthetic@example.invalid") {
  return [
    { accountId, messageId: "a000000000000001", receivedAt: "2026-10-24T16:00:00.000Z", orderId: reference,
      kind: "confirmation", receipt: receipt(reference), source: source(`Synthetic confirmation for ${reference}`) },
    { accountId, messageId: "a000000000000002", receivedAt: "2026-10-25T00:00:17.000Z", orderId: reference,
      kind: "delivered", source: source(`Synthetic delivery for ${reference}`) }
  ];
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "fh-grocery-auto-"));
  t.after(async () => {
    const target = resolve(directory), allowed = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(allowed) && basename(target).startsWith("fh-grocery-auto-"));
    await rm(target, { recursive: true, force: true });
  });
  const groceries = join(directory, "groceries"), file = join(groceries, "purchases.json");
  const extractor = async () => { throw new Error("Automatic intake must not invoke an AI extractor."); };
  return { directory, groceries, file, store: new GroceryStore(groceries, extractor), restart: () => new GroceryStore(groceries, extractor) };
}
const bytes = file => readFile(file);
const digest = async file => createHash("sha256").update(await bytes(file)).digest("hex");
async function saveManual(store, value, text = "Synthetic manually reviewed receipt") {
  const imported = await store.import({ sources: [source(text)] });
  return store.review(imported.record.id, { receipt: value, expectedRevision: imported.record.revision, save: true, confirmed: true });
}

test("a delivered confirmation remains estimated, unreviewed by a human, and reloadable", async t => {
  const { store, restart, file } = await fixture(t);
  const result = await store.importDeliveredConfirmation(pair());
  assert.equal(result.outcome, "imported");
  assert.equal(result.record.status, "saved");
  assert.equal(result.record.reviewedAt, null);
  assert.equal(result.record.automaticImport.kind, "pc-express-gmail");
  assert.equal(result.record.receipt.fulfillment.date, "2026-10-24", "UTC delivery belongs to the previous Vancouver day");
  assert.equal(result.record.receipt.date, "2026-10-24");
  assert.equal(result.record.receipt.sourceType, "confirmation");
  assert.equal(result.record.receipt.total, 12.34);
  assert.equal(result.record.receipt.items[0].amount, null, "a missing final line amount does not become free or estimated paid money");
  assert.equal(monthlySummary([result.record], "2026-10").currencies.length, 0);
  const before = await digest(file);
  assert.deepEqual((await restart().list()).records, [result.record]);
  for (const meta of result.record.sources) assert.ok((await restart().source(result.record.id, meta.hash)).data);
  assert.equal(await digest(file), before, "reads and restart do not persist a migration");
});

test("concurrent and reordered repeats append exactly once and preserve bytes after readback", async t => {
  const { store, restart, file } = await fixture(t);
  const messages = pair();
  const results = await Promise.all([
    store.importDeliveredConfirmation(messages), store.importDeliveredConfirmation([...messages].reverse()),
    store.importDeliveredConfirmation(structuredClone(messages))
  ]);
  assert.equal(results.filter(x => x.outcome === "imported").length, 1);
  assert.equal(results.filter(x => x.outcome === "unchanged").length, 2);
  assert.equal(new Set(results.map(x => x.record.id)).size, 1);
  const before = await bytes(file);
  assert.equal((await restart().importDeliveredConfirmation(messages)).outcome, "unchanged");
  assert.deepEqual(await bytes(file), before, "retry following an uncertain prior result is byte-identical");
  const state = JSON.parse(before.toString());
  assert.equal(state.records.length, 1); assert.equal(state.sources.length, 2);
});

test("manual legacy order and its facts are protected even when fresh source hashes differ", async t => {
  const { store, file } = await fixture(t);
  const manual = await saveManual(store, { ...receipt(orderId), total: 21.45,
    items: [{ ...receipt(orderId).items[0], product: "Human corrected item", quantity: 3 }] });
  const state = JSON.parse((await bytes(file)).toString());
  state.records[0].unknownFutureField = { keep: "operator annotation" };
  state.futureCollection = { keep: true };
  await writeFile(file, JSON.stringify(state));
  const before = await bytes(file);
  const result = await store.importDeliveredConfirmation(pair());
  assert.equal(result.outcome, "unchanged"); assert.equal(result.record.id, manual.id);
  assert.equal(result.record.receipt.total, 21.45);
  assert.deepEqual(await bytes(file), before);
});

test("an old-client human correction latches protection without discarding automatic provenance", async t => {
  const { store, file, restart } = await fixture(t);
  const original = (await store.importDeliveredConfirmation(pair())).record;
  const oldClientReceipt = { ...original.receipt, total: 15.67 };
  delete oldClientReceipt.sourceType; // Existing client payload has no automaticImport field, either.
  const corrected = await store.review(original.id, { receipt: oldClientReceipt, expectedRevision: original.revision, confirmed: true, save: false });
  assert.ok(corrected.reviewedAt);
  assert.deepEqual(corrected.automaticImport, original.automaticImport);
  assert.notEqual(corrected.revision, original.revision);
  const before = await bytes(file);
  const retry = await restart().importDeliveredConfirmation(pair());
  assert.equal(retry.outcome, "unchanged"); assert.equal(retry.record.receipt.total, 15.67);
  assert.deepEqual(await bytes(file), before);
  await assert.rejects(store.review(original.id, { receipt: original.receipt, expectedRevision: original.revision, save: true, confirmed: true }));
  assert.deepEqual(await bytes(file), before, "stale correction is also non-mutating");
});

test("a queued human review wins before a concurrent automatic repeat", async t => {
  const { store, file } = await fixture(t);
  const original = (await store.importDeliveredConfirmation(pair())).record;
  const edit = store.review(original.id, { receipt: { ...original.receipt, total: 19.99 }, expectedRevision: original.revision, save: true, confirmed: true });
  const retry = store.importDeliveredConfirmation(pair());
  const reviewed = await edit;
  assert.equal((await retry).outcome, "unchanged");
  const state = JSON.parse((await bytes(file)).toString());
  assert.deepEqual(state.records, [reviewed]); assert.equal(state.sources.length, 2);
});

test("changed evidence for an automatically recorded order is a conflict, never replacement", async t => {
  const { store, file } = await fixture(t);
  const original = (await store.importDeliveredConfirmation(pair())).record;
  const changed = pair(); changed[0].receipt.total = 23.45;
  changed[0].messageId = "a000000000000003";
  changed[0].source = source("Synthetic contradictory revised estimate");
  const before = await bytes(file);
  const result = await store.importDeliveredConfirmation(changed);
  assert.equal(result.outcome, "conflict"); assert.deepEqual(result.record, original);
  assert.deepEqual(await bytes(file), before);
});

test("a reviewed order remains recognized after its store label is corrected", async t => {
  const { store, file } = await fixture(t);
  const manual = await saveManual(store, { ...receipt(orderId), store: "Human corrected merchant", sourceType: "final-receipt" });
  const before = await bytes(file);
  const result = await store.importDeliveredConfirmation(pair());
  assert.equal(result.outcome, "unchanged");
  assert.deepEqual(result.record, manual);
  assert.deepEqual(await bytes(file), before, "no automatic evidence or inferred corrections are attached");
});

test("ambiguous reviewed references and unreviewed drafts remain unresolved", async t => {
  const { store, file } = await fixture(t);
  const draft = await store.import({ sources: [source("Synthetic protected draft")] });
  await store.review(draft.record.id, { receipt: receipt(orderId), expectedRevision: draft.record.revision, save: false });
  let before = await bytes(file);
  assert.equal((await store.importDeliveredConfirmation(pair())).outcome, "conflict");
  assert.deepEqual(await bytes(file), before);
  const draftNow = (await store.list()).records[0];
  await store.review(draftNow.id, { receipt: draftNow.receipt, expectedRevision: draftNow.revision, save: true, confirmed: true });
  await saveManual(store, { ...receipt(orderId), total: 98.76 }, "Synthetic second conflicting reference");
  before = await bytes(file);
  assert.equal((await store.importDeliveredConfirmation(pair())).outcome, "conflict");
  assert.deepEqual(await bytes(file), before);
});

test("a second purchase appends without changing unrelated records, planning or invoices", async t => {
  const { store, directory, groceries, file } = await fixture(t);
  const unrelated = await saveManual(store, { ...receipt("Unrelated paper receipt"), store: "Synthetic independent store", sourceType: "final-receipt" });
  const state = JSON.parse((await bytes(file)).toString());
  state.records[0].unknownFutureField = ["retain", { original: true }];
  state.futureCollection = { keep: "unrelated metadata" };
  await writeFile(file, JSON.stringify(state));
  const planning = join(groceries, "planning.json"), invoices = join(directory, "invoices.json");
  await writeFile(planning, "{\"syntheticPlanning\": [3, 1, 4]}\n");
  await writeFile(invoices, "{\"syntheticInvoices\": [2, 7]}\n");
  const protectedBytes = await Promise.all([bytes(planning), bytes(invoices)]);
  const result = await store.importDeliveredConfirmation(pair());
  assert.equal(result.outcome, "imported");
  const after = JSON.parse((await bytes(file)).toString());
  assert.equal(after.records.length, 2);
  assert.deepEqual(after.records.find(r => r.id === unrelated.id), state.records[0]);
  assert.deepEqual(after.sources.filter(s => state.sources.some(old => old.hash === s.hash)), state.sources);
  assert.deepEqual(after.futureCollection, state.futureCollection);
  assert.deepEqual(await Promise.all([bytes(planning), bytes(invoices)]), protectedBytes);
});

test("mismatched or incomplete evidence fails before modifying an existing store", async t => {
  const { store, file } = await fixture(t);
  await saveManual(store, { ...receipt("safe"), store: "Synthetic independent store" });
  const before = await bytes(file);
  const cases = [
    messages => messages.slice(0, 1),
    messages => { messages[1].orderId = "900000000000002"; return messages; },
    messages => { messages[1].accountId = "other@example.invalid"; return messages; },
    messages => { messages[1].receivedAt = "2026-10-23T00:00:00.000Z"; return messages; },
    messages => { messages[1].messageId = messages[0].messageId; return messages; },
    messages => { messages[0].receivedAt = "missing date"; return messages; },
    messages => { messages[1].kind = "confirmation"; return messages; },
    messages => { messages[0].receipt.sourceType = "final-receipt"; return messages; },
    messages => { messages[0].receipt.total = null; return messages; },
    messages => { messages[0].receipt.items = []; return messages; },
    messages => { messages[0].receipt.currency = "USD"; return messages; },
    messages => { messages[1].source = messages[0].source; return messages; }
  ];
  for (const alter of cases) {
    await assert.rejects(store.importDeliveredConfirmation(alter(pair())));
    assert.deepEqual(await bytes(file), before);
  }
});

test("a reused source attached to another receipt cannot create a second purchase", async t => {
  const { store, file } = await fixture(t);
  const messages = pair();
  const draft = await store.import({ sources: [messages[0].source] });
  const before = await bytes(file);
  const result = await store.importDeliveredConfirmation(messages);
  assert.equal(result.outcome, "conflict"); assert.equal(result.record.id, draft.record.id);
  assert.deepEqual(await bytes(file), before);
});

test("corrupt stores fail closed and are never replaced with an automatic import", async t => {
  const { store, groceries, file } = await fixture(t);
  await mkdir(groceries, { recursive: true });
  await writeFile(file, '{"schema":1,"records":[invalid-json');
  const before = await bytes(file);
  await assert.rejects(store.importDeliveredConfirmation(pair()), /illisible/);
  assert.deepEqual(await bytes(file), before);
});

test("saved records cannot claim automatic validation with missing or malformed provenance", async t => {
  const { store, restart, file } = await fixture(t);
  await store.importDeliveredConfirmation(pair());
  const original = JSON.parse((await bytes(file)).toString());
  for (const modify of [
    state => { delete state.records[0].automaticImport; },
    state => { state.records[0].automaticImport.sourceMessageIds = []; },
    state => { state.records[0].receipt.sourceType = "final-receipt"; },
    state => { delete state.records[0].receipt.fulfillment; }
  ]) {
    const state = structuredClone(original); modify(state);
    await writeFile(file, JSON.stringify(state));
    const before = await bytes(file);
    await assert.rejects(restart().list(), /illisible/);
    assert.deepEqual(await bytes(file), before);
  }
});
