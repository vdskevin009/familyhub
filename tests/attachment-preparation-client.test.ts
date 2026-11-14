import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { workerAttachmentBlob, viewWorkerAttachment, downloadWorkerAttachment } from "../apps/web/src/worker.ts";
const config = { Endpoint: "https://paired.example.test", ApiKey: "synthetic-test-key" };
const item = { Id: "synthetic-source", Attachments: [{ Id: "original-id", FileName: "original.bin", MimeType: "application/octet-stream", Size: 4 }] };
const base = config.Endpoint + "/invoices/synthetic-source/attachments/original-id";
const original = new Uint8Array([0, 255, 12, 33]);
function fixture(t: TestContext, name: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name));
}
function fastPolling(t: TestContext) {
  const real = globalThis.setTimeout;
  let elapsed = 0;
  t.mock.method(globalThis, "setTimeout", ((callback: (...args: any[]) => void, delay: number, ...args: any[]) => {
    elapsed += delay;
    return real(callback, 0, ...args);
  }) as typeof setTimeout);
  return () => elapsed;
}
function cold() { return Response.json({ preparationRequired: true, error: "Prepare original" }, { status: 409 }); }
function health() { return Response.json({ capabilities: ["attachment-preparation-v1"] }); }

test("cold originals use one prepared job beyond 120 seconds and then source-bound bytes", async t => {
  const elapsed = fastPolling(t), deadlines: number[] = [], calls: Array<[string, string]> = [];
  let requestId = "";
  t.mock.method(AbortSignal, "timeout", (delay: number) => { deadlines.push(delay); return new AbortController().signal; });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input), method = init?.method || "GET"; calls.push([url, method]);
    assert.equal((init?.headers as Record<string,string>)["x-familyhub-key"], config.ApiKey);
    if (url === base) return cold();
    if (url.endsWith("/health")) return health();
    if (url.endsWith("/prepare")) { requestId = JSON.parse(String(init?.body)).requestId; return Response.json({ requestId, status: "pending" }, { status: 202 }); }
    if (url.includes("/preparations/")) return Response.json({ requestId, status: elapsed() >= 125_000 ? "ready" : "pending" });
    assert.equal(url, base + "?preparationRequestId=" + requestId);
    return new Response(original);
  });
  const result = await workerAttachmentBlob(config, item, 0);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), original);
  assert.ok(elapsed() >= 125_000);
  assert.equal(calls.filter(([, method]) => method === "POST").length, 1);
  assert.ok(deadlines.includes(13 * 60_000)); assert.ok(deadlines.includes(30_000));
});

test("lost prepare response is recovered with GET of the same ID, never another POST", async t => {
  let requestId = "", posts = 0, polls = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    if (url === base) return cold();
    if (url.endsWith("/health")) return health();
    if (url.endsWith("/prepare")) { posts++; requestId = JSON.parse(String(init?.body)).requestId; throw new Error("response lost"); }
    if (url.includes("/preparations/")) { polls++; assert.ok(url.endsWith(requestId)); return Response.json({ requestId, status: "ready" }); }
    assert.ok(url.endsWith(requestId)); return new Response(original);
  });
  await workerAttachmentBlob(config, item, 0);
  assert.equal(posts, 1); assert.equal(polls, 1);
});

test("explicit cancellation after pending status sends one cancel and never fetches bytes", async t => {
  fastPolling(t);
  const controller = new AbortController(); let requestId = "", cancels = 0, bytes = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    if (url === base) return cold();
    if (url.endsWith("/health")) return health();
    if (url.endsWith("/cancel")) { cancels++; assert.ok(url.includes(requestId)); return Response.json({ requestId, status: "cancelled" }); }
    if (url.endsWith("/prepare")) { requestId = JSON.parse(String(init?.body)).requestId; return Response.json({ requestId, status: "pending" }); }
    if (url.includes("/preparations/")) { controller.abort(); return Response.json({ requestId, status: "ready" }); }
    bytes++; return new Response(original);
  });
  await assert.rejects(workerAttachmentBlob(config, item, 0, controller.signal), /cancelled/);
  assert.equal(cancels, 1); assert.equal(bytes, 0);
});

test("overall deadline cancels the pending intent without another prepare", async t => {
  const deadline = new AbortController(); let requestId = "", cancels = 0, posts = 0;
  t.mock.method(AbortSignal, "timeout", (delay: number) => delay === 13 * 60_000 ? deadline.signal : new AbortController().signal);
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    if (url === base) return cold();
    if (url.endsWith("/health")) return health();
    if (url.endsWith("/cancel")) { cancels++; return Response.json({ requestId, status: "cancelled" }); }
    if (url.endsWith("/prepare")) { posts++; requestId = JSON.parse(String(init?.body)).requestId; deadline.abort(); return Response.json({ requestId, status: "pending" }); }
    throw new Error("unexpected bytes or status request");
  });
  await assert.rejects(workerAttachmentBlob(config, item, 0), /timed out/);
  assert.equal(posts, 1); assert.equal(cancels, 1);
});

for (const outcome of ["failed", "cancelled", "wrong-id"]) test(`terminal ${outcome} does not retry or download`, async t => {
  let requestId = "", posts = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    if (url === base) return cold();
    if (url.endsWith("/health")) return health();
    if (url.endsWith("/prepare")) { posts++; requestId = JSON.parse(String(init?.body)).requestId;
      return Response.json({ requestId: outcome === "wrong-id" ? "other" : requestId, status: outcome === "wrong-id" ? "ready" : outcome }); }
    throw new Error("must not download");
  });
  await assert.rejects(workerAttachmentBlob(config, item, 0)); assert.equal(posts, 1);
});

test("legacy/cached originals retain the fast GET without preparation or health dependence", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async input => { calls++; assert.equal(String(input), base); return new Response(original); });
  const result = await workerAttachmentBlob(config, item, 0);
  assert.equal(result.blob.size, 4); assert.equal(calls, 1);
});

test("closing the reserved viewer suppresses all late navigation and download", async t => {
  const viewer = { closed: false, opener: {} as unknown, document: { title: "", body: { textContent: "" } }, location: { replace: () => assert.fail("late navigation") }, close: () => {} };
  fixture(t, "window", { open: () => viewer, setTimeout: () => 0 });
  t.mock.method(globalThis, "fetch", async () => { viewer.closed = true; return new Response(original); });
  t.mock.method(URL, "createObjectURL", () => { assert.fail("must not create viewer or download URL"); return ""; });
  await assert.rejects(viewWorkerAttachment(config, item, 0), /closed/);
});

test("cancelled final response cannot trigger a download", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => { controller.abort(); return new Response(original); });
  fixture(t, "document", { createElement: () => assert.fail("must not start download") });
  await assert.rejects(downloadWorkerAttachment(config, item, 0, controller.signal), /cancelled/);
});
