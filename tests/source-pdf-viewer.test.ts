import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { viewWorkerAttachment } from "../apps/web/src/worker.ts";

const source = { Id: "synthetic-source", Attachments: [{ Id: "original", FileName: "original.PDF", MimeType: "application/octet-stream", Size: 40 }] };
const config = { Endpoint: "https://worker.example.test", ApiKey: "synthetic-key" };
function globalFixture(t: TestContext, name: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name));
}

test("PDF viewer reserves the popup before authenticated retrieval and isolates its opener", async t => {
  const events: string[] = [], viewer = { opener: {} as unknown, document: { title: "", body: { textContent: "" } }, location: { replace: (url: string) => events.push(url) }, close: () => events.push("close") };
  globalFixture(t, "window", { open: () => { events.push("open"); return viewer; }, setTimeout: () => 0 });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    events.push("fetch");
    assert.equal(url, "https://worker.example.test/invoices/synthetic-source/attachments/original");
    assert.equal((init?.headers as Record<string,string>)["x-familyhub-key"], "synthetic-key");
    return new Response("%PDF-1.4 synthetic");
  });
  t.mock.method(URL, "createObjectURL", blob => { assert.equal((blob as Blob).type, "application/pdf"); return "blob:synthetic"; });
  await viewWorkerAttachment(config, source, 0);
  await viewWorkerAttachment(config, source, 0);
  assert.equal(viewer.opener, null);
  assert.deepEqual(events, ["open", "fetch", "blob:synthetic", "open", "fetch", "blob:synthetic"]);
});

test("failed authorized retrieval closes its reserved viewer and surfaces the error", async t => {
  let closed = false;
  globalFixture(t, "window", { open: () => ({ opener: null, document: { body: {} }, close: () => { closed = true; } }) });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Source attachment unavailable" }, { status: 404 }));
  await assert.rejects(viewWorkerAttachment(config, source, 0), /Source attachment unavailable/);
  assert.equal(closed, true);
});

test("blocked mobile popup uses the download fallback after authorized retrieval", async t => {
  let clicked = false;
  globalFixture(t, "window", { open: () => null, setTimeout: () => 0 });
  globalFixture(t, "document", { createElement: () => ({ href: "", download: "", click: () => { clicked = true; }, remove: () => {} }), body: { appendChild: () => {} } });
  t.mock.method(globalThis, "fetch", async () => new Response("%PDF-1.4 synthetic"));
  t.mock.method(URL, "createObjectURL", () => "blob:synthetic");
  await viewWorkerAttachment(config, source, 0);
  assert.equal(clicked, true);
});
