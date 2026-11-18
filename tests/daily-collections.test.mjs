import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDailyCollections } from "../apps/worker/dist/daily-collections.js";
const tick = { pause: async () => {}, now: () => 0 };
const success = { busy: false, incomplete: false, lastSuccess: "2026-10-01T12:00:00.000Z", accounts: [] };

test("invoice failure does not suppress the separate grocery phase", async () => {
  const calls = [];
  let reads = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    calls.push(`${method} ${path}`);
    if (path === "/invoices") return { setupRequired: true };
    if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
    if (path === "/groceries/collection-status" && ++reads === 1) return {};
    return success;
  }, tick);
  assert.deepEqual(result, { invoices: "incomplete-or-unknown", groceries: "complete" });
  assert.equal(calls.filter(c => c === "POST /groceries/collect").length, 1);
  assert.equal(calls.includes("POST /invoices/collect"), false);
});

test("lost mutation response is never replayed and cannot report success", async () => {
  let starts = 0, invoiceReads = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path === "/invoices") return ++invoiceReads === 1 ? {} : success;
    if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
    if (method === "POST" && path === "/groceries/collect") { starts++; throw new Error("response lost"); }
    return success;
  }, tick);
  assert.equal(result.invoices, "complete");
  assert.equal(result.groceries, "incomplete-or-unknown");
  assert.equal(starts, 1);
});

test("only a completed error-free partial tranche permits the next POST", async () => {
  let starts = 0, reads = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path.startsWith("/invoices")) return {};
    if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
    if (method === "POST") { starts++; return { busy: true }; }
    reads++;
    if (reads === 1) return {};
    if (reads === 2) return { incomplete: true };
    if (reads === 3) return { busy: true };
    return success;
  }, tick);
  assert.equal(result.groceries, "complete"); assert.equal(starts, 2);
});

test("a stale success cannot validate a new run whose status write failed", async () => {
  let starts = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path.startsWith("/invoices")) return {};
    if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
    if (method === "POST") { starts++; return { busy: true }; }
    return success;
  }, tick);
  assert.equal(result.groceries, "incomplete-or-unknown"); assert.equal(starts, 1);
});

test("an inactive account's old error does not fail a new active-account success", async () => {
  let reads = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path.startsWith("/invoices")) return {};
    if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
    if (method === "POST") return {};
    return ++reads === 1 ? {} : { ...success, accounts: [{ active: false, error: "authorization-unavailable" }, { active: true }] };
  }, tick);
  assert.equal(result.groceries, "complete");
});

test("existing collection is observed without starting a second run", async () => {
  let reads = 0, starts = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path.startsWith("/invoices")) return {};
    if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
    if (method === "POST") { starts++; return {}; }
    return ++reads < 3 ? { busy: true } : success;
  }, tick);
  assert.equal(result.groceries, "complete"); assert.equal(starts, 0);
});

test("review conflicts or old worker capability cannot look like completed imports", async () => {
  for (const capable of [true, false]) {
    let starts = 0;
    const result = await runDailyCollections(async (path, method = "GET") => {
      if (path.startsWith("/invoices")) return {};
      if (path === "/health") return { capabilities: capable ? ["grocery-collection-v1"] : [] };
      if (method === "POST") { starts++; return {}; }
      return { ...success, accounts: [{ error: "review-required" }] };
    }, tick);
    assert.equal(result.groceries, "incomplete-or-unknown"); assert.equal(starts, capable ? 1 : 0);
  }
});

test("invoice continuation uses explicit current-worker readiness, never a hardcoded repair version", async () => {
  let reads = 0, starts = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path === "/invoices/collect") { starts++; return {}; }
    if (path === "/invoices") {
      reads++;
      if (reads === 1) return {};
      if (reads === 2) return { error: "Partial", continuationReady: true, progress: { account: { healthReceiptRepairVersion: 4 } } };
      return success;
    }
    return { setupRequired: true };
  }, tick);
  assert.equal(result.invoices, "complete"); assert.equal(starts, 2);
});

for (const phase of ["invoices", "groceries"]) {
  const statusPath = phase === "invoices" ? "/invoices" : "/groceries/collection-status";
  const collectPath = `/${phase}/collect`;
  const stale = { ...success, lastSuccess: "2026-09-01T12:00:00.000Z" };

  test(`${phase}: unrelated initial busy waits for idle then starts a verified collection`, async () => {
    let reads = 0, starts = 0;
    const result = await runDailyCollections(async (path, method = "GET") => {
      if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
      if (path === collectPath && method === "POST") {
        assert.equal(reads, 3, "no POST while unrelated operation is busy");
        starts++; return { busy: true };
      }
      if (path !== statusPath) return { setupRequired: true };
      reads++;
      if (reads < 3) return { ...stale, busy: true };
      if (reads === 3) return stale;
      return success;
    }, tick);
    assert.equal(result[phase], "complete"); assert.equal(starts, 1);
  });

  test(`${phase}: stale success after unrelated busy cannot silently complete`, async () => {
    let reads = 0, starts = 0;
    const result = await runDailyCollections(async (path, method = "GET") => {
      if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
      if (path === collectPath && method === "POST") { starts++; return {}; }
      if (path !== statusPath) return { setupRequired: true };
      return ++reads === 1 ? { ...stale, busy: true } : stale;
    }, tick);
    assert.equal(result[phase], "incomplete-or-unknown"); assert.equal(starts, 1);
  });

  test(`${phase}: lost POST after unrelated busy is never replayed`, async () => {
    let reads = 0, starts = 0;
    const result = await runDailyCollections(async (path, method = "GET") => {
      if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
      if (path === collectPath && method === "POST") { starts++; throw new Error("response lost"); }
      if (path !== statusPath) return { setupRequired: true };
      return ++reads === 1 ? { ...stale, busy: true } : stale;
    }, tick);
    assert.equal(result[phase], "incomplete-or-unknown"); assert.equal(starts, 1); assert.equal(reads, 2);
  });

  test(`${phase}: a fresh existing collection is adopted without a duplicate POST`, async () => {
    let reads = 0, starts = 0;
    const result = await runDailyCollections(async (path, method = "GET") => {
      if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
      if (path === collectPath && method === "POST") { starts++; return {}; }
      if (path !== statusPath) return { setupRequired: true };
      return ++reads === 1 ? { ...stale, busy: true } : success;
    }, tick);
    assert.equal(result[phase], "complete"); assert.equal(starts, 0);
  });

  test(`${phase}: changed success must be current and not precede the attempt`, async () => {
    for (const state of [success, { ...success, lastSuccess: "2026-10-02T12:00:00.000Z", lastAttempt: "2026-10-02T12:01:00.000Z" },
      { ...success, lastSuccess: "2026-10-02T12:00:00.000Z", lastAttempt: "invalid" }]) {
      let reads = 0, starts = 0;
      const result = await runDailyCollections(async (path, method = "GET") => {
        if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
        if (path === collectPath && method === "POST") { starts++; return {}; }
        if (path !== statusPath) return { setupRequired: true };
        return ++reads === 1 ? stale : state;
      }, { ...tick, now: () => Date.parse("2026-10-02T00:00:00.000Z") });
      assert.equal(result[phase], "incomplete-or-unknown"); assert.equal(starts, 1);
    }
  });
}

test("retrieval failure cannot be retried merely because old progress has a partial window", async () => {
  let starts = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path === "/invoices/collect") { starts++; return {}; }
    if (path === "/invoices") return starts ? { error: "Retrieval failed", continuationReady: false, progress: { account: { window: {} } } } : {};
    return {};
  }, tick);
  assert.equal(result.invoices, "incomplete-or-unknown"); assert.equal(starts, 1);
});

for (const phase of ["invoices", "groceries"]) {
  test(`${phase}: an observed busy operation that fails must not be retried as unrelated work`, async () => {
    let reads = 0, starts = 0;
    const statusPath = phase === "invoices" ? "/invoices" : "/groceries/collection-status";
    const result = await runDailyCollections(async (path, method = "GET") => {
      if (path === "/health") return { capabilities: ["grocery-collection-v1"] };
      if (method === "POST") { if (path === `/${phase}/collect`) starts++; return {}; }
      if (path !== statusPath) return { setupRequired: true };
      return ++reads === 1 ? { busy: true } : { busy: false, error: "Retrieval outcome is uncertain", continuationReady: false };
    }, tick);
    assert.equal(result[phase], "incomplete-or-unknown");
    assert.equal(starts, 0, "observing failure does not authorize another collection");
  });
}

test("an observed invoice tranche with explicit continuation readiness may safely continue", async () => {
  let reads = 0, starts = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path === "/invoices/collect" && method === "POST") { starts++; return {}; }
    if (path !== "/invoices") return { setupRequired: true };
    if (++reads === 1) return { busy: true };
    if (reads === 2) return { busy: false, error: "Some accounts are incomplete", continuationReady: true };
    return success;
  }, tick);
  assert.equal(result.invoices, "complete");
  assert.equal(starts, 1);
});

test("scheduled mail runner cannot start another worker when the existing listener rejects pairing", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "familyhub-daily-startup-"));
  const scripts = join(directory, "scripts"), dist = join(directory, "apps", "worker", "dist"), data = join(directory, "data");
  const marker = join(directory, "unexpected-launch.txt");
  const server = createServer((_request, response) => { response.writeHead(401); response.end("Unauthorized"); });
  try {
    await Promise.all([mkdir(scripts), mkdir(dist, { recursive: true }), mkdir(data)]);
    await writeFile(join(scripts, "Run-DailyCollection.ps1"), await readFile(new URL("../scripts/Run-DailyCollection.ps1", import.meta.url)));
    await writeFile(join(dist, "mail-source-policy-cli.js"), 'console.log(JSON.stringify({ mode: "plugin", ready: true }));');
    const trap = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "A competing process was launched");`;
    await writeFile(join(dist, "index.js"), trap);
    await writeFile(join(dist, "collect-once.js"), trap);
    await writeFile(join(data, "pairing-key.txt"), "synthetic-key");
    await writeFile(join(data, "worker.log"), "existing-log");
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const command = '& $env:FH_TEST_RUNNER -DataDirectory $env:FH_TEST_DATA -NodePath $env:FH_TEST_NODE -Port $env:FH_TEST_PORT';
    await assert.rejects(promisify(execFile)(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
        windowsHide: true, timeout: 30_000, env: { ...process.env, FH_TEST_RUNNER: join(scripts, "Run-DailyCollection.ps1"),
          FH_TEST_DATA: data, FH_TEST_NODE: process.execPath, FH_TEST_PORT: String(server.address().port) }
      }), /existing worker is unavailable/);
    await assert.rejects(access(marker), { code: "ENOENT" });
    assert.equal(await readFile(join(data, "worker.log"), "utf8"), "existing-log");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
