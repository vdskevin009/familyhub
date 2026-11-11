import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WorkerRequestThrottle, workerRequestSource, addWorkerSecurityHeaders } from "../apps/worker/src/request-security";

const request = (remoteAddress: string, forwarded?: string): IncomingMessage =>
  ({ socket: { remoteAddress }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} }) as unknown as IncomingMessage;

test("the last valid forwarded IP is used only through a loopback proxy", () => {
  assert.equal(workerRequestSource(request("127.0.0.1", "1.2.3.4, 5.6.7.8")), "5.6.7.8");
  assert.equal(workerRequestSource(request("::ffff:127.0.0.1", "1.2.3.4, 5.6.7.8")), "5.6.7.8");
  assert.equal(workerRequestSource(request("192.0.2.9", "1.2.3.4, 5.6.7.8")), "192.0.2.9");
  assert.equal(workerRequestSource(request("127.0.0.1", "a forged value")), "127.0.0.1");
});

test("invalid key attempts are throttled per caller but valid calls stay usable", () => {
  let now = 100;
  const limiter = new WorkerRequestThrottle(() => now);
  const attacker = request("127.0.0.1", "203.0.113.1");
  const owner = request("127.0.0.1", "203.0.113.2");
  for (let i = 0; i < 96; i++) assert.equal(limiter.allowed("invalid-auth", attacker), true);
  assert.equal(limiter.allowed("invalid-auth", attacker), false);
  assert.equal(limiter.allowed("invalid-auth", owner), true);
  assert.equal(limiter.allowed("authorized", attacker), true, "bad attempts never lock out valid pairing");
  now += 60_000;
  assert.equal(limiter.allowed("invalid-auth", attacker), true);
});

test("separate preflight and authenticated limits prevent request floods", () => {
  const limiter = new WorkerRequestThrottle(() => 0);
  const owner = request("127.0.0.1");
  for (let i = 0; i < 180; i++) assert.equal(limiter.allowed("preflight", owner), true);
  assert.equal(limiter.allowed("preflight", owner), false);
  for (let i = 0; i < 300; i++) assert.equal(limiter.allowed("authorized", owner), true);
  assert.equal(limiter.allowed("authorized", owner), false);
});

test("all API responses can be marked noncacheable and nonembeddable", () => {
  const headers = new Map<string, string>();
  const response = { setHeader: (key: string, value: string) => { headers.set(key, value); } } as unknown as ServerResponse;
  addWorkerSecurityHeaders(response);
  assert.equal(headers.get("Cache-Control"), "no-store");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.match(headers.get("Content-Security-Policy") || "", /frame-ancestors 'none'/);
});
