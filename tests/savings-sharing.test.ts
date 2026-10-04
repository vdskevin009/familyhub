import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SavingsLibrary, SavingsConflict } from "../apps/worker/src/savings-library.ts";
import { newContract } from "../apps/worker/src/savings-model.ts";
import { mergeSharedContracts, contractSignature, validateContract } from "../apps/worker/src/savings-sharing-model.ts";
const draft = (id = "synthetic") => ({ ...newContract("telecom", id), name: "Synthetic contract", updatedAt: "2026-10-03T12:00:00Z", notes: "PRIVATE SYNTHETIC NOTES" });
test("shared contracts and document bytes persist without replacing unrelated private data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fh-savings-sharing-")), path = join(dir, "library.json");
  try {
    await writeFile(join(dir, "invoices.json"), "PRIVATE SYNTHETIC DECISIONS");
    const library = new SavingsLibrary(path), contract = draft();
    const document = { id: "11111111-1111-4111-8111-111111111111", name: "synthetic.txt", type: "text/plain", size: 5, addedAt: contract.updatedAt };
    contract.documents = [document]; const bytes = { id: document.id, type: document.type, data: Buffer.from("hello").toString("base64") };
    const first = await library.import({ contracts: [contract], documents: [bytes] });
    assert.equal(first.records.length, 1); assert.equal(first.records[0].contract.price, null);
    assert.deepEqual(await new SavingsLibrary(path).list(), { records: first.records });
    assert.deepEqual(await new SavingsLibrary(path).document(document.id), bytes);
    assert.equal(await readFile(join(dir, "invoices.json"), "utf8"), "PRIVATE SYNTHETIC DECISIONS");
    const before = await readFile(path, "utf8");
    assert.deepEqual((await library.import({ contracts: [contract], documents: [bytes] })).records, first.records);
    assert.equal(await readFile(path, "utf8"), before);
    const conflict = await library.import({ contracts: [{ ...contract, notes: "different local version" }], documents: [bytes] });
    assert.deepEqual(conflict.conflicts, [contract.id]); assert.equal(await readFile(path, "utf8"), before);
    const results = await Promise.allSettled(["A", "B"].map(notes => library.update(contract.id, { contract: { ...contract, notes }, expectedRevision: first.records[0].revision, documents: [bytes] })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(results.some(result => result.status === "rejected" && result.reason instanceof SavingsConflict));
    assert.equal((await library.list()).records[0].contract.notes, "A");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("invalid imports and damaged storage never reset the shared library", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fh-savings-invalid-")), path = join(dir, "library.json"), library = new SavingsLibrary(path);
  try {
    await library.import({ contracts: [draft()], documents: [] }); const before = await readFile(path, "utf8");
    await assert.rejects(library.import({ contracts: [draft("new"), { ...draft(), price: "unknown" }], documents: [] }));
    await assert.rejects(library.import({ contracts: [{ ...draft("new"), documents: [{ id: "../private", type: "text/plain" }] }], documents: [] }));
    assert.equal(await readFile(path, "utf8"), before);
    await writeFile(path, "broken JSON");
    await assert.rejects(library.import({ contracts: [draft("new")], documents: [] }), /not reset/);
    assert.equal(await readFile(path, "utf8"), "broken JSON");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("a second device imports missing contracts and keeps its edits when versions differ", () => {
  const original = draft(), remote = { contract: original, revision: "first" };
  const phone = mergeSharedContracts([], [remote], {}); assert.deepEqual(phone.contracts, [original]);
  const changed = { ...original, price: 40 };
  assert.equal(mergeSharedContracts(phone.contracts, [{ contract: changed, revision: "second" }], phone.signatures).contracts[0].price, 40);
  const localEdit = { ...original, notes: "local decision" };
  const conflict = mergeSharedContracts([localEdit], [{ contract: changed, revision: "second" }], phone.signatures);
  assert.deepEqual(conflict.contracts, [localEdit]); assert.deepEqual(conflict.conflicts, [original.id]);
  assert.equal(conflict.signatures[original.id], contractSignature(original));
  assert.equal(Object.hasOwn(validateContract({ ...original, privateUnrelated: "not shared" }), "privateUnrelated"), false);
});
