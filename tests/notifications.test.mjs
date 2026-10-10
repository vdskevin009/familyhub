import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NotificationLibrary, NotificationConflict } from "../apps/worker/dist/notification-library.js";
import { notificationCandidates, localDate } from "../apps/worker/dist/notification-model.js";
import { validateContract } from "../apps/worker/dist/savings-sharing-model.js";
import { now, pushFixture, invoiceEvidence, financeEvidence, contractEvidence } from "./notification-fixture.mjs";
const candidates = (e, date = now) => notificationCandidates(e, date).candidates;
test("payments require a trusted match and explicit paid amount; no bank-deposit claim or guessed balance", () => {
  const invoices = invoiceEvidence(), original = JSON.stringify(invoices);
  let paid = candidates({ invoices }); assert.equal(paid.length, 1); assert.match(paid[0].title, /partiel/); assert.match(paid[0].detail, /pas d[’']une confirmation du dépôt bancaire/); assert.equal(paid[0].target.recordId, "claim-synthetic");
  assert.equal(JSON.stringify(invoices), original);
  for (const alter of [i => i.reconciliations[0].MatchAssignments[0].Verification = "review-recommended", i => { i.reconciliations[0].MatchAssignments[0].Verification = "auto"; }, i => i.reconciliations[0].HasUnresolvedReimbursementEvidence = true, i => i.reconciliations[0].WorkflowStatus = "ignore", i => i.items[0].NeedsReview = true, i => i.items[0].IgnoredAt = "2026-10-11", i => i.items[0].Status = 4, i => i.items[0].ReimbursedAmount = null, i => i.items[0].ReimbursedAmount = -20, i => i.items[0].Currency = "USD"]) { const i = invoiceEvidence(); alter(i); assert.equal(candidates({ invoices: i }).length, 0); }
  invoices.reconciliations[0].MatchAssignments[0] = { ...invoices.reconciliations[0].MatchAssignments[0], Verification: "auto", Confidence: 95 }; invoices.reconciliations[0].PotentialRemaining = 0;
  assert.equal(candidates({ invoices })[0].title, "Remboursement enregistré");
});
test("unmatched payments retain a direct review link; unavailable sources are not marked initialized", () => {
  const invoices = invoiceEvidence(); invoices.reconciliations = []; invoices.unmatchedReimbursements = [{ DocumentId: "unmatched-synthetic", Reason: "ambiguous-match" }];
  assert.deepEqual(candidates({ invoices })[0].target, { view: "reimbursements", recordId: "unmatched-synthetic", queue: "unmatched" });
  assert.deepEqual(notificationCandidates({ invoices: { setupRequired: true, items: [] } }, now).ready, []);
  assert.deepEqual(notificationCandidates({}).ready, []);
});
test("blocked and seven-day stale collections use status evidence and never copy provider errors", () => {
  const e = { collections: [{ id: "a", label: "Synthetic collector", state: "error", error: "PRIVATE RAW ERROR", lastSuccess: "2026-10-10" }, { id: "b", label: "Other", state: "idle", lastSuccess: "2026-10-01" }, { id: "c", label: "Running", state: "syncing", lastSuccess: "2026-01-01" }, { id: "d", label: "Never", state: "idle" }] };
  const c = candidates(e); assert.equal(c.length, 2); assert.equal(JSON.stringify(c).includes("PRIVATE RAW ERROR"), false); assert.ok(c.every(x => x.target.sources)); assert.match(c[1].detail, /ne prouve pas/);
});
test("deadlines use explicit dates, Vancouver day and 30/7/1-day milestones; duration is not an end date", () => {
  assert.equal(localDate(new Date("2026-10-13T02:00:00Z")), "2026-10-12");
  const contract = contractEvidence(); contract.renewal = ""; contract.currentPromoMonths = 12;
  assert.equal(candidates({ contracts: [contract] }).length, 0);
  contract.promotionEnd = { date: "2026-10-20", source: "Synthetic contract page 2" };
  assert.deepEqual(validateContract(contract).promotionEnd, contract.promotionEnd);
  const key = date => candidates({ contracts: [contract] }, new Date(date + "T17:00:00Z"))[0]?.key;
  assert.match(key("2026-10-12"), /:30$/); assert.match(key("2026-10-13"), /:7$/); assert.match(key("2026-10-19"), /:1$/); assert.equal(key("2026-10-21"), undefined);
  for (const date of ["2026-02-30", "bad"]) { contract.promotionEnd.date = date; assert.throws(() => validateContract(contract)); assert.equal(candidates({ contracts: [contract] }).length, 0); }
  contract.promotionEnd = { date: "2026-10-20", source: "" }; assert.throws(() => validateContract(contract));
});
test("charge increases require posted nonduplicate monthly-sized payments and a material difference", () => {
  const f = financeEvidence(), original = JSON.stringify(f), events = candidates({ finance: f }).filter(c => c.kind === "price");
  assert.equal(events.length, 1); assert.equal(events[0].target.recordId, "subscription2"); assert.match(events[0].detail, /ne prouve pas une hausse de tarif/); assert.equal(JSON.stringify(f), original);
  for (const alter of [r => r.status = "pending", r => r.duplicateCandidate = true, r => r.outflowCents = 1900, r => r.date = "2026-09-11", r => r.date = "2026-10-30"]) { const s = financeEvidence(); alter(s.data.transactions.find(r => r.id === "subscription2")); assert.equal(candidates({ finance: s }).filter(c => c.kind === "price").length, 0); }
  f.decisions.subscription2 = { nature: "transfer", category: "savings-investments", note: "Explicit synthetic decision", updatedAt: now.toISOString() }; assert.equal(candidates({ finance: f }).filter(c => c.kind === "price").length, 0);
});
test("weekly summaries exclude transfers, repayments, duplicate/pending rows and net refunds; currencies stay separate", () => {
  const f = financeEvidence(); f.data.transactions.forEach(r => r.date = "2026-10-06");
  const base = f.data.transactions.find(r => r.id === "groceries");
  f.data.transactions = [{ ...base, id: "expense", outflowCents: 10000 }, { ...base, id: "refund", outflowCents: -2000 }, { ...base, id: "transfer", outflowCents: 90000 }, { ...base, id: "repayment", outflowCents: 90000 }, { ...base, id: "pending", outflowCents: 90000, status: "pending" }, { ...base, id: "duplicate", outflowCents: 90000, duplicateCandidate: true }, { ...base, id: "usd", currency: "USD", outflowCents: 3000 }];
  for (const [id, nature] of [["expense", "expense"], ["refund", "refund"], ["transfer", "transfer"], ["repayment", "repayment"], ["usd", "expense"]]) f.decisions[id] = { nature, category: "groceries", note: "Synthetic", updatedAt: now.toISOString() };
  const e = candidates({ finance: f }).filter(c => c.kind === "weekly"); assert.equal(e.length, 2); assert.match(e[0].detail, /80,00/); assert.match(e[1].detail, /30,00/); assert.deepEqual(e.map(c => c.target.currency).sort(), ["CAD", "USD"]); assert.ok(e.every(c => c.target.from === "2026-10-05" && c.target.to === "2026-10-11")); assert.match(e[0].detail, /limité.*sources importées/);
  f.data.scope.to = "2026-10-10"; assert.equal(candidates({ finance: f }).filter(c => c.kind === "weekly").length, 0);
  f.data.scope.to = "2026-10-12"; f.data.collectedOn = "2026-10-10"; assert.equal(candidates({ finance: f }).filter(c => c.kind === "weekly").length, 0);
});
test("investment maturity links its source account without fabricating returns", () => {
  const f = financeEvidence(); f.data.gics = [{ accountId: "synthetic-gic", issueDate: "2025-10-20", principalCents: 100000, maturityDate: "2026-10-20" }];
  const event = candidates({ finance: f }).find(c => c.kind === "deadline"); assert.deepEqual(event.target, { view: "finances", tab: "investments", accountId: "synthetic-gic" });
});
async function sandbox(run) { const dir = await mkdtemp(join(tmpdir(), "familyhub-notifications-")); try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
async function enroll(lib, fixture, extra = {}) { const state = await lib.read(); return lib.mutate({ action: "enroll", expectedRevision: state.revision, permission: "granted", label: "Synthetic phone", subscription: fixture.subscription, publicKey: fixture.config.publicKey, ...extra }); }
test("first-source baseline is silent; dedup persists across restart, concurrent scans and enrollment", () => sandbox(async dir => {
  const fixture = pushFixture(), calls = [], path = join(dir, "history.json"); let lib = new NotificationLibrary(path, async () => fixture.config, async (...args) => { calls.push(args); return "accepted"; });
  await enroll(lib, fixture); const evidence = { contracts: [contractEvidence()] };
  let state = await lib.scan(evidence, [], now); assert.equal(calls.length, 0); assert.equal(state.events[0].baseline, true);
  await Promise.all([lib.scan(evidence, [], now), lib.scan(evidence, [], now)]); assert.equal(calls.length, 0);
  lib = new NotificationLibrary(path, async () => fixture.config, async (...args) => { calls.push(args); return "accepted"; });
  state = await lib.scan(evidence, [], new Date("2026-10-14T17:00:00Z")); assert.equal(calls.length, 1); assert.equal(state.events.filter(e => !e.baseline).length, 1); assert.equal(calls[0][1].length, 64);
  await lib.scan(evidence, [], new Date("2026-10-14T17:00:00Z")); assert.equal(calls.length, 1);
  const exposed = JSON.stringify(await lib.read()); for (const secret of [fixture.subscription.endpoint, fixture.subscription.keys.auth, fixture.subscription.keys.p256dh, fixture.config.privateKey]) assert.equal(exposed.includes(secret), false);
}));
test("preferences mute delivery, not history; enabling does not replay old events or unavailable-source baseline", () => sandbox(async dir => {
  const fixture = pushFixture(), calls = [], lib = new NotificationLibrary(join(dir, "history.json"), async () => fixture.config, async () => { calls.push(1); return "accepted"; });
  let s = await enroll(lib, fixture); s = await lib.mutate({ action: "preferences", expectedRevision: s.revision, preferences: { ...s.preferences, deadline: false } });
  await lib.scan({}, ["contracts"], now); s = await lib.scan({ contracts: [contractEvidence()] }, [], now); assert.equal(s.events[0].baseline, true);
  s = await lib.scan({ contracts: [contractEvidence()] }, [], new Date("2026-10-14T17:00:00Z")); assert.equal(s.events.length, 2); assert.equal(calls.length, 0);
  await lib.mutate({ action: "preferences", expectedRevision: s.revision, preferences: { ...s.preferences, deadline: true } }); await lib.scan({ contracts: [contractEvidence()] }, [], new Date("2026-10-14T17:00:00Z")); assert.equal(calls.length, 0);
  const existing = await lib.read(); const unavailable = await lib.scan({}, ["contracts"], now); assert.deepEqual(unavailable.events.map(e => e.active), existing.events.map(e => e.active));
}));
test("revision conflicts, bad enrollment and unread changes are persistent and atomic", () => sandbox(async dir => {
  const fixture = pushFixture(), lib = new NotificationLibrary(join(dir, "history.json"), async () => fixture.config, async () => "accepted");
  let s = await lib.scan({ contracts: [contractEvidence()] }, [], now);
  const input = { action: "read", expectedRevision: s.revision, id: s.events[0].id };
  const results = await Promise.allSettled([lib.mutate(input), lib.mutate(input)]); assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.ok(results.find(r => r.status === "rejected").reason instanceof NotificationConflict);
  s = await lib.read(); assert.ok(s.events[0].readAt); const before = await readFile(join(dir, "history.json"), "utf8");
  for (const extra of [{ permission: "denied" }, { publicKey: "wrong" }, { label: "" }]) await assert.rejects(enroll(lib, fixture, extra));
  assert.equal(await readFile(join(dir, "history.json"), "utf8"), before);
}));
test("expired devices stop sending; unknown delivery is recorded before transport and never automatically replayed", () => sandbox(async dir => {
  const fixture = pushFixture(), path = join(dir, "history.json"); let sends = 0;
  const lib = new NotificationLibrary(path, async () => fixture.config, async () => { sends++; const persisted = JSON.parse(await readFile(path)); assert.equal(persisted.devices[0].lastDelivery.outcome, "unconfirmed"); throw new Error("synthetic transport response lost"); });
  await enroll(lib, fixture); await lib.scan({ contracts: [contractEvidence()] }, [], now); let s = await lib.scan({ contracts: [contractEvidence()] }, [], new Date("2026-10-14T17:00:00Z")); assert.equal(s.devices[0].lastDelivery.outcome, "unconfirmed");
  await lib.scan({ contracts: [contractEvidence()] }, [], new Date("2026-10-14T17:00:00Z")); assert.equal(sends, 1);
  const expired = new NotificationLibrary(path, async () => fixture.config, async () => "expired"); s = await expired.scan({ contracts: [contractEvidence()] }, [], new Date("2026-10-19T17:00:00Z")); assert.equal(s.devices[0].enabled, false); assert.equal(s.devices[0].lastDelivery.outcome, "expired");
}));
test("explicit test distinguishes provider acceptance from user receipt, rate limits and removes devices", () => sandbox(async dir => {
  const fixture = pushFixture(), lib = new NotificationLibrary(join(dir, "history.json"), async () => fixture.config, async () => "accepted");
  let s = await enroll(lib, fixture); s = await lib.mutate({ action: "test", id: s.devices[0].id, expectedRevision: s.revision }); assert.equal(s.devices[0].lastDelivery.outcome, "accepted"); assert.equal(s.devices[0].lastDelivery.confirmedAt, undefined);
  await assert.rejects(lib.mutate({ action: "test", id: s.devices[0].id, expectedRevision: s.revision }), /minute/);
  await assert.rejects(lib.mutate({ action: "receipt", id: s.devices[0].id, eventId: "wrong", expectedRevision: s.revision }));
  s = await lib.mutate({ action: "receipt", id: s.devices[0].id, eventId: s.devices[0].lastDelivery.eventId, expectedRevision: s.revision }); assert.ok(s.devices[0].lastDelivery.confirmedAt);
  s = await lib.mutate({ action: "remove", id: s.devices[0].id, expectedRevision: s.revision }); assert.equal(s.devices.length, 0);
}));
test("unavailable push credentials leave in-app history usable and corrupt history is never replaced", () => sandbox(async dir => {
  const path = join(dir, "history.json"), lib = new NotificationLibrary(path, async () => { throw Error("PRIVATE credential failure"); }, async () => "accepted");
  const s = await lib.scan({ contracts: [contractEvidence()] }, [], now); assert.equal(s.pushConfigured, false); assert.match(s.pushSetupError, /historique reste accessible/); assert.equal(JSON.stringify(s).includes("PRIVATE"), false);
  assert.equal((await lib.read()).events.length, 1);
  for (const invalid of ["{", JSON.stringify({ ...JSON.parse(await readFile(path)), events: [{ ...s.events[0], target: { view: "external" } }] })]) { await writeFile(path, invalid); await assert.rejects(lib.read(), /Aucun fichier remplacé/); await assert.rejects(lib.scan({ contracts: [] }, [], now)); assert.equal(await readFile(path, "utf8"), invalid); }
}));
