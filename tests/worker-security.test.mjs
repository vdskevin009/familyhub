import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

test("the running worker rejects repeated invalid keys, retains valid pairing and denies foreign origins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "familyhub-security-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  await writeFile(join(directory, "pairing-key.txt"), "synthetic-security-test-key");
  const child = spawn(process.execPath, ["apps/worker/dist/index.js"], {
    env: { ...process.env, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: directory,
      FAMILYHUB_WORKER_HOST: "127.0.0.1", FAMILYHUB_ALLOWED_ORIGINS: "https://vdskevin009.github.io" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stdout.on("data", data => { log += data.toString(); });
  child.stderr.on("data", data => { log += data.toString(); });
  const done = once(child, "exit");
  const endpoint = `http://127.0.0.1:${port}/health`;
  const origin = "https://vdskevin009.github.io";
  const correct = { Origin: origin, "x-familyhub-key": "synthetic-security-test-key", "x-forwarded-for": "203.0.113.11" };
  const incorrect = { Origin: origin, "x-familyhub-key": "wrong-secret", "x-forwarded-for": "203.0.113.11" };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(endpoint, { headers: correct })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, log);
    const good = await fetch(endpoint, { headers: correct });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get("cache-control"), "no-store");
    assert.equal(good.headers.get("x-content-type-options"), "nosniff");
    assert.equal(good.headers.get("referrer-policy"), "no-referrer");
    assert.equal(good.headers.get("x-frame-options"), "DENY");

    const allowedPreflight = await fetch(endpoint, { method: "OPTIONS", headers: {
      Origin: origin, "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "x-familyhub-key,ngrok-skip-browser-warning"
    } });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), origin);
    assert.match(allowedPreflight.headers.get("access-control-allow-headers") || "", /ngrok-skip-browser-warning/);

    const deniedPreflight = await fetch(endpoint, { method: "OPTIONS", headers: { Origin: "https://evil.invalid" } });
    assert.equal(deniedPreflight.status, 403);
    assert.equal(deniedPreflight.headers.get("access-control-allow-origin"), null);

    for (let i = 0; i < 96; i++) {
      const refused = await fetch(endpoint, { headers: incorrect });
      assert.equal(refused.status, 401, `wrong-key attempt ${i + 1}`);
    }
    const limited = await fetch(endpoint, { headers: incorrect });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal((await fetch(endpoint, { headers: correct })).status, 200,
      "unauthorized requests must not lock out the legitimate pairing");
    assert.equal(log.includes("synthetic-security-test-key"), false, "secrets must not enter logs");
  } finally {
    child.kill();
    await done;
    await rm(directory, { recursive: true, force: true });
  }
});
