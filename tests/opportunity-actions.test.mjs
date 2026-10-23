import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpportunityActions, OpportunityActionsConflict, insuranceRenewalOpportunityId } from "../apps/worker/dist/opportunity-actions.js";

async function sandbox(run) { const dir = await mkdtemp(join(tmpdir(), "familyhub-opportunities-")); try { await run(join(dir, "actions.json")); } finally { await rm(dir, { recursive: true, force: true }); } }
const now = new Date("2026-10-23T15:00:00Z");
const action = (s, kind, extra = {}) => ({ expectedRevision: s.revision, opportunityId: "claim:synthetic", evidenceVersion: "v1-evidence", action: kind, ...extra });

test("empty GET creates no file; decisions and counts persist independently from money", () => sandbox(async path => {
  let lib = new OpportunityActions(path), s = await lib.read();
  assert.equal(s.revision, "empty"); await assert.rejects(access(path));
  s = await lib.mutate(action(s, "seen"), now); assert.equal(s.totals.seen, 1);
  const unchanged = await readFile(path, "utf8");
  s = await lib.mutate(action(s, "seen"), now); assert.equal(await readFile(path, "utf8"), unchanged);
  s = await lib.mutate(action(s, "resolve"), now); assert.equal(s.decisions["claim:synthetic"].state, "resolved"); assert.equal(s.totals.resolved, 1);
  const decided = await readFile(path, "utf8");
  s = await lib.mutate(action(s, "seen"), now); assert.equal(await readFile(path, "utf8"), decided);
  lib = new OpportunityActions(path); s = await lib.read();
  assert.equal(s.history.length, 2); assert.equal(s.totals.resolved, 1); assert.equal(JSON.stringify(s).includes("amount"), false);
  s = await lib.mutate(action(s, "seen", { evidenceVersion: "v1-new-evidence" }), now);
  assert.equal(s.decisions["claim:synthetic"].evidenceVersion, "v1-new-evidence"); assert.equal(s.history[1].state, "resolved");
  s = await lib.mutate(action(s, "restore", { evidenceVersion: "v1-new-evidence" }), now); assert.deepEqual(s.decisions, {}); assert.equal(s.totals.restored, 1);
}));

test("snooze, dismissal and explicit restore are revision guarded and keep prior evidence history", () => sandbox(async path => {
  const lib = new OpportunityActions(path); let s = await lib.read();
  s = await lib.mutate(action(s, "snooze", { snoozedUntil: "2026-10-30T15:00:00Z" }), now);
  assert.equal(s.decisions["claim:synthetic"].snoozedUntil, "2026-10-30T15:00:00.000Z");
  // Expiry is a display decision; reading never rewrites or removes the historical choice.
  const before = await readFile(path, "utf8"); await lib.read(); assert.equal(await readFile(path, "utf8"), before);
  for (const extra of [{ snoozedUntil: "bad" }, { snoozedUntil: now.toISOString() }, { snoozedUntil: "2027-10-30" }]) await assert.rejects(lib.mutate(action(s, "snooze", extra), now));
  await assert.rejects(lib.mutate(action(s, "restore", { evidenceVersion: "v1-other" }), now), OpportunityActionsConflict);
  assert.equal(await readFile(path, "utf8"), before);
  const input = action(s, "dismiss", { reason: "Not relevant to this synthetic household" });
  const results = await Promise.allSettled([lib.mutate(input, now), lib.mutate(input, now)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(results.find(r => r.status === "rejected").reason instanceof OpportunityActionsConflict);
  s = await lib.read(); assert.equal(s.history.length, 2); assert.equal(s.totals.dismissed, 1);
}));

test("invalid identities, unexpected amounts and corrupted stores fail without replacement", () => sandbox(async path => {
  const lib = new OpportunityActions(path); let s = await lib.read();
  s = await lib.mutate(action(s, "seen"), now); const valid = await readFile(path, "utf8");
  for (const extra of [{ opportunityId: "__proto__" }, { evidenceVersion: "" }, { amount: 100 }, { reason: "x".repeat(241) }, { action: "submit" }]) {
    await assert.rejects(lib.mutate(action(s, "resolve", extra), now)); assert.equal(await readFile(path, "utf8"), valid);
  }
  for (const invalid of ["{", JSON.stringify({ ...s, totals: null }), JSON.stringify({ ...s, decisions: { "claim:synthetic": { ...s.decisions["claim:synthetic"], state: "snoozed", snoozedUntil: "invalid" } } }), JSON.stringify({ ...s, totals: { ...s.totals, resolved: -1 } })]) {
    await writeFile(path, invalid); await assert.rejects(lib.read(), /Aucun fichier remplacé/); await assert.rejects(lib.mutate(action(s, "resolve"), now)); assert.equal(await readFile(path, "utf8"), invalid);
  }
}));

test("insurance contexts are scoped to their exact hashed opportunity and persist atomically", () => sandbox(async path => {
  const lib = new OpportunityActions(path), context = { kind: "insurance-renewal", recordId: "policy:synthetic", dueDate: "2026-11-20" };
  const opportunityId = insuranceRenewalOpportunityId(context.recordId);
  let s = await lib.read();
  s = await lib.mutate(action(s, "resolve", { opportunityId, context }), now);
  assert.deepEqual(s.decisions[opportunityId].context, context);
  assert.deepEqual((await new OpportunityActions(path).read()).history[0].context, context);
  const before = await readFile(path, "utf8");
  for (const extra of [
    { opportunityId: "insurance:" + "a".repeat(64) },
    { context: { ...context, dueDate: "2026-02-30" } },
    { context: { ...context, dueDate: "2026-11-20T00:00:00Z" } },
    { context: { ...context, recordId: "../private" } },
    { context: { ...context, extra: true } },
    { context: { ...context, kind: "all-reminders" } },
    { context: null }
  ]) {
    await assert.rejects(lib.mutate(action(s, "resolve", { opportunityId, context, ...extra }), now));
    assert.equal(await readFile(path, "utf8"), before);
  }
  s = await lib.mutate(action(s, "restore", { opportunityId, context }), now);
  assert.equal(s.decisions[opportunityId], undefined); assert.deepEqual(s.history.at(-1).context, context);
  const corrupted = JSON.stringify({ ...s, history: [{ ...s.history[0], context: { ...context, dueDate: "2026-02-30" } }] });
  await writeFile(path, corrupted); await assert.rejects(lib.read(), /Aucun fichier remplacé/); assert.equal(await readFile(path, "utf8"), corrupted);
}));
