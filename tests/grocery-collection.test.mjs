import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GroceryCollection } from "../apps/worker/dist/grocery-collection.js";
import { validateSource } from "../apps/worker/dist/grocery-store.js";
import { emptyReceipt } from "../apps/worker/dist/grocery-model.js";
import { atomicJson } from "../apps/worker/dist/private-store.js";

const account = "synthetic@example.test", other = "other@example.test";
const order = "531900000000001";
const instant = "2026-10-25T20:00:00.000Z";
function observation(id, kind, accountId = account, orderId = order) {
  const source = validateSource({ name: `PC Express structured excerpt ${id}.txt`, type: "text/plain", data: Buffer.from(`SYNTHETIC ${kind} ${orderId} ${id}`).toString("base64") });
  return { accountId, messageId: id, receivedAt: "2026-10-24T20:00:00.000Z", orderId, kind, source,
    ...(kind === "confirmation" ? { receipt: { ...emptyReceipt(), sourceType: "confirmation", reference: orderId, store: "PC Express", date: "2026-10-24", currency: "CAD", total: 12,
      items: [{ name: "Synthetic oats", product: "Synthetic oats", amount: null, quantity: 1, size: null, unit: null, evidence: "Synthetic original estimated item", uncertain: true }], warnings: ["Estimated only"] } } : {}) };
}
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "familyhub-grocery-collection-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = new Date(instant), listed = ["c1", "d1"], failure = null, parseFailure = null;
  const messages = new Map([["c1", observation("c1", "confirmation")], ["d1", observation("d1", "delivered")]]);
  const requests = [], imports = [], stored = new Set();
  const deps = {
    credentials: async () => ({ accounts: [{ email: account, label: "Synthetic", clientId: "synthetic", clientSecret: "synthetic", refreshToken: "synthetic" }] }),
    accessToken: async value => value.email,
    gmail: async (token, path) => {
      requests.push({ token, path });
      if (failure) throw new Error(failure);
      if (path.startsWith("messages?")) return { messages: listed.map(id => ({ id })) };
      return { id: decodeURIComponent(path.slice("messages/".length).split("?")[0]) };
    },
    parse: raw => { if (raw.id === parseFailure) throw new Error("private subject/token must not escape"); return messages.get(raw.id) || null; },
    now: () => now,
    ...overrides,
  };
  const store = { importDeliveredConfirmation: async input => {
    imports.push(structuredClone(input));
    const id = input[0].orderId;
    if (stored.has(id)) return { outcome: "unchanged" };
    stored.add(id); return { outcome: "imported" };
  } };
  const create = (extra = {}, alternative = store) => new GroceryCollection(directory, alternative, { ...deps, ...extra });
  return { directory, create, requests, imports, stored, messages, store,
    list: values => { listed = values; }, setNow: value => { now = new Date(value); }, fail: value => { failure = value; }, failParse: id => { parseFailure = id; },
    disk: async () => JSON.parse(await readFile(join(directory, "collection-status.json"), "utf8")) };
}

test("status GET creates no file and returns no source bytes or credentials", async t => {
  const f = await fixture(t), status = await f.create().status();
  assert.equal(status.busy, false); assert.equal(status.incomplete, false);
  assert.deepEqual(await readdir(f.directory), []); assert.equal(f.requests.length, 0);
});

test("paired evidence imports once, remains a confirmation and overlapping scans deduplicate source IDs", async t => {
  const f = await fixture(t), first = await f.create().collect();
  assert.equal(first.busy, false); assert.equal(first.incomplete, false); assert.equal(first.counts.imported, 1);
  assert.equal(first.lastSuccess, instant); assert.equal(first.lastImportedAt, instant);
  assert.equal(f.imports[0][0].receipt.sourceType, "confirmation");
  assert.equal(first.accounts[0].pendingMessages, 0);
  const second = await f.create().collect();
  assert.equal(f.imports.length, 1); assert.equal(second.counts.imported, 0);
  assert.equal(f.requests.filter(request => request.path.includes("?format=full")).length, 2);
  const publicStatus = JSON.stringify(second);
  assert.doesNotMatch(publicStatus, /SYNTHETIC|base64|clientSecret|refreshToken|c1|d1/);
  const query = new URLSearchParams(f.requests[0].path.split("?")[1]).get("q");
  assert.match(query, /-in:sent -in:drafts -in:spam -in:trash/);
  assert.match(query, new RegExp(`after:${Math.floor(Date.parse(instant) / 1000) - 30 * 86400}`));
});

test("bounded pagination freezes the window across restart and does not import an early pair", async t => {
  const f = await fixture(t, { maxPages: 1 });
  const queries = [];
  const gmail = async (_token, path) => {
    if (!path.startsWith("messages?")) return { id: path.split("/")[1].split("?")[0] };
    const params = new URLSearchParams(path.split("?")[1]); queries.push(params);
    return params.get("pageToken") ? { messages: [] } : { messages: [{ id: "c1" }, { id: "d1" }], nextPageToken: "page-2" };
  };
  const first = await f.create({ gmail }).collect();
  assert.equal(first.incomplete, true); assert.equal(first.lastSuccess, undefined); assert.equal(f.imports.length, 0);
  assert.equal((await f.disk()).accounts[account].window.page, "page-2");
  f.setNow("2026-10-26T20:00:00.000Z");
  const second = await f.create({ gmail }).collect();
  assert.equal(second.incomplete, false); assert.equal(f.imports.length, 1);
  assert.equal(queries[0].get("q"), queries[1].get("q"));
  assert.equal(queries[1].get("pageToken"), "page-2");
  assert.equal(JSON.stringify(second).includes("page-2"), false);
});

test("a failed source leaves the entire page pending state and cursor untouched; retry is bounded and sanitized", async t => {
  const f = await fixture(t); f.failParse("d1");
  const first = await f.create().collect(), disk = await f.disk();
  assert.equal(first.incomplete, true); assert.equal(first.accounts[0].error, "source-review-required");
  assert.equal(first.lastSuccess, undefined); assert.equal(first.accounts[0].pendingMessages, 0);
  assert.deepEqual(disk.accounts[account].seen, {}); assert.equal(disk.accounts[account].window.page, undefined);
  assert.equal(f.imports.length, 0); assert.doesNotMatch(JSON.stringify(disk), /private subject|token must/);
  f.failParse(null); const second = await f.create().collect();
  assert.equal(second.counts.imported, 1); assert.equal(second.incomplete, false);
});

test("pending confirmation survives beyond the lookback and joins a later delivery", async t => {
  const f = await fixture(t); f.list(["c1"]);
  const first = await f.create().collect(); assert.equal(first.accounts[0].pendingOrders, 1); assert.equal(f.imports.length, 0);
  f.setNow("2026-12-15T20:00:00.000Z"); f.list(["d1"]);
  const second = await f.create().collect(); assert.equal(second.counts.imported, 1); assert.equal(f.imports[0].length, 2);
});

test("two accounts cannot combine their confirmation and delivery", async t => {
  const f = await fixture(t); f.messages.set("d1", observation("d1", "delivered", other));
  const credentials = async () => ({ accounts: [account, other].map(email => ({ email, label: "Synthetic", clientId: "synthetic", clientSecret: "synthetic", refreshToken: "synthetic" })) });
  const gmail = async (token, path) => path.startsWith("messages?") ? { messages: [{ id: token === account ? "c1" : "d1" }] } : { id: path.split("/")[1].split("?")[0] };
  const status = await f.create({ credentials, gmail }).collect();
  assert.equal(f.imports.length, 0); assert.equal(status.accounts.length, 2); assert.deepEqual(status.accounts.map(value => value.pendingMessages), [1, 1]);
});

test("store conflict preserves evidence and last success while new coverage remains reachable", async t => {
  const f = await fixture(t); f.list([]); await f.create().collect();
  f.setNow("2026-10-26T20:00:00.000Z"); f.list(["c1", "d1"]);
  const status = await f.create({}, { importDeliveredConfirmation: async () => ({ outcome: "conflict" }) }).collect();
  assert.equal(status.incomplete, true); assert.equal(status.lastSuccess, instant); assert.equal(status.counts.conflicts, 1);
  assert.equal(status.accounts[0].pendingMessages, 2); assert.equal(status.accounts[0].error, "review-required");
  assert.equal(status.accounts[0].window, undefined); assert.equal(status.accounts[0].through, Date.parse("2026-10-26T20:00:00.000Z") / 1000);
});

test("uncertain store result keeps the pair for idempotent replay after restart", async t => {
  const f = await fixture(t);
  const uncertainStore = { importDeliveredConfirmation: async messages => { await f.store.importDeliveredConfirmation(messages); throw new Error("private uncertain transport"); } };
  const first = await f.create({}, uncertainStore).collect();
  assert.equal(first.accounts[0].error, "store-unavailable"); assert.equal(first.accounts[0].pendingMessages, 2); assert.equal(first.lastSuccess, undefined);
  const second = await f.create().collect();
  assert.equal(second.counts.unchanged, 1); assert.equal(f.stored.size, 1); assert.equal(second.accounts[0].pendingMessages, 0); assert.equal(second.incomplete, false);
});

test("Gmail errors do not advance a watermark or expose upstream error details", async t => {
  const f = await fixture(t); f.fail("secret upstream account URL");
  const status = await f.create().collect(), disk = await f.disk();
  assert.equal(status.accounts[0].error, "gmail-unavailable"); assert.equal(status.accounts[0].through, undefined);
  assert.equal(status.lastSuccess, undefined); assert.ok(disk.accounts[account].window);
  assert.doesNotMatch(JSON.stringify(disk), /secret|upstream account/);
});

test("pending storage limit stops without evicting evidence or checkpointing its page", async t => {
  const f = await fixture(t, { maxPendingMessages: 1 });
  const status = await f.create().collect(), disk = await f.disk();
  assert.equal(status.accounts[0].error, "storage-limit"); assert.equal(status.incomplete, true);
  assert.equal(status.accounts[0].pendingMessages, 0); assert.deepEqual(disk.accounts[account].seen, {}); assert.ok(disk.accounts[account].window);
});

test("corrupt state fails closed and is not replaced", async t => {
  const f = await fixture(t), path = join(f.directory, "collection-status.json"), corrupt = '{"schema":1,"accounts":"broken"}';
  await writeFile(path, corrupt);
  const worker = f.create(); assert.equal(worker.isBusy(), false);
  await assert.rejects(worker.status(), /unreadable/); await assert.rejects(worker.collect(), /could not complete/);
  assert.equal(worker.isBusy(), false);
  assert.equal(await readFile(path, "utf8"), corrupt); assert.equal(f.requests.length, 0);
});

test("concurrent starts are rejected while status remains a read-only observation", async t => {
  const f = await fixture(t); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const worker = f.create({ accessToken: async () => { entered(); await held; return account; } });
  const run = worker.collect(); await started;
  assert.equal((await worker.status()).busy, true);
  await assert.rejects(worker.collect(), /already running/);
  release(); await run; assert.equal((await worker.status()).busy, false);
});

test("ambiguous order remains reviewable without preventing an independent complete order", async t => {
  const f = await fixture(t), next = "531900000000002";
  f.messages.set("c2", observation("c2", "confirmation"));
  f.messages.set("c3", observation("c3", "confirmation", account, next));
  f.messages.set("d3", observation("d3", "delivered", account, next));
  f.list(["c1", "c2", "d1", "c3", "d3"]);
  const status = await f.create().collect();
  assert.equal(status.counts.conflicts, 1); assert.equal(status.counts.imported, 1);
  assert.equal(status.accounts[0].pendingMessages, 3); assert.equal(status.accounts[0].error, "review-required");
  assert.equal(f.imports.length, 1); assert.equal(f.imports[0][0].orderId, next);
});

test("failed page persistence restores its cursor and staged evidence before recording failure", async t => {
  const f = await fixture(t); let failOnce = true;
  const write = async (path, state) => {
    if (failOnce && state.accounts[account]?.seen?.c1) { failOnce = false; throw new Error("synthetic interrupted write"); }
    await atomicJson(path, state);
  };
  const first = await f.create({ write }).collect(), disk = await f.disk();
  assert.equal(first.accounts[0].error, "store-unavailable"); assert.equal(first.accounts[0].through, undefined);
  assert.deepEqual(disk.accounts[account].seen, {}); assert.deepEqual(disk.accounts[account].pending, []);
  assert.ok(disk.accounts[account].window); assert.equal(f.imports.length, 0);
  const second = await f.create().collect(); assert.equal(second.counts.imported, 1);
});

test("a delivery before its confirmation remains reviewable without blocking another order", async t => {
  const f = await fixture(t), next = "900000000000002";
  f.messages.get("d1").receivedAt = "2026-10-23T20:00:00.000Z";
  f.messages.set("c2", observation("c2", "confirmation", account, next));
  f.messages.set("d2", observation("d2", "delivered", account, next));
  f.list(["c1", "d1", "c2", "d2"]);
  const status = await f.create().collect();
  assert.equal(status.counts.conflicts, 1); assert.equal(status.counts.imported, 1);
  assert.equal(status.accounts[0].error, "review-required"); assert.equal(status.accounts[0].pendingMessages, 2);
  assert.equal(f.imports[0][0].orderId, next);
});

test("failed post-import persistence retains the durable pair and replay cannot duplicate the purchase", async t => {
  const f = await fixture(t); let failOnce = true;
  const write = async (path, state) => {
    if (failOnce && state.lastImportedAt) { failOnce = false; throw new Error("synthetic post-import interruption"); }
    await atomicJson(path, state);
  };
  const first = await f.create({ write }).collect();
  assert.equal(first.accounts[0].pendingMessages, 2); assert.equal(first.lastSuccess, undefined); assert.equal(f.stored.size, 1);
  const second = await f.create().collect(); assert.equal(second.counts.unchanged, 1); assert.equal(f.stored.size, 1);
});

test("an early persistence failure cannot present the previous successful run as current success", async t => {
  const f = await fixture(t); f.list([]); await f.create().collect();
  f.setNow("2026-10-26T20:00:00.000Z");
  const previous = await readFile(join(f.directory, "collection-status.json"), "utf8");
  const worker = f.create({ write: async () => { throw new Error("private filesystem detail"); } });
  await assert.rejects(worker.collect(), /could not complete/);
  const status = await worker.status();
  assert.equal(status.busy, false); assert.equal(status.incomplete, true); assert.equal(status.error, "store-unavailable");
  assert.equal(status.lastSuccess, instant); assert.equal(status.lastAttempt, "2026-10-26T20:00:00.000Z");
  assert.equal(await readFile(join(f.directory, "collection-status.json"), "utf8"), previous);
  assert.doesNotMatch(JSON.stringify(status), /filesystem|private/);
});

test("global state size is bounded across accounts and cannot save an unreadable next state", async t => {
  const f = await fixture(t);
  const credentials = async () => ({ accounts: [account, other].map(email => ({ email, label: "Synthetic", clientId: "synthetic", clientSecret: "synthetic", refreshToken: "synthetic" })) });
  const ids = email => Array.from({ length: 4 }, (_, index) => `${email === account ? "a" : "b"}${index}`);
  for (const email of [account, other]) for (const [index, id] of ids(email).entries()) {
    const message = observation(id, "confirmation", email, `53190000000000${index + 1}`);
    message.source = validateSource({ name: "Synthetic bounded source.txt", type: "text/plain", data: Buffer.from(`${id}${"x".repeat(3_000_000)}`).toString("base64") });
    f.messages.set(id, message);
  }
  const gmail = async (token, path) => path.startsWith("messages?") ? { messages: ids(token).map(id => ({ id })) } : { id: path.split("/")[1].split("?")[0] };
  const status = await f.create({ credentials, gmail }).collect();
  assert.equal(status.incomplete, true); assert.equal(status.accounts[1].error, "storage-limit");
  assert.equal(status.accounts[0].pendingMessages, 4); assert.equal(status.accounts[1].pendingMessages, 0);
  assert.ok(Buffer.byteLength(await readFile(join(f.directory, "collection-status.json"), "utf8")) < 32_000_000);
  assert.equal((await f.create().status()).accounts[0].pendingMessages, 4);
});
