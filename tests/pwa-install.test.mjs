import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", "expected PNG signature");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function manifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("FamilyHub manifest satisfies installable PWA icon requirements", async () => {
  const source = await manifest("apps/web/public/manifest.webmanifest");
  assert.equal(source.name, "FamilyHub");
  assert.equal(source.start_url, "/familyhub/");
  assert.equal(source.scope, "/familyhub/");
  assert.equal(source.display, "standalone");
  assert.equal(source.prefer_related_applications, false);

  const icon192 = source.icons.find(icon => icon.src === "icon-192.png");
  const icon512 = source.icons.find(icon => icon.src === "icon-512.png");
  const maskable = source.icons.find(icon => icon.src === "icon-maskable-512.png");
  assert.deepEqual({ sizes: icon192?.sizes, type: icon192?.type, purpose: icon192?.purpose },
    { sizes: "192x192", type: "image/png", purpose: "any" });
  assert.deepEqual({ sizes: icon512?.sizes, type: icon512?.type, purpose: icon512?.purpose },
    { sizes: "512x512", type: "image/png", purpose: "any" });
  assert.equal(maskable?.sizes, "512x512");
  assert.equal(maskable?.type, "image/png");
  assert.equal(maskable?.purpose, "maskable");

  assert.deepEqual(pngSize(await readFile("apps/web/public/icon-192.png")), { width: 192, height: 192 });
  assert.deepEqual(pngSize(await readFile("apps/web/public/icon-512.png")), { width: 512, height: 512 });
  assert.deepEqual(pngSize(await readFile("apps/web/public/icon-maskable-512.png")), { width: 512, height: 512 });
});

test("built PWA publishes manifest, service worker and mobile install metadata", async () => {
  const builtManifest = await manifest("apps/web/dist/manifest.webmanifest");
  assert.ok(builtManifest.icons.some(icon => icon.src === "icon-192.png" && icon.sizes === "192x192"));
  assert.ok(builtManifest.icons.some(icon => icon.src === "icon-512.png" && icon.sizes === "512x512"));

  const [index, serviceWorker] = await Promise.all([
    readFile("apps/web/dist/index.html", "utf8"),
    readFile("apps/web/dist/sw.js", "utf8")
  ]);
  assert.match(index, /rel="manifest" href="\/familyhub\/manifest\.webmanifest"/);
  assert.match(index, /rel="apple-touch-icon" href="\/familyhub\/icon-192\.png"/);
  assert.match(index, /mobile-web-app-capable/);
  assert.match(serviceWorker, /icon-192\.png/);
  assert.match(serviceWorker, /icon-512\.png/);
});
