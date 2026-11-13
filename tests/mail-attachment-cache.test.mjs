import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile, unlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMailAttachmentCache, MAX_MAIL_ATTACHMENT_BYTES } from "../apps/worker/dist/mail-attachment-cache.js";
const bytes = Buffer.from([0, 255, 1, 42, 10, 128]);
const source = (patch = {}) => ({ account: "synthetic@example.test", messageId: "abcdef123456", attachmentId: "original-id", filename: "original.bin", mimeType: "application/octet-stream", size: bytes.length, ...patch });
async function fixture() {
  // Synthetic-only directories deliberately retained for inspection; no broad recursive cleanup.
  const directory = await mkdtemp(join(tmpdir(), "familyhub-mail-cache-test-"));
  return { directory, cache: createMailAttachmentCache(directory) };
}
async function save(cache, original = source(), content = bytes) { return cache.save(original, { ...original, bytes: content }); }

test("original binary bytes and exact metadata survive a new cache instance", async () => {
  const { directory, cache } = await fixture();
  const original = source({ attachmentId: "a".repeat(1500), filename: "../not-a-path\\original.exe" });
  const ref = await save(cache, original);
  assert.deepEqual(await createMailAttachmentCache(directory).readSource(original), bytes);
  assert.deepEqual(await cache.lookup(original), ref);
  assert.deepEqual(await cache.read(ref, original), bytes);
  assert.deepEqual(Object.keys(ref).sort(), [...Object.keys(original), "sha256"].sort());
  assert.equal((await readdir(directory)).length, 2);
  assert.ok((await readdir(directory)).every(name => /^[a-f0-9]{64}\.(bin|source.json)$/.test(name)));
});

test("parallel duplicate saves publish one immutable original and manifest", async () => {
  const { directory, cache } = await fixture();
  const refs = await Promise.all(Array.from({ length: 12 }, () => save(cache)));
  assert.ok(refs.every(ref => ref.sha256 === refs[0].sha256));
  assert.equal((await readdir(directory)).length, 2);
  const path = join(directory, refs[0].sha256 + ".bin"), before = await lstat(path);
  await save(cache);
  assert.equal((await lstat(path)).mtimeMs, before.mtimeMs);
});

test("source conflicts never overwrite originals, including concurrent conflicting saves", async () => {
  const { cache } = await fixture();
  const altered = Buffer.from(bytes); altered[0]++;
  const results = await Promise.allSettled([save(cache), save(cache, source(), altered)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const original = await cache.readSource(source());
  assert.ok(original.equals(bytes) || original.equals(altered));
  const other = original.equals(bytes) ? altered : bytes;
  await assert.rejects(save(cache, source(), other), /conflict/);
  assert.deepEqual(await cache.readSource(source()), original);
  await assert.rejects(save(cache, source({ filename: "changed.bin" })), /conflict/);
});

test("accounts, messages and attachments stay distinct even when bytes deduplicate", async () => {
  const { directory, cache } = await fixture();
  const a = source(), b = source({ account: "second@example.test" });
  const ref = await save(cache, a);
  await assert.rejects(cache.read(ref, b));
  await assert.rejects(cache.readSource(b));
  await save(cache, b);
  await save(cache, source({ messageId: "second-message" }));
  await save(cache, source({ attachmentId: "second-attachment" }));
  assert.equal((await readdir(directory)).filter(name => name.endsWith(".bin")).length, 1);
  assert.equal((await readdir(directory)).filter(name => name.endsWith(".source.json")).length, 4);
});

for (const [field, value] of [["account", "other@example.test"], ["messageId", "other"], ["attachmentId", "other"], ["filename", "other.bin"], ["mimeType", "image/png"], ["size", 5]]) {
  test(`save and read require exact ${field}`, async () => {
    const { directory, cache } = await fixture();
    await assert.rejects(cache.save(source(), { ...source({ [field]: value }), bytes }));
    assert.deepEqual(await readdir(directory), []);
    const ref = await save(cache);
    await assert.rejects(cache.read(ref, source({ [field]: value })));
    await assert.rejects(cache.readSource(source({ [field]: value })));
  });
}

test("reject malformed, oversized and traversal references without writes", async () => {
  const { directory, cache } = await fixture();
  for (const patch of [{ account: "UPPER@example.test" }, { messageId: "../outside" }, { attachmentId: "a".repeat(1501) },
    { size: -1 }, { size: 1.5 }, { size: MAX_MAIL_ATTACHMENT_BYTES + 1 }, { mimeType: "bad\r\nvalue" }, { filename: "x\0y" }]) {
    await assert.rejects(save(cache, source(patch)));
  }
  await assert.rejects(save(cache, source(), Buffer.from("wrong")));
  await assert.rejects(cache.read({ ...source(), sha256: "../outside" }, source()));
  assert.deepEqual(await readdir(directory), []);
  assert.throws(() => createMailAttachmentCache("../untrusted"));
});

test("accept empty and exactly maximum bytes, without MIME interpretation", async () => {
  const { cache } = await fixture();
  for (const length of [0, MAX_MAIL_ATTACHMENT_BYTES]) {
    const content = Buffer.alloc(length, 7), original = source({ attachmentId: `size-${length}`, size: length, mimeType: "image/png" });
    await save(cache, original, content);
    assert.deepEqual(await cache.readSource(original), content);
  }
});

test("caller mutation cannot alter a pending save or read result", async () => {
  const { cache } = await fixture();
  const expected = source(), actual = { ...source(), bytes: Buffer.from(bytes) };
  const pending = cache.save(expected, actual);
  expected.filename = "changed"; actual.bytes.fill(9); actual.account = "different@example.test";
  await pending;
  const result = await cache.readSource(source()); result.fill(8);
  assert.deepEqual(await cache.readSource(source()), bytes);
});

test("missing, truncated and same-length corrupt bytes fail closed, never replace corruption", async () => {
  const { directory, cache } = await fixture();
  const ref = await save(cache), path = join(directory, ref.sha256 + ".bin");
  for (const content of [Buffer.alloc(bytes.length, 9), Buffer.alloc(1)]) {
    await writeFile(path, content);
    await assert.rejects(cache.readSource(source()), /missing or corrupt/);
    await assert.rejects(save(cache), /missing or corrupt/);
    assert.deepEqual(await readFile(path), content);
  }
  await unlink(path);
  await assert.rejects(cache.readSource(source()), /missing or corrupt/);
});

test("missing and malformed manifests fail explicitly without network fallback", async () => {
  const { directory, cache } = await fixture();
  await assert.rejects(cache.readSource(source()), /missing, corrupt or conflicting/);
  await save(cache);
  const file = (await readdir(directory)).find(name => name.endsWith(".source.json"));
  for (const content of ["{}", "not-json", "x".repeat(17_000)]) {
    await writeFile(join(directory, file), content);
    await assert.rejects(cache.readSource(source()), /missing, corrupt or conflicting/);
    await assert.rejects(save(cache), /missing, corrupt or conflicting/);
    assert.equal(await readFile(join(directory, file), "utf8"), content);
  }
});

test("directories cannot masquerade as cached files", async () => {
  const { directory, cache } = await fixture();
  const ref = await save(cache), path = join(directory, ref.sha256 + ".bin");
  await unlink(path); await mkdir(path);
  await assert.rejects(cache.readSource(source()), /missing or corrupt/);
  await assert.rejects(save(cache));
});

test("manifest metadata or hash corruption cannot substitute source bytes", async () => {
  const { directory, cache } = await fixture();
  const ref = await save(cache);
  const file = (await readdir(directory)).find(name => name.endsWith(".source.json"));
  for (const patch of [{ account: "other@example.test" }, { filename: "changed.bin" }, { sha256: "../outside" }, { sha256: "0".repeat(64) }]) {
    await writeFile(join(directory, file), JSON.stringify({ schema: 1, reference: { ...ref, ...patch } }));
    await assert.rejects(cache.readSource(source()));
  }
});

test("save and missing-cache failures do not use a network fallback", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected network request"); };
  try {
    const { cache } = await fixture();
    await assert.rejects(cache.readSource(source()));
    await save(cache);
    assert.deepEqual(await cache.readSource(source()), bytes);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

for (const mimeType of ["image/png", "application/octet-stream"]) test(`unnamed ${mimeType} originals retain empty identity across restart`, async () => {
  const { directory, cache } = await fixture();
  const expected = source({ filename: "", mimeType });
  const reference = await save(cache, expected);
  assert.equal(reference.filename, "");
  assert.deepEqual(await cache.lookup(expected), reference);
  assert.deepEqual(await cache.read(reference, expected), bytes);
  const restarted = createMailAttachmentCache(directory);
  assert.deepEqual(await restarted.lookup(expected), reference);
  assert.deepEqual(await restarted.readSource(expected), bytes);
  assert.ok((await readdir(directory)).every(name => /^[a-f0-9]{64}\.(bin|source.json)$/.test(name)));
});

test("unnamed originals cannot be relabeled, cross-account substituted or replaced", async () => {
  const { cache } = await fixture();
  const expected = source({ filename: "", mimeType: "image/png" });
  const reference = await save(cache, expected);
  for (const patch of [{ filename: "invented.png" }, { mimeType: "image/jpeg" }, { account: "other@example.test" }]) {
    await assert.rejects(cache.read(reference, { ...expected, ...patch }));
    await assert.rejects(cache.readSource({ ...expected, ...patch }));
    await assert.rejects(cache.save(expected, { ...expected, ...patch, bytes }));
  }
  await assert.rejects(save(cache, { ...expected, filename: "invented.png" }), /conflict/);
  const changed = Buffer.from(bytes); changed[0]++;
  await assert.rejects(save(cache, expected, changed), /conflict/);
  assert.deepEqual(await cache.readSource(expected), bytes);
});

test("unnamed text originals are rejected without writes; named text stays supported", async () => {
  const { directory, cache } = await fixture();
  for (const mimeType of ["text/plain", "text/html", "TEXT/CSV"]) {
    const expected = source({ filename: "", mimeType });
    await assert.rejects(save(cache, expected), /Invalid mail attachment/);
    await assert.rejects(cache.lookup(expected), /Invalid mail attachment/);
    await assert.rejects(cache.readSource(expected), /Invalid mail attachment/);
  }
  assert.deepEqual(await readdir(directory), []);
  const named = source({ filename: "original.txt", mimeType: "text/plain" });
  await save(cache, named);
  assert.deepEqual(await cache.readSource(named), bytes);
});
