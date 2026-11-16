import test from "node:test";
import assert from "node:assert/strict";
import { contributionMetrics, validateContributions, type ContributionCard } from "../src/contributions";
const card: ContributionCard = { kind: "rrsp", currency: "CAD", goalCents: 600000, identifiedCents: 100000, deadline: "2030-03-01", attribution: "confirmed", beneficiary: null, beneficiaryConfirmed: false, weeklyPaid: [{id: "fixture-1", date: "2030-01-01", amountCents: 100000}], oneOffPaid: [], unassigned: [], weeklyForecast: {amountCents: 25000, count: 4, totalCents: 100000, assumption: "Rythme fictif maintenu."}, warnings: [] };
const snapshot = { schema: "familyhub.contributions-ui.v1" as const, evaluatedOn: "2030-01-01", daysPerMonth: 30, plans: [card] };
test("forecast reduces remaining effort but never progress or reached status", () => {
  const m = contributionMetrics(card, snapshot);
  assert.equal(m.remainingCents, 400000); assert.equal(m.forecastCents, 100000);
  assert.ok(Math.abs(m.percent - 100 / 6) < 0.000001); assert.equal(m.reached, false); assert.equal(m.effort, true);
});
test("strict monthly threshold, configurable month convention", () => {
  const p = {...card, deadline: "2030-01-31", goalCents: 200000, weeklyForecast: null};
  assert.equal(contributionMetrics(p, snapshot).effort, false);
  assert.equal(contributionMetrics({...p, goalCents: 200001}, snapshot).effort, true);
  assert.equal(contributionMetrics(p, {...snapshot, daysPerMonth: 31}).effort, true);
});
test("expired deadline drops future forecast and avoids infinite monthly amount", () => {
  const m = contributionMetrics(card, {...snapshot, evaluatedOn: "2031-01-01"});
  assert.equal(m.remainingDays, 0); assert.equal(m.monthlyCents, null); assert.equal(m.forecastCents, 0);
  assert.equal(m.remainingCents, 500000);
});
test("confirmed attribution and beneficiary are required for achieved REEE", () => {
  const p = {...card, kind: "resp" as const, identifiedCents: 700000, weeklyForecast: null};
  assert.equal(contributionMetrics(p, snapshot).reached, false);
  assert.equal(contributionMetrics({...p, beneficiaryConfirmed: true}, snapshot).reached, true);
  assert.equal(contributionMetrics({...p, beneficiaryConfirmed: true, attribution: "unconfirmed"}, snapshot).reached, false);
});
test("unknown and malformed values fail closed", () => {
  assert.equal(validateContributions(snapshot), snapshot);
  for (const change of [{goalCents: 0}, {goalCents: Infinity}, {deadline: "2030-02-31"}, {identifiedCents: 200000}, {weeklyForecast: undefined}, {weeklyPaid: [{id: "bad", date: "2032-01-01", amountCents: 100000}]}]) assert.throws(() => validateContributions({...snapshot, plans: [{...card, ...change}]}));
  assert.throws(() => validateContributions({...snapshot, daysPerMonth: 0}));
  assert.throws(() => validateContributions({...snapshot, plans: [card, card]}));
});
test("unassigned amounts never enter progress or remaining", () => {
  const p = {...card, unassigned: [{id: "unassigned", date: "2030-01-01", amountCents: 900000}]};
  validateContributions({...snapshot, plans: [p]});
  assert.deepEqual(contributionMetrics(p, snapshot), contributionMetrics(card, snapshot));
});

const inferredRow = { id: "inferred-source", date: "2030-01-01", amountCents: 12345, attribution: "inferred" as const, rationale: "Même référence que des virements précédents.", evidenceTransactionIds: ["historic-1", "historic-2"], sourceKey: "fsi_" + "a".repeat(64), collectedAt: "2030-01-01T12:00:00Z", bankReceiptConfirmed: false as const };
test("inferred payments are separate from identified totals, forecast and achieved status", () => {
  const p = {...card, inferredCents: 12345, inferredPayments: [inferredRow]};
  validateContributions({...snapshot, plans: [p]});
  assert.deepEqual(contributionMetrics(p, snapshot), contributionMetrics(card, snapshot));
});
test("inference rejects duplicate identities, unsupported receipt claims and inconsistent totals", () => {
  const valid = {...card, inferredCents: 12345, inferredPayments: [inferredRow]};
  for (const patch of [
    {inferredCents: 1}, {inferredCents: undefined}, {inferredPayments: undefined},
    {inferredPayments: [{...inferredRow, id: "fixture-1"}]},
    {inferredPayments: [{...inferredRow, bankReceiptConfirmed: true}]},
    {inferredPayments: [{...inferredRow, rationale: " "}]},
    {inferredPayments: [{...inferredRow, evidenceTransactionIds: []}]},
    {inferredPayments: [{...inferredRow, collectedAt: "unknown"}]},
    {inferredCents: 24690, inferredPayments: [inferredRow, {...inferredRow, id: "other"}]},
  ]) assert.throws(() => validateContributions({...snapshot, plans: [{...valid, ...patch}]}));
});

test("unknown inference total remains null rather than an assumed zero", () => {
  const p = {...card, inferredCents: null, inferredPayments: [], inferenceStatus: "source-unavailable" as const};
  assert.equal(validateContributions({...snapshot, plans:[p]}).plans[0].inferredCents, null);
  assert.deepEqual(contributionMetrics(p,snapshot),contributionMetrics(card,snapshot));
  assert.throws(()=>validateContributions({...snapshot,plans:[{...p,inferredPayments:[inferredRow]}]}));
});
