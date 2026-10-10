import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { validateSubscription, validateVapid, PushConfiguration, sendPush } from "../apps/worker/dist/notification-push.js";
import { pushFixture } from "./notification-fixture.mjs";
test("subscription destinations and curve keys reject arbitrary hosts, credentials, invalid encodings and keys", () => {
  const { subscription, config } = pushFixture(); assert.deepEqual(validateSubscription(subscription), subscription); assert.deepEqual(validateVapid(config), config);
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.invalid/x", "https://fcm.googleapis.com.evil.invalid/x", "https://user:secret@fcm.googleapis.com/x", "https://fcm.googleapis.com:8080/x", "https://fcm.googleapis.com/x#fragment", "https://a.b.notify.windows.com/x"]) assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  for (const endpoint of ["https://updates.push.services.mozilla.com/wpush/test", "https://web.push.apple.com/test", "https://wns2.notify.windows.com/test"]) assert.equal(validateSubscription({ ...subscription, endpoint }).endpoint, endpoint);
  for (const keys of [{ ...subscription.keys, auth: "bad" }, { ...subscription.keys, p256dh: "A".repeat(87) }, { ...subscription.keys, auth: subscription.keys.auth + "=" }]) assert.throws(() => validateSubscription({ ...subscription, keys }));
  assert.throws(() => validateVapid({ ...config, publicKey: pushFixture().config.publicKey }));
});
test("real encrypted request construction uses opaque payload, bounded fetch, no redirects and honest delivery outcomes", async () => {
  const { subscription, config } = pushFixture(), id = "d".repeat(64); let calls = 0;
  const transport = async (url, options) => { calls++; assert.equal(url, subscription.endpoint); assert.equal(options.redirect, "manual"); assert.equal(options.method, "POST"); assert.equal(options.headers["Content-Encoding"], "aes128gcm"); assert.equal(options.headers.TTL, 3600); assert.ok(options.signal); const body = Buffer.from(options.body); assert.ok(body.length > 100); assert.equal(body.toString().includes(id), false); assert.equal(body.toString().includes("reimbursement"), false); assert.ok(options.headers.Authorization.startsWith("vapid ")); return new Response(null, { status: 201 }); };
  assert.equal(await sendPush(subscription, id, config, transport), "accepted"); assert.equal(calls, 1);
  for (const [code, outcome] of [[404, "expired"], [410, "expired"], [301, "failed"], [400, "failed"], [503, "failed"]]) assert.equal(await sendPush(subscription, id, config, async () => new Response(null, { status: code })), outcome);
  assert.equal(await sendPush(subscription, id, config, async () => { throw Error("synthetic response lost"); }), "unconfirmed");
  await assert.rejects(sendPush(subscription, "private message", config, transport)); assert.equal(calls, 1);
});
test("unconfigured identity read never creates keys, and corrupt existing state is preserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "familyhub-push-config-")), previous = { publicKey: process.env.FAMILYHUB_PUSH_PUBLIC_KEY, privateKey: process.env.FAMILYHUB_PUSH_PRIVATE_KEY };
  delete process.env.FAMILYHUB_PUSH_PUBLIC_KEY; delete process.env.FAMILYHUB_PUSH_PRIVATE_KEY;
  try { const config = new PushConfiguration(dir), path = join(dir, "notifications-vapid.private.json"); assert.equal(await config.read(), null); await assert.rejects(readFile(path), { code: "ENOENT" }); await writeFile(path, "{invalid"); await assert.rejects(config.read(), /Aucune clé/); assert.equal(await readFile(path, "utf8"), "{invalid"); }
  finally { for (const [key, value] of [["FAMILYHUB_PUSH_PUBLIC_KEY", previous.publicKey], ["FAMILYHUB_PUSH_PRIVATE_KEY", previous.privateKey]]) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(dir, { recursive: true, force: true }); }
});
async function workerHarness(windows = []) {
  const handlers = {}, shown = [], opened = [];
  const self = { registration: { scope: "https://vdskevin009.github.io/familyhub/", showNotification: async (title, options) => shown.push({ title, ...options }) }, clients: { matchAll: async () => windows, openWindow: async url => opened.push(url) }, addEventListener: (name, fn) => handlers[name] = fn };
  vm.runInNewContext(await readFile("apps/web/public/sw.js", "utf8"), { self, URL });
  const dispatch = async (type, event) => { let wait; handlers[type]({ ...event, waitUntil: p => wait = p }); await wait; };
  return { shown, opened, dispatch };
}
test("service worker displays only generic content and opens only its same-origin app scope", async () => {
  const h = await workerHarness(), eventId = "a".repeat(64);
  await h.dispatch("push", { data: { json: () => ({ eventId, title: "PRIVATE TITLE", body: "PRIVATE AMOUNT", url: "https://evil.invalid" }) } });
  assert.equal(h.shown[0].title, "FamilyHub"); assert.equal(h.shown[0].body, "Une mise à jour est disponible"); assert.equal(JSON.stringify(h.shown).includes("PRIVATE"), false); assert.equal(JSON.stringify(h.shown).includes("evil"), false);
  let closed = false; await h.dispatch("notificationclick", { notification: { data: { eventId, url: "https://evil.invalid" }, close: () => closed = true } }); assert.ok(closed); assert.equal(h.opened[0], "https://vdskevin009.github.io/familyhub/?view=notifications&notice=" + eventId);
  await h.dispatch("push", { data: { json: () => { throw Error("malformed"); } } }); assert.equal(h.shown[1].data.eventId, "");
  await h.dispatch("notificationclick", { notification: { data: { eventId: "https://evil.invalid" }, close() {} } }); assert.equal(h.opened[1], "https://vdskevin009.github.io/familyhub/?view=notifications");
});
test("notification click focuses an existing FamilyHub window without opening another site's window", async () => {
  let navigated = "", focused = false; const h = await workerHarness([{ url: "https://untrusted.invalid/", navigate: () => assert.fail() }, { url: "https://vdskevin009.github.io/familyhub/?view=finances", navigate: async url => { navigated = url; return { focus: async () => focused = true }; } }]);
  await h.dispatch("notificationclick", { notification: { data: { eventId: "b".repeat(64) }, close() {} } }); assert.match(navigated, /view=notifications/); assert.equal(focused, true); assert.equal(h.opened.length, 0);
});
