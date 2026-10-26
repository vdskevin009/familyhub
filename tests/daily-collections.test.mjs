import test from "node:test";
import assert from "node:assert/strict";
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
  let starts = 0;
  const result = await runDailyCollections(async (path, method = "GET") => {
    if (path === "/invoices") return {};
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
