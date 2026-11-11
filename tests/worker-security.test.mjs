import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

async function reservedSocket() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

function worker(directory, port, extra = {}) {
  const child = spawn(process.execPath, ["apps/worker/dist/index.js"], {
    env: { ...process.env, FAMILYHUB_WORKER_PORT: String(port), FAMILYHUB_WORKER_DATA: directory,
      FAMILYHUB_WORKER_HOST: "127.0.0.1", ...extra }, stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  const done = once(child, "exit");
  const timeout = setTimeout(() => child.kill(), 15000);
  done.finally(() => clearTimeout(timeout));
  return { child, done, log: () => log };
}

test("an occupied socket rejects startup before generating or changing private files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "familyhub-occupied-"));
  const server = await reservedSocket();
  const sentinel = '{"watches":[],"privateMarker":"synthetic-do-not-change"}';
  await writeFile(join(directory, "state.json"), sentinel);
  const process = worker(directory, server.address().port);
  try {
    const [code] = await process.done;
    assert.notEqual(code, 0);
    assert.deepEqual(await readdir(directory), ["state.json"]);
    assert.equal(await readFile(join(directory, "state.json"), "utf8"), sentinel);
    assert.equal(process.log().includes("synthetic-do-not-change"), false);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const failure of ["empty-key", "unreadable-key", "malformed-state", "invalid-state-shape"]) {
  test(`startup preserves existing files and refuses ${failure}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "familyhub-startup-"));
    const socket = await reservedSocket(); const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const key = failure === "empty-key" ? "" : "synthetic-existing-secret";
    const saved = failure === "malformed-state" ? "{broken-private-state" : failure === "invalid-state-shape" ? '{"watches":null}' : '{"watches":[]}';
    if (failure === "unreadable-key") {
      await mkdir(join(directory, "pairing-key.txt"));
      await writeFile(join(directory, "pairing-key.txt", "sentinel"), "preserve");
    } else await writeFile(join(directory, "pairing-key.txt"), key);
    await writeFile(join(directory, "state.json"), saved);
    const process = worker(directory, port);
    try {
      const [code] = await process.done;
      assert.notEqual(code, 0);
      assert.equal(await readFile(join(directory, "state.json"), "utf8"), saved);
      if (failure === "unreadable-key") assert.equal(await readFile(join(directory, "pairing-key.txt", "sentinel"), "utf8"), "preserve");
      else assert.equal(await readFile(join(directory, "pairing-key.txt"), "utf8"), key);
      assert.equal(process.log().includes("synthetic-existing-secret"), false);
      assert.equal(process.log().includes("broken-private-state"), false);
      const probe = createServer(); probe.listen(port, "127.0.0.1");
      await once(probe, "listening"); probe.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test("failed automatic watches never log private queries or raw provider errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "familyhub-log-"));
  const socket = await reservedSocket(); const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await writeFile(join(directory, "pairing-key.txt"), "synthetic-existing-secret");
  await writeFile(join(directory, "state.json"), JSON.stringify({ watches: [{ Id: "test", Auto: true,
    Query: "synthetic-private-medical-query", CadenceHours: 24 }] }));
  const process = worker(directory, port, { FAMILYHUB_CODEX_PATH: join(directory, "synthetic-secret-missing-executable") });
  try {
    for (let i = 0; i < 100 && !process.log().includes("Automatic watch failed;"); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(process.log(), /Automatic watch failed;/);
    assert.doesNotMatch(process.log(), /synthetic-private-medical-query|synthetic-secret-missing-executable|synthetic-existing-secret/);
  } finally {
    process.child.kill(); await process.done;
    await rm(directory, { recursive: true, force: true });
  }
});

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
