import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpportunityActions, insuranceRenewalOpportunityId } from "../apps/worker/dist/opportunity-actions.js";
import { NotificationLibrary } from "../apps/worker/dist/notification-library.js";
import { notificationActionState, notificationCandidates } from "../apps/worker/dist/notification-model.js";
import { now, pushFixture, contractEvidence, invoiceEvidence, financeEvidence } from "./notification-fixture.mjs";
async function sandbox(run) { const dir = await mkdtemp(join(tmpdir(), "familyhub-notification-lifecycle-")); try { await run(join(dir, "history.json")); } finally { await rm(dir, { recursive: true, force: true }); } }
async function setup(path, send) {
  const fixture = pushFixture(), lib = new NotificationLibrary(path, async () => fixture.config, send);
  const s = await lib.read(); await lib.mutate({ action: "enroll", expectedRevision: s.revision, permission: "granted", label: "Synthetic phone", subscription: fixture.subscription, publicKey: fixture.config.publicKey });
  return lib;
}

test("read is not resolved; decisions survive milestone changes and reopen only for material evidence", () => sandbox(async path => {
  const calls = [], lib = await setup(path, async (...args) => { calls.push(args); return "accepted"; }), contract = contractEvidence();
  let s = await lib.scan({ contracts: [contract] }, [], now), event = s.events[0];
  s = await lib.mutate({ action: "read", id: event.id, expectedRevision: s.revision }, now);
  assert.equal(notificationActionState(s.events[0], now.getTime()), "open");
  s = await lib.mutate({ action: "resolve", id: event.id, expectedRevision: s.revision }, now);
  s = await lib.scan({ contracts: [contract] }, [], new Date("2026-10-14T17:00:00Z"));
  event = s.events.find(e => e.active); assert.equal(notificationActionState(event), "resolved"); assert.equal(calls.length, 0);
  assert.equal(s.events[0].readAt, now.toISOString());
  contract.renewal = "2026-11-02";
  s = await lib.scan({ contracts: [contract] }, [], new Date("2026-10-14T18:00:00Z"));
  event = s.events.find(e => e.active); assert.equal(notificationActionState(event), "open"); assert.equal(calls.length, 1);
  s = await lib.mutate({ action: "dismiss", id: event.id, expectedRevision: s.revision }, now);
  s = await lib.mutate({ action: "restore", id: event.id, expectedRevision: s.revision }, now);
  await lib.scan({ contracts: [contract] }, [], new Date("2026-10-15T18:00:00Z")); assert.equal(calls.length, 1);
}));

test("snooze is persistent, expires without replay and unavailable sources cannot send or close alerts", () => sandbox(async path => {
  let sends = 0; const lib = await setup(path, async () => { sends++; return "accepted"; }), evidence = { contracts: [contractEvidence()] };
  let s = await lib.scan(evidence, [], now);
  s = await lib.mutate({ action: "snooze", id: s.events[0].id, snoozedUntil: "2026-10-16T16:00:00Z", expectedRevision: s.revision }, now);
  s = await lib.scan(evidence, [], new Date("2026-10-14T17:00:00Z")); assert.equal(sends, 0);
  const active = s.events.filter(e => e.active).map(e => e.id);
  s = await lib.scan({}, ["contracts"], new Date("2026-10-16T17:00:00Z")); assert.equal(sends, 0); assert.deepEqual(s.events.filter(e => e.active).map(e => e.id), active);
  s = await lib.scan(evidence, [], new Date("2026-10-16T17:15:00Z")); assert.equal(sends, 1);
  await lib.scan(evidence, [], new Date("2026-10-16T17:30:00Z")); assert.equal(sends, 1);
  assert.equal(notificationActionState(s.events.find(e => e.active), Date.parse("2026-10-16T17:15:00Z")), "open");
}));

test("quiet hours defer one grouped notice; daily budget and preference opt-out persist before sending", () => sandbox(async path => {
  let sends = 0; const lib = await setup(path, async () => { sends++; const saved = JSON.parse(await readFile(path, "utf8")); assert.ok(saved.lastAutomaticPushAt); assert.ok(saved.events.filter(e => e.active).some(e => e.pushState === "handled")); return "accepted"; });
  await lib.scan({ contracts: [] }, [], now);
  const first = contractEvidence(), second = { ...first, id: "other-synthetic", name: "Other synthetic" };
  let s = await lib.scan({ contracts: [first] }, [], new Date("2026-10-14T06:00:00Z")); assert.equal(sends, 0); assert.equal(s.events[0].pushState, "pending");
  s = await lib.scan({ contracts: [first] }, [], new Date("2026-10-14T15:00:00Z")); assert.equal(sends, 1);
  s = await lib.scan({ contracts: [first, second] }, [], new Date("2026-10-14T16:00:00Z")); assert.equal(sends, 1); assert.equal(s.events.find(e => e.target.recordId === second.id).pushState, "pending");
  s = await lib.mutate({ action: "preferences", expectedRevision: s.revision, preferences: { ...s.preferences, deadline: false } });
  assert.equal(s.events.find(e => e.target.recordId === second.id).pushState, "handled");
  await lib.mutate({ action: "preferences", expectedRevision: s.revision, preferences: { ...s.preferences, deadline: true } });
  await lib.scan({ contracts: [first, second] }, [], new Date("2026-10-15T17:00:00Z")); assert.equal(sends, 1);
}));

test("old source facts and informational payments never trigger automatic pushes", () => sandbox(async path => {
  let sends = 0; const lib = await setup(path, async () => { sends++; return "accepted"; });
  await lib.scan({ invoices: { setupRequired: false, items: [], reconciliations: [], unmatchedReimbursements: [] }, collections: [] }, [], now);
  const invoices = invoiceEvidence(); invoices.lastSuccess = now.toISOString(); invoices.unmatchedReimbursements = [{ DocumentId: "old", Reason: "ambiguous-match" }]; invoices.items.push({ Id: "old", ReceivedAt: "2025-01-01", StatementDate: "2025-01-01" });
  const finance = financeEvidence(); finance.data.collectedOn = "2026-01-01"; finance.data.gics = [{ accountId: "synthetic", issueDate: "2025-01-01", principalCents: 10000, maturityDate: "2026-10-20" }];
  await lib.scan({ finance: { ...finance, data: { ...finance.data, gics: [] } } }, [], now);
  const s = await lib.scan({ invoices, finance, collections: [{ id: "old", label: "Synthetic", state: "error", lastAttempt: "2026-01-01" }] }, [], now);
  assert.equal(sends, 0); assert.ok(s.events.find(e => e.kind === "deadline")); assert.equal(s.events.find(e => e.kind === "reimbursement").actionable, false);
}));

test("legacy history upgrades silently, preserves device/preferences and rejects corrupt lifecycle metadata", () => sandbox(async path => {
  let sends = 0; const lib = await setup(path, async () => { sends++; return "accepted"; });
  let s = await lib.scan({ contracts: [contractEvidence()] }, [], now);
  const stored = JSON.parse(await readFile(path, "utf8")), devices = structuredClone(stored.devices), preferences = structuredClone(stored.preferences);
  for (const event of stored.events) for (const key of ["groupId", "evidenceVersion", "pushState", "actionable", "priority", "expiresAt"]) delete event[key];
  delete stored.decisions; await writeFile(path, JSON.stringify(stored));
  s = await lib.scan({ contracts: [contractEvidence()] }, [], now); assert.equal(sends, 0);
  const after = JSON.parse(await readFile(path, "utf8")); assert.deepEqual(after.devices, devices); assert.deepEqual(after.preferences, preferences);
  const before = await readFile(path, "utf8");
  for (const date of ["invalid", now.toISOString(), "2027-12-31"]) await assert.rejects(lib.mutate({ action: "snooze", id: s.events[0].id, expectedRevision: s.revision, snoozedUntil: date }, now));
  assert.equal(await readFile(path, "utf8"), before);
  const invalid = JSON.stringify({ ...after, decisions: { [s.events[0].groupId]: { state: "snoozed", at: now.toISOString(), evidenceVersion: s.events[0].evidenceVersion, snoozedUntil: "bad" } } });
  await writeFile(path, invalid); await assert.rejects(lib.read(), /Aucun fichier remplacé/); await assert.rejects(lib.scan({ contracts: [] }, [], now)); assert.equal(await readFile(path, "utf8"), invalid);
}));

test("new devices do not receive an older pending group; recipients and event links stay scoped", () => sandbox(async path => {
  const delivered = [], lib = await setup(path, async (subscription, eventId) => { delivered.push({ endpoint: subscription.endpoint, eventId }); return "accepted"; });
  await lib.scan({ contracts: [] }, [], now);
  const first = contractEvidence(), second = { ...first, id: "later-synthetic", name: "Later synthetic" };
  let s = await lib.scan({ contracts: [first] }, [], new Date("2026-10-14T06:00:00Z"));
  const firstId = s.events[0].id, newDevice = pushFixture("new-phone");
  s = await lib.mutate({ action: "enroll", expectedRevision: s.revision, permission: "granted", label: "New phone", subscription: newDevice.subscription, publicKey: s.publicKey });
  assert.equal(s.events[0].pendingDeviceIds, undefined);
  s = await lib.scan({ contracts: [first, second] }, [], new Date("2026-10-14T06:15:00Z"));
  const secondId = s.events.find(e => e.target.recordId === second.id).id;
  await lib.scan({ contracts: [first, second] }, [], new Date("2026-10-14T15:00:00Z"));
  assert.equal(delivered.length, 2);
  assert.equal(delivered.find(d => d.endpoint === newDevice.subscription.endpoint).eventId, secondId);
  assert.equal(delivered.find(d => d.endpoint !== newDevice.subscription.endpoint).eventId, firstId);
}));

test("read suppresses the same alert; new urgency can remind without resolving", () => sandbox(async path => {
  let sends = 0; const lib = await setup(path, async () => { sends++; return "accepted"; }), contract = contractEvidence();
  let s = await lib.scan({ contracts: [contract] }, [], now);
  s = await lib.mutate({ action: "read", expectedRevision: s.revision, id: s.events[0].id }, now);
  s = await lib.scan({ contracts: [contract] }, [], new Date("2026-10-14T17:00:00Z"));
  assert.equal(sends, 1); assert.equal(s.events.find(e => e.active).readAt, undefined);
  assert.equal(notificationActionState(s.events.find(e => e.active)), "open");
  await lib.scan({ contracts: [contract] }, [], new Date("2026-10-14T18:00:00Z")); assert.equal(sends, 1);
  contract.renewal = "2026-11-02";
  s = await lib.scan({ contracts: [contract] }, [], new Date("2026-10-15T18:00:00Z"));
  assert.equal(sends, 2); assert.equal(s.events.find(e => e.active).readAt, undefined);
}));

test("verified structured insurance deadline migrates silently, then alerts on new urgency", () => sandbox(async path => {
  let sends = 0; const lib = await setup(path, async () => { sends++; return "accepted"; });
  await lib.scan({ contracts: [] }, [], now);
  const legacy = JSON.parse(await readFile(path, "utf8")); delete legacy.insuranceDatesInitialized; await writeFile(path, JSON.stringify(legacy));
  const contract = contractEvidence(); contract.renewal = ""; contract.commitmentEnd = "2026-10-20";
  contract.insuranceReference = { sources: [{ id: "source", kind: "document", scope: "original", verification: "locally-read" }], records: [{ id: "policy", kind: "policy", status: "documented", effectiveFrom: "2026-01-01", effectiveTo: "2026-10-20", sourceIds: ["source"], facts: [{ code: "coverage.limit", certainty: "conflict" }], supersedes: null }] };
  let s = await lib.scan({ contracts: [contract] }, [], now);
  assert.equal(s.events.length, 1); assert.equal(s.events[0].baseline, true); assert.equal(sends, 0);
  s = await lib.scan({ contracts: [contract] }, [], new Date("2026-10-14T17:00:00Z"));
  assert.equal(sends, 1); assert.equal(s.events.find(e => e.active).baseline, false);
  assert.equal(s.events.find(e => e.active).sourceDate, "2026-10-20");
  const variants = [
    ref => ref.records[0].facts.push({ code: "policy.effectiveTo", certainty: "conflict" }),
    ref => ref.sources[0].verification = "unverified",
    ref => ref.sources[0].scope = "historical",
    ref => ref.records.push({ ...ref.records[0], id: "second" })
  ];
  for (const change of variants) {
    const copy = structuredClone(contract); copy.commitmentEnd = ""; change(copy.insuranceReference);
    assert.equal(notificationCandidates({ contracts: [copy] }, now).candidates.length, 0);
  }
  s = await lib.mutate({ action: "resolve", expectedRevision: s.revision, id: s.events.find(e => e.active).id }, now);
  await lib.scan({ contracts: [contract] }, [], new Date("2026-10-19T17:00:00Z")); assert.equal(sends, 1);
}));

async function todaySetup(path) {
  const actions = new OpportunityActions(path + ".actions.json"), fixture = pushFixture(), deliveries = [];
  let failed = false;
  const lib = new NotificationLibrary(path, async () => fixture.config, async (_subscription, id) => { deliveries.push(id); return "accepted"; }, () => failed ? Promise.reject(Error("private failure")) : actions.read());
  let state = await lib.read();
  await lib.mutate({ action: "enroll", expectedRevision: state.revision, permission: "granted", label: "Synthetic phone", subscription: fixture.subscription, publicKey: fixture.config.publicKey });
  const contract = { ...contractEvidence(), category: "home-insurance", renewal: "2026-11-20" };
  await lib.scan({ contracts: [contract] }, [], new Date("2026-10-01T17:00:00Z"));
  async function decide(action, extra = {}) {
    const s = await actions.read();
    return actions.mutate({ action, expectedRevision: s.revision, opportunityId: insuranceRenewalOpportunityId(contract.id), evidenceVersion: "v1:synthetic",
      context: { kind: "insurance-renewal", recordId: contract.id, dueDate: contract.renewal }, ...extra }, new Date("2026-10-01T17:00:00Z"));
  }
  return { actions, lib, contract, deliveries, decide, fail: value => failed = value };
}
test("Today snooze before J30 suppresses insurance milestones until its expiry", () => sandbox(async path => {
  const t = await todaySetup(path);
  await t.decide("snooze", { snoozedUntil: "2026-11-15T16:00:00Z" });
  for (const date of ["2026-10-22T17:00:00Z", "2026-11-13T17:00:00Z"]) {
    const s = await t.lib.scan({ contracts: [t.contract] }, [], new Date(date));
    assert.equal(t.deliveries.length, 0); assert.ok(s.events.find(e => e.active));
    assert.equal(s.events.find(e => e.active).decision, undefined, "external choice is not a fake notification resolution");
  }
  await t.lib.scan({ contracts: [t.contract] }, [], new Date("2026-11-15T17:00:00Z")); assert.equal(t.deliveries.length, 1);
  await t.lib.scan({ contracts: [t.contract] }, [], new Date("2026-11-15T17:15:00Z")); assert.equal(t.deliveries.length, 1);
}));
test("Today resolved and dismissed suppress J30 J7 J1; a new insurance date reopens", () => sandbox(async path => {
  for (const action of ["resolve", "dismiss"]) {
    const t = await todaySetup(path + action);
    await t.decide(action);
    for (const date of ["2026-10-22T17:00:00Z", "2026-11-13T17:00:00Z", "2026-11-19T17:00:00Z"]) await t.lib.scan({ contracts: [t.contract] }, [], new Date(date));
    assert.equal(t.deliveries.length, 0);
    t.contract.renewal = "2026-12-01";
    await t.lib.scan({ contracts: [t.contract] }, [], new Date("2026-11-19T18:00:00Z")); assert.equal(t.deliveries.length, 1);
  }
}));
test("Today restore removes its influence; seen alone does not suppress a renewal push", () => sandbox(async path => {
  for (const action of ["snooze", "resolve", "dismiss"]) {
    const t = await todaySetup(path + action);
    await t.decide(action, action === "snooze" ? { snoozedUntil: "2026-11-15T16:00:00Z" } : {});
    await t.lib.scan({ contracts: [t.contract] }, [], new Date("2026-10-22T17:00:00Z")); assert.equal(t.deliveries.length, 0);
    await t.decide("restore");
    await t.lib.scan({ contracts: [t.contract] }, [], new Date("2026-10-22T17:15:00Z")); assert.equal(t.deliveries.length, 1);
  }
  const t = await todaySetup(path + "seen"); await t.decide("seen");
  await t.lib.scan({ contracts: [t.contract] }, [], new Date("2026-10-22T17:00:00Z")); assert.equal(t.deliveries.length, 1);
}));
test("unreadable Today decisions defer only insurance renewal pushes and preserve their pending history", () => sandbox(async path => {
  const t = await todaySetup(path); t.fail(true);
  const telecom = { ...contractEvidence(), id: "other-contract", renewal: "2026-11-20" };
  let s = await t.lib.scan({ contracts: [t.contract, telecom] }, [], new Date("2026-10-22T17:00:00Z"));
  assert.equal(t.deliveries.length, 1); assert.equal(s.events.find(e => e.id === t.deliveries[0]).target.recordId, telecom.id);
  assert.ok(s.sourceErrors.includes("suivi des actions d’accueil")); assert.ok(!JSON.stringify(s).includes("private failure"));
  assert.equal(s.events.find(e => e.target.recordId === t.contract.id).pushState, "pending");
  assert.equal(s.events.find(e => e.target.recordId === t.contract.id).active, true);
  assert.equal(s.events.find(e => e.target.recordId === t.contract.id).decision, undefined);
  t.fail(false);
  s = await t.lib.scan({ contracts: [t.contract, telecom] }, [], new Date("2026-10-23T17:00:00Z")); assert.equal(t.deliveries.length, 2);
  assert.deepEqual(s.sourceErrors, []);
}));
