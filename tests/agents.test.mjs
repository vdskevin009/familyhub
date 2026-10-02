import { test } from "node:test";
import { strict as assert } from "node:assert";
import { reviewReconciliations, reviewTargets, validateReview } from "../apps/worker/dist/agents.js";
import { buildReconciliationSnapshot } from "../apps/worker/dist/reconciliation.js";

function invoice(id, role, overrides = {}) {
  return { Id: id, Category: 0, Status: 0, DocumentRole: role, DocumentType: role === "expense" ? "receipt" : "claim",
    Member: "Kevin", Provider: "Sample clinic", ServiceDate: "2026-09-01", BilledAmount: role === "expense" ? 100 : null,
    ReimbursedAmount: role === "expense" ? null : 50, DetectedAmount: role === "expense" ? 100 : 50,
    Insurer: role === "expense" ? null : "desjardins", Currency: "CAD", Confidence: 95, NeedsReview: false,
    ClaimedService: "physio", Subject: "Sample claim", Healthcare: {}, ...overrides };
}

test("reviewer suggests a possible match but cannot assign a payment", async () => {
  const items = [invoice("a", "expense"), invoice("s", "insurer-statement", { Insurer: null })];
  const before = buildReconciliationSnapshot(items);
  assert.equal(before.unmatched[0].Reason, "missing-insurer");
  let calls = 0;
  const reviewer = async target => { calls++; return target.candidateIds.length
    ? { verdict: "possible-match", candidateId: "a", confidence: .72,
      explanation: "Même date et service, mais validation requise.", evidenceIds: ["s", "a"] }
    : { verdict: "needs-human-review", candidateId: null, confidence: .72,
      explanation: "Le relevé reste incertain.", evidenceIds: ["a"] }; };
  const first = await reviewReconciliations(items, [], reviewer);
  assert.equal(first[0].candidateId, "a");
  assert.equal(first[0].confidence, 72);
  assert.equal(buildReconciliationSnapshot(items).unmatched.length, 1);
  await reviewReconciliations(items, first, reviewer);
  assert.equal(calls, 2, "unchanged evidence reuses both reviews");
  const changed = items.map(item => item.Id === "a" ? { ...item, BilledAmount: 120 } : item);
  await reviewReconciliations(changed, first, reviewer);
  assert.equal(calls, 4, "changed evidence triggers new reviews");
});

test("review cannot cite or link an ID outside its evidence", () => {
  const items = [invoice("a", "expense"), invoice("s", "insurer-statement", { Insurer: null })];
  const target = reviewTargets(items, buildReconciliationSnapshot(items))[0];
  assert.throws(() => validateReview({ verdict: "possible-match", candidateId: "fabricated", confidence: .99,
    explanation: "Unknown", evidenceIds: ["fabricated"] }, target), /Invalid reviewer output/);
});


test("rejected match pair is not re-proposed by the second reviewer", () => {
  const items = [invoice("a", "expense"), invoice("s", "insurer-statement")];
  const snapshot = buildReconciliationSnapshot(items, [
    { reimbursementId: "s", expenseId: "a", decision: "rejected", at: "2026-09-27T12:00:00Z", confidence: 88 }
  ]);
  assert.deepEqual(snapshot.unmatched.map(({ DocumentId, Reason }) => ({ DocumentId, Reason })), [{ DocumentId: "s", Reason: "no-expense-match" }]);
  const target = reviewTargets(items, snapshot).find(item => item.key === "unmatched:s");
  assert.ok(target);
  assert.deepEqual(target.candidateIds, []);
});
