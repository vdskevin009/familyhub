import test from "node:test";
import assert from "node:assert/strict";
import { isNgrokFreeEndpoint, workerRequestHeaders } from "../apps/web/src/worker-transport";

const pairing = "local-test-key";
test("only HTTPS assigned ngrok dev domains receive browser-warning skip", () => {
  for (const endpoint of ["https://abc.ngrok-free.app", "https://abc-123.ngrok-free.dev/"]) {
    assert.equal(isNgrokFreeEndpoint(endpoint), true);
    assert.deepEqual(workerRequestHeaders({ Endpoint: endpoint, ApiKey: pairing }), {
      "Content-Type": "application/json",
      "x-familyhub-key": pairing,
      "ngrok-skip-browser-warning": "1"
    });
  }
});

test("other, spoofed and untrusted endpoints are not given provider header", () => {
  for (const endpoint of [
    "https://nvidia-lesser-posted-informational.trycloudflare.com",
    "https://example.com", "https://ngrok-free.dev.evil.example",
    "https://abc.ngrok-free.dev.attacker.com", "http://abc.ngrok-free.dev",
    "https://a:b@abc.ngrok-free.dev", "not-an-url", "https://a.b.ngrok-free.dev"
  ]) {
    assert.equal(isNgrokFreeEndpoint(endpoint), false, endpoint);
    assert.equal(workerRequestHeaders({ Endpoint: endpoint, ApiKey: pairing })["ngrok-skip-browser-warning"], undefined);
  }
});

test("attachment requests preserve pairing without forcing JSON Content-Type", () => {
  assert.deepEqual(workerRequestHeaders({ Endpoint: "https://fixed.ngrok-free.dev", ApiKey: pairing }, false), {
    "x-familyhub-key": pairing,
    "ngrok-skip-browser-warning": "1"
  });
});
