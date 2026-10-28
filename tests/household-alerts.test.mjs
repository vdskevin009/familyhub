import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyRateMonitor, parsePolicyAnnouncement, policyRateUrl } from "../apps/worker/dist/policy-rate.js";
import { householdCandidates, groceryDropAssessment } from "../apps/worker/dist/household-alerts.js";
import { readClaimDeadlines } from "../apps/worker/dist/claim-deadlines.js";
import { NotificationLibrary } from "../apps/worker/dist/notification-library.js";
import { notificationCandidates, notificationNeedsAttention } from "../apps/worker/dist/notification-model.js";
import { emptyPlan } from "../apps/worker/dist/grocery-planning.js";
import { emptyMortgage } from "../apps/worker/dist/mortgage-model.js";
import { now as oldNow, pushFixture, contractEvidence, financeEvidence } from "./notification-fixture.mjs";
const now = new Date("2026-10-28T18:00:00Z"), today = "2026-10-28";
const table = (date = "October 28, 2026", value = "2.75", delta = "-0.25", prior = "3.00") => `<table><thead><tr><th>Date*</th><th>Target (%)</th><th>Change (%)</th></tr></thead><tbody><tr><td>${date}</td><td>${value}</td><td>${delta}</td></tr><tr><td>September 2, 2026</td><td>${prior}</td><td>---</td></tr></tbody></table>`;
const policy = () => ({ schema: 1, status: "ready", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), announcement: parsePolicyAnnouncement(table(), today) });
async function sandbox(fn) { const dir = await mkdtemp(join(tmpdir(), "familyhub-household-alerts-")); try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }

test("only the dated official target/change table is admissible; next-day effect, mismatches and forecasts", () => {
  assert.deepEqual(parsePolicyAnnouncement(`<h1>Bank Rate 3.00%, forecast 9%</h1>${table()}`, today), { date: today, effectiveDate: "2026-10-29", rate: 2.75, previousRate: 3, change: -.25, sourceUrl: policyRateUrl });
  for (const html of [table("October 29, 2026"), table(today), table("October 28, 2026", "2.75", "+0.25"), table("October 28, 2026", "", "-0.25"), table() + table(), "<p>October 28, 2026: 2.75%</p>"]) assert.throws(() => parsePolicyAnnouncement(html, today));
  assert.equal(parsePolicyAnnouncement(table("October 28, 2026", "3.00", "---"), today).change, 0);
  assert.equal(parsePolicyAnnouncement(table().replace('<td>October 28, 2026</td>', '<th data-date="2026-10-28">October 28, 2026</th>'), today).rate, 2.75);
});

test("hourly persisted public collection is bounded, coalesced and honest on outage; corrupt state preserved", () => sandbox(async dir => {
  const path = join(dir, "policy.json"); let requests = 0, fail = false;
  const request = async (url, init) => { requests++; assert.equal(url, policyRateUrl); assert.equal(init.redirect, "error"); assert.equal(init.body, undefined); if (fail) throw Error("private request error must not be saved"); return new Response(table()); };
  const monitor = new PolicyRateMonitor(path, request);
  const both = await Promise.all([monitor.read(now), monitor.read(now)]); assert.deepEqual(both[0], both[1]); assert.equal(requests, 1);
  await new PolicyRateMonitor(path, request).read(new Date(now.getTime() + 1000)); assert.equal(requests, 1);
  fail = true; const outage = await monitor.read(new Date(now.getTime() + 3_600_001)); assert.equal(outage.status, "unavailable"); assert.equal(outage.lastSuccessAt, now.toISOString()); assert.equal(householdCandidates({ policy: outage }, today, now).candidates.length, 0); assert.doesNotMatch(await readFile(path, "utf8"), /private request/);
  await writeFile(path, "broken"); await assert.rejects(monitor.read(new Date(now.getTime() + 7_200_001))); assert.equal(await readFile(path, "utf8"), "broken");
}));

test("personal impact keeps fixed contracts and historical variable offers unchanged, with stable evidence identity", () => {
  const mortgage = { ...emptyMortgage(), profiles: [{ id: "synthetic", recordedAt: "2026-10-20T00:00:00Z", rateType: "fixed", currentRate: 4.9, maturityDate: "2027-11-20" }], quotes: [{ id: "synthetic-variable", rate: 3.9 }] };
  const before = JSON.stringify(mortgage), input = { policy: policy(), mortgageState: mortgage };
  const event = householdCandidates(input, today, now).candidates[0];
  assert.match(event.detail, /fixe à 4.9 % jusqu’au 2027-11-20/); assert.match(event.detail, /aucun changement immédiat/); assert.equal(JSON.stringify(mortgage), before);
  assert.equal(event.key, householdCandidates({ ...input, policy: { ...policy(), checkedAt: new Date(now.getTime() + 1000).toISOString() } }, today, new Date(now.getTime() + 1000)).candidates[0].key);
  mortgage.profiles[0].rateType = "variable"; assert.match(householdCandidates(input, today, now).candidates[0].detail, /aucun nouveau taux ni paiement/);
  delete input.mortgageState; assert.match(householdCandidates(input, today, now).candidates[0].detail, /doivent être confirmés/);
});

function groceries() {
  const product = "Synthetic oats", line = { name: product, product, amount: 10, quantity: 1, size: 1, unit: "kg", evidence: "Synthetic paid receipt", uncertain: false };
  const library = { records: ["2026-10-12", "2026-10-21"].map((date, i) => ({ id: "paid-" + i, revision: "r", status: "saved", createdAt: date + "T12:00:00Z", reviewedAt: date + "T12:00:00Z", duplicateOf: null, sources: [{ hash: "synthetic-hash-" + i }], receipt: { sourceType: "final-receipt", date, currency: "CAD", items: [{ ...line }] } })) };
  const plan = { ...emptyPlan(), areaConfirmed: true, items: [{ id: "oats", name: product, active: true }], retailers: [{ id: "shop", name: "Synthetic shop", areaConfirmed: true, locality: "Synthetic city", mode: "store", membershipStatus: "none" }], prices: [{ id: "price", itemId: "oats", retailerId: "shop", product, price: 7, size: 1, unit: "kg", weighed: false, currency: "CAD", kind: "public", approved: true, available: "yes", substitution: false, localityConfirmed: true, locality: "Synthetic city", mode: "store", matchNote: "Exact product checked", evidence: { date: "2026-10-27", until: "2026-10-30", url: "https://example.test/oats" } }] };
  return { library, plan };
}
test("grocery price drops require repeat paid sources, exact product, current local approval and meaningful whole-pack outlay", () => {
  const good = groceries(), inspect = data => groceryDropAssessment(data.library, data.plan, today);
  const result = inspect(good); assert.equal(result.candidates.length, 1); assert.match(result.candidates[0].detail, /sans gain net/); assert.equal(result.candidates[0].target.recordId, "paid-1");
  for (const change of [d => d.library.records[0].receipt.sourceType = "confirmation", d => d.library.records[0].duplicateOf = "paid-1", d => d.library.records[0].receipt.items[0].uncertain = true, d => d.library.records[0].sources = d.library.records[1].sources, d => d.plan.prices[0].approved = false, d => d.plan.prices[0].product = "Different oats", d => d.plan.prices[0].substitution = true, d => d.plan.prices[0].available = "unknown", d => d.plan.prices[0].evidence.until = null, d => d.plan.prices[0].evidence.date = "2026-10-01", d => d.plan.prices[0].mode = "delivery", d => d.plan.prices[0].unit = "l", d => d.plan.prices[0].currency = "USD", d => d.plan.prices[0].price = 9, d => { d.plan.prices[0].size = .6; d.plan.prices[0].price = 5; }]) { const copy = structuredClone(good); change(copy); assert.equal(inspect(copy).candidates.length, 0); }
  const noDrop = structuredClone(good); noDrop.plan.prices[0].price = 9; assert.equal(inspect(noDrop).comparable, 1);
});

test("claim dates require reviewed source, the exact open dossier/next insurer and fresh collection, never a service-date offset", () => sandbox(async dir => {
  const rule = { expenseId: "expense", insurer: "desjardins", date: "2026-11-02", sourceDocumentId: "document", sourceDate: "2026-10-01", sourceNote: "Synthetic explicit rule on the source", confirmedAt: "2026-10-20T12:00:00Z" };
  const invoices = { lastSuccess: now.toISOString(), reconciliations: [{ Id: "expense", WorkflowStatus: "open", Action: "submit-primary", NextInsurer: "Desjardins", DocumentIds: ["document"] }], items: [{ Id: "document", Status: 0 }] };
  const input = { invoices, claimDeadlines: [rule] }, inspect = e => householdCandidates(e, today, now).candidates.filter(c => c.kind === "claim-deadline");
  assert.equal(inspect(input).length, 1);
  for (const change of [e => e.claimDeadlines = [], e => e.invoices.reconciliations[0].WorkflowStatus = "closed", e => e.invoices.reconciliations[0].OriginalInvoiceMissing = true, e => e.invoices.reconciliations[0].NextInsurer = "Blue Cross", e => e.invoices.items[0].NeedsReview = true, e => e.invoices.lastSuccess = "2026-10-01T00:00:00Z"]) { const copy = structuredClone(input); change(copy); assert.equal(inspect(copy).length, 0); }
  const path = join(dir, "deadlines.json"); assert.deepEqual(await readClaimDeadlines(path), []);
  await writeFile(path, JSON.stringify({ schema: 1, records: [rule, rule] })); await assert.rejects(readClaimDeadlines(path));
}));

test("new categories migrate without replay; policy dedup survives restart, preference and read state", () => sandbox(async dir => {
  const path = join(dir, "history.json"), fixture = pushFixture(); let sends = 0;
  const create = () => new NotificationLibrary(path, async () => fixture.config, async () => { sends++; return "accepted"; });
  let lib = create(), s = await lib.scan({}, [], now);
  s = await lib.mutate({ action: "enroll", expectedRevision: s.revision, subscription: fixture.subscription, label: "Synthetic device", permission: "granted", publicKey: fixture.config.publicKey });
  let raw = JSON.parse(await readFile(path, "utf8")); for (const k of ["policy", "grocery", "claim-deadline"]) delete raw.preferences[k]; raw.preferences.price = false; await writeFile(path, JSON.stringify(raw));
  s = await lib.scan({ policy: policy() }, [], now); assert.equal(sends, 0); assert.equal(s.events[0].baseline, true); assert.equal(s.preferences.price, false);
  const nextNow = new Date("2026-12-09T18:00:00Z"), next = { ...policy(), checkedAt: nextNow.toISOString(), announcement: { ...policy().announcement, date: "2026-12-09", effectiveDate: "2026-12-10", rate: 2.5, previousRate: 2.75 } };
  s = await lib.scan({ policy: next }, [], nextNow); assert.equal(sends, 1); const newEvent = s.events.find(e => !e.baseline); assert.ok(newEvent.links[0].url === policyRateUrl);
  lib = create(); s = await lib.scan({ policy: next }, [], new Date(nextNow.getTime() + 1000)); assert.equal(sends, 1); assert.equal(s.events.length, 2);
  const oldPreferences = Object.fromEntries(Object.entries(s.preferences).filter(([k]) => !["policy", "grocery", "claim-deadline"].includes(k)));
  s = await lib.mutate({ action: "preferences", expectedRevision: s.revision, preferences: oldPreferences }); assert.equal(s.preferences.policy, true);
}));

test("explicit restore surfaces only the current policy baseline in-app without Push or duplication", () => sandbox(async dir => {
  const path = join(dir, "history.json"), fixture = pushFixture(); let sends = 0;
  const create = () => new NotificationLibrary(path, async () => fixture.config, async () => { sends++; return "accepted"; });
  let lib = create(), s = await lib.read();
  s = await lib.mutate({ action: "enroll", expectedRevision: s.revision, subscription: fixture.subscription, label: "Synthetic device", permission: "granted", publicKey: fixture.config.publicKey });
  const evidence = { policy: policy(), contracts: [{ ...contractEvidence(), renewal: "2026-11-02" }] };
  s = await lib.scan(evidence, [], now); const event = s.events.find(e => e.kind === "policy"), other = s.events.find(e => e.kind === "deadline");
  assert.equal(event.baseline, true); assert.equal(notificationNeedsAttention(event), false);
  const originalEvidence = { title: event.title, detail: event.detail, links: event.links, sourceDate: event.sourceDate, evidenceVersion: event.evidenceVersion };
  s = await lib.mutate({ action: "restore", id: event.id, expectedRevision: s.revision }, now);
  let restored = s.events.find(e => e.id === event.id);
  assert.equal(notificationNeedsAttention(restored), true); assert.equal(restored.pushState, "handled");
  assert.deepEqual({ title: restored.title, detail: restored.detail, links: restored.links, sourceDate: restored.sourceDate, evidenceVersion: restored.evidenceVersion }, originalEvidence);
  assert.equal(s.events.find(e => e.id === other.id).baseline, true); assert.equal(sends, 0);
  lib = create(); s = await lib.scan(evidence, [], new Date(now.getTime() + 1000));
  s = await lib.mutate({ action: "restore", id: event.id, expectedRevision: s.revision }, now);
  assert.equal(s.events.filter(e => e.id === event.id).length, 1); assert.equal(notificationNeedsAttention(s.events.find(e => e.id === event.id)), true); assert.equal(sends, 0);
  s = await lib.mutate({ action: "restore", id: other.id, expectedRevision: s.revision }, now);
  assert.equal(s.events.find(e => e.id === other.id).baseline, true);
  const expiredPath = join(dir, "expired.json"), expiredLib = new NotificationLibrary(expiredPath, async () => null, async () => { throw Error("No transport expected"); });
  let expired = await expiredLib.scan({ policy: policy() }, [], now);
  expired = await expiredLib.mutate({ action: "restore", id: expired.events[0].id, expectedRevision: expired.revision }, new Date("2026-11-20T18:00:00Z"));
  assert.equal(expired.events[0].baseline, true);
}));

test("existing contract/GIC deadline rules and source limits remain; monitoring explains missing evidence", () => {
  const e = { contracts: [contractEvidence()], finance: financeEvidence(), claimDeadlines: [] }, output = notificationCandidates(e, oldNow);
  assert.ok(output.candidates.some(c => c.kind === "deadline")); assert.equal(output.monitoring.length, 5); assert.equal(output.monitoring.find(m => m.category === "claim-deadline").status, "unavailable");
  const noData = householdCandidates({ claimDeadlines: [], invoices: { reconciliations: [], items: [] } }, today, now); assert.equal(noData.monitoring.find(m => m.category === "claim-deadline").status, "missing"); assert.equal(noData.candidates.length, 0);
});
