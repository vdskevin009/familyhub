import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { rememberMailSources, assertBrowserMailAllowed, assertBrowserMailBuildMode, createMailSourcePolicy } from "../apps/web/src/mail-source-policy.ts";
import { googleBridge, googleConnectionScopes } from "../apps/web/src/google.ts";
import { fetchInvoices, workerAttachmentBlob } from "../apps/web/src/worker.ts";

function fixture(t: TestContext, name: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name));
}
function storage(t: TestContext) {
  const values = new Map<string, string>();
  fixture(t, "localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  return values;
}
const config = { Endpoint: "https://paired.example.test", ApiKey: "synthetic-test-key" };
const original = new Uint8Array([0, 255, 12, 33]);
const item = { Id: "synthetic-document", AccountEmail: "source@example.test", AccountLabel: "Synthetic", SourceMessageId: "abcdef123456", WorkerManaged: true,
  ReceivedAt: "2026-11-01T00:00:00Z", Category: 0, DocumentType: "invoice", Attachments: [{ Id: "original-id", FileName: "original.bin", MimeType: "application/octet-stream", Size: original.length }] } as any;
async function connect(t: TestContext, account = item.AccountEmail, driveOnly = true) {
  let requestedScope = "";
  fixture(t, "window", { google: { accounts: { oauth2: { initTokenClient: (options: any) => {
    requestedScope = options.scope;
    return { requestAccessToken: () => options.callback({ access_token: "synthetic-not-real", expires_in: 3600,
      scope: driveOnly ? "https://www.googleapis.com/auth/drive.file" : "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly" }) };
  } } } } });
  t.mock.method(globalThis, "fetch", async () => Response.json({ email: account, name: "Synthetic" }));
  await googleBridge.connect(item.AccountLabel, undefined, driveOnly);
  t.after(() => googleBridge.disconnect(item.AccountLabel));
  return requestedScope;
}

test("trusted plugin selection persists by account, old snapshots cannot clear it, explicit legacy can", t => {
  storage(t);
  rememberMailSources([{ email: "source@example.test", sourceMode: "plugin" }]);
  assert.throws(() => assertBrowserMailAllowed("SOURCE@example.test"), /fallback is disabled/);
  assert.doesNotThrow(() => assertBrowserMailAllowed("other@example.test"));
  rememberMailSources([{ email: "source@example.test" }]);
  assert.throws(() => assertBrowserMailAllowed("source@example.test"));
  rememberMailSources([{ email: "source@example.test", sourceMode: "legacy" }]);
  assert.doesNotThrow(() => assertBrowserMailAllowed("source@example.test"));
});

test("malformed and inaccessible stored policy fail closed for the entire session", () => {
  for (const getItem of [() => "not-json", () => { throw new Error("denied"); }]) {
    const policy = createMailSourcePolicy(() => ({ getItem, setItem: () => {} }));
    assert.throws(() => policy.assertAllowed("source@example.test"), /disabled for this session/);
    assert.throws(() => policy.assertAllowed("other@example.test"), /disabled for this session/);
  }
});

test("failed policy persistence blocks all uncertain accounts even after storage recovers", () => {
  let fail = true;
  const policy = createMailSourcePolicy(() => ({ getItem: () => null, setItem: () => { if (fail) throw new Error("quota"); } }));
  assert.throws(() => policy.remember([{ email: "blocked@example.test", sourceMode: "plugin" }]), /disabled for this session/);
  for (const account of ["blocked@example.test", "unknown@example.test"]) assert.throws(() => policy.assertAllowed(account), /disabled for this session/);
  fail = false;
  policy.remember([{ email: "blocked@example.test", sourceMode: "legacy" }]);
  assert.throws(() => policy.assertAllowed("unknown@example.test"), /disabled for this session/);
});
test("authenticated invoice snapshot retains source mode and remembers plugin account restrictions", async t => {
  storage(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ sourceMode: "plugin", accounts: [{ email: item.AccountEmail, label: item.AccountLabel }], setupRequired: false }));
  const result = await fetchInvoices(config);
  assert.equal(result.sourceMode, "plugin"); assert.equal(result.accounts[0].sourceMode, "plugin");
  assert.throws(() => assertBrowserMailAllowed(item.AccountEmail));
});

test("plugin policy blocks browser scan and download without blocking Drive-only Google login", async t => {
  storage(t);
  rememberMailSources([{ email: item.AccountEmail, sourceMode: "plugin" }]);
  const scope = await connect(t);
  assert.ok(!scope.includes("gmail.readonly"));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("must not fetch Gmail"); });
  await assert.rejects(googleBridge.scan(item.AccountLabel, 12), /fallback is disabled/);
  await assert.rejects(googleBridge.downloadAttachment(item.AccountLabel, item.SourceMessageId, "original-id", "original.bin", "application/octet-stream", item.AccountEmail), /fallback is disabled/);
  assert.equal(calls, 0);
  assert.equal(googleBridge.connection(item.AccountLabel)?.canArchive, true);
});

test("worker-managed archive uploads exact paired original without any Gmail retrieval", async t => {
  storage(t); await connect(t);
  rememberMailSources([{ email: item.AccountEmail, sourceMode: "plugin" }]);
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input); requests.push(url);
    if (url.startsWith(config.Endpoint)) {
      assert.equal((init?.headers as Record<string,string>)["x-familyhub-key"], config.ApiKey);
      assert.ok(url.endsWith("/invoices/synthetic-document/attachments/original-id"));
      return new Response(original);
    }
    assert.ok(!url.includes("gmail.googleapis.com"));
    if (url.includes("/upload/drive/")) {
      const payload = Buffer.from(await (init?.body as Blob).arrayBuffer());
      assert.ok(payload.includes(Buffer.from(original)));
      return Response.json({ id: "synthetic-drive-file" });
    }
    return Response.json({ files: [{ id: "existing-synthetic-folder" }] });
  });
  const result = await googleBridge.archiveFirstAttachment(item, "Synthetic", async () => new Uint8Array(await (await workerAttachmentBlob(config, item, 0)).blob.arrayBuffer()));
  assert.equal(result.fileId, "synthetic-drive-file");
  assert.ok(requests[0].startsWith(config.Endpoint));
  assert.equal(requests.filter(url => url.includes("/upload/drive/")).length, 1);
});

test("missing callback, worker failure, size mismatch and wrong mailbox never create folders or upload", async t => {
  storage(t); await connect(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected external request"); });
  await assert.rejects(googleBridge.archiveFirstAttachment(item), /paired PC/);
  await assert.rejects(googleBridge.archiveFirstAttachment(item, "Synthetic", async () => { throw new Error("cache missing"); }), /cache missing/);
  await assert.rejects(googleBridge.archiveFirstAttachment(item, "Synthetic", async () => new Uint8Array(2)), /size does not match/);
  await assert.rejects(googleBridge.archiveFirstAttachment({ ...item, AccountEmail: "different@example.test" }, "Synthetic", async () => original), /does not match/);
  assert.equal(calls, 0);
});

test("unrelated legacy mailbox scan remains available", async t => {
  storage(t); await connect(t, "legacy@example.test", false);
  rememberMailSources([{ email: item.AccountEmail, sourceMode: "plugin" }]);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async input => { assert.ok(String(input).includes("gmail.googleapis.com")); calls++; return Response.json({ messages: [] }); });
  const result = await googleBridge.scan(item.AccountLabel, 1);
  assert.equal(result.email, "legacy@example.test"); assert.equal(calls, 1);
});

test("daily script gates validate policy through Node before scheduling or starting runtime", async () => {
  for (const [file, action] of [["Install-DailyCollection.ps1", "New-ScheduledTaskAction"], ["Run-DailyCollection.ps1", "$health = Get-WorkerHealth"]]) {
    const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    assert.ok(source.includes("mail-source-policy-cli.js"));
    assert.ok(!source.includes("gmail-credentials.dpapi"));
    assert.ok(source.indexOf("FAMILYHUB_WORKER_DATA") < source.indexOf("mail-source-policy-cli.js"));
    assert.ok(source.indexOf("if ($LASTEXITCODE -ne 0)") < source.indexOf(action));
  }
});

test("Drive-only connections cannot become implicit browser mail connections after unpairing", async t => {
  storage(t); await connect(t, "drive-only@example.test");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected Gmail request"); });
  await assert.rejects(googleBridge.scan(item.AccountLabel, 12), /Drive only/);
  assert.equal(calls, 0);
});

test("optional plugin-only build gate blocks fresh-browser Gmail; unset mode retains compatibility", () => {
  assert.doesNotThrow(() => assertBrowserMailBuildMode(undefined));
  assert.doesNotThrow(() => assertBrowserMailBuildMode(""));
  assert.throws(() => assertBrowserMailBuildMode("plugin-only"), /Pair and connect the PC/);
  for (const mode of ["unknown", "legacy", "PLUGIN-ONLY", null, false, {}]) {
    assert.throws(() => assertBrowserMailBuildMode(mode), /configuration is invalid/);
  }
});

test("daily source mode comparison happens before collection and never auto-restarts a mismatched process", async () => {
  const source = await readFile(new URL("../scripts/Run-DailyCollection.ps1", import.meta.url), "utf8");
  assert.ok(source.includes('$sourceSnapshot = Invoke-RestMethod "http://127.0.0.1:$Port/invoices"'));
  assert.ok(source.includes("$sourceSnapshot.sourceMode -ne 'plugin'"));
  assert.ok(source.includes("$sourceSnapshot.sourceMode -ne 'legacy'"));
  assert.ok(source.includes("finally { $pairingKey = $null }"));
  assert.ok(source.indexOf("does not match the validated policy") < source.indexOf("& $NodePath $collector"));
  assert.ok(!source.includes("Stop-Process"));
});

test("cancelling original retrieval prevents all later Drive requests", async t => {
  storage(t); await connect(t);
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("no Drive action after cancel"); });
  await assert.rejects(googleBridge.archiveFirstAttachment(item, "Synthetic", async () => { controller.abort(); return original; }, controller.signal));
  assert.equal(calls, 0);
});

test("cancellation between Drive folder reads prevents further folders and upload", async t => {
  storage(t); await connect(t);
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; controller.abort(); return Response.json({ files: [{ id: "synthetic-folder" }] }); });
  await assert.rejects(googleBridge.archiveFirstAttachment(item, "Unique cancellation root", async () => original, controller.signal));
  assert.equal(calls, 1);
});
test("cancelled Drive folder response cannot schedule a retry or upload", async t => {
  storage(t); await connect(t);
  const controller = new AbortController(); let calls = 0;
  fixture(t, "window", { setTimeout: (callback: () => void) => setTimeout(callback, 0) });
  t.mock.method(globalThis, "fetch", async () => {
    calls++; controller.abort();
    return Response.json({ error: { message: "rate limited" } }, { status: 429 });
  });
  await assert.rejects(googleBridge.archiveFirstAttachment(item, "Unique retry cancellation root", async () => original, controller.signal));
  assert.equal(calls, 1);
});
test("paired invoice data remains readable with a warning under get, parse and set failures; browser mail stays blocked", async t => {
  await connect(t, item.AccountEmail, false);
  for (const failure of ["get", "parse", "set"]) {
    fixture(t, "localStorage", {
      getItem: () => { if (failure === "get") throw new Error("storage denied"); return failure === "parse" ? "not-json" : null; },
      setItem: () => { if (failure === "set") throw new Error("quota"); }
    });
    let requests = 0;
    t.mock.method(globalThis, "fetch", async input => {
      requests++;
      assert.equal(String(input), config.Endpoint + "/invoices");
      return Response.json({ items: [item], sourceMode: "plugin", accounts: [{ email: item.AccountEmail, label: item.AccountLabel }], setupRequired: false });
    });
    const result = await fetchInvoices(config);
    assert.deepEqual(result.items, [item]);
    assert.equal(result.setupRequired, false);
    assert.match(result.sourcePolicyWarning!, /paired documents remain available/);
    await assert.rejects(googleBridge.scan(item.AccountLabel, 12), /disabled for this session/);
    assert.throws(() => assertBrowserMailAllowed("unknown@example.test"), /disabled for this session/);
    assert.equal(requests, 1);
  }
  // A later old-worker response and recovered storage cannot erase uncertainty.
  storage(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ items: [item] }));
  const legacyResult = await fetchInvoices(config);
  assert.equal(legacyResult.items.length, 1);
  assert.match(legacyResult.sourcePolicyWarning!, /disabled for this session/);
  assert.throws(() => assertBrowserMailAllowed("unknown@example.test"), /disabled for this session/);
});

test("fresh unpaired plugin-only build requests only identity and Drive; invalid build rejects before auth", async () => {
  const drive = "https://www.googleapis.com/auth/drive.file";
  const gmail = "https://www.googleapis.com/auth/gmail.readonly";
  for (const paired of [false, true]) assert.deepEqual(googleConnectionScopes(paired, "plugin-only").split(" "), ["openid", "email", "profile", drive]);
  assert.ok(googleConnectionScopes(false, "").split(" ").includes(gmail));
  assert.ok(!googleConnectionScopes(true, "").split(" ").includes(gmail));
  for (const mode of ["unknown", "PLUGIN-ONLY", null]) assert.throws(() => googleConnectionScopes(false, mode), /configuration is invalid/);
  const source = await readFile(new URL("../apps/web/src/google.ts", import.meta.url), "utf8");
  const connectSource = source.slice(source.indexOf("async function connect("));
  assert.ok(connectSource.indexOf("const requestedScopes = googleConnectionScopes(driveOnly)") < connectSource.indexOf("await ensureGoogleIdentity()"));
  assert.ok(connectSource.includes("scope: requestedScopes"));
});
