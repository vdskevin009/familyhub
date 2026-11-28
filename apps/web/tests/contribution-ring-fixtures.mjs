/** Fictional plans for UI tests. They are not evidence that the current worker certifies coverage. */
const verifiedAt = "2030-01-04T12:00:00Z";
const sample = {
  currency: "CAD",
  deadline: "2030-05-01",
  sourceAsOf: verifiedAt,
  retrievedAt: verifiedAt,
  sourceFreshness: "dated",
  status: "complete",
  attribution: "confirmed",
  beneficiaryConfirmed: false,
  warnings: [],
  unassigned: [{ id: "excluded", date: "2030-01-03", amountCents: 12300, currency: "CAD" }],
};
const receipt = (id, amountCents, kind = "one-off") => ({ id, amountCents, kind, date: "2030-01-04" });
const bases = {
  rrsp: {
    ...sample, id: "fictional-plan-a", kind: "rrsp", personalGoalCents: 400000, identifiedCents: 150000,
    payments: [receipt("weekly-demo", 20000, "weekly"), receipt("one-off-demo", 130000)],
    weeklyProjection: { amountCents: 10000, remainingOccurrences: 4, futureCents: 40000, assumption: "Hypothèse fictive." },
    inferredCents: 12345,
    inferredPayments: [{ id: "inferred-example", date: "2030-01-04", amountCents: 12345, attribution: "inferred",
      rationale: "Justificatif fictif.", evidenceTransactionIds: ["historical-fixture"],
      sourceKey: "fsi_" + "a".repeat(64), collectedAt: verifiedAt, bankReceiptConfirmed: false }],
  },
  resp: {
    ...sample, id: "fictional-plan-b", kind: "resp", personalGoalCents: 200000, identifiedCents: 80000,
    beneficiaryConfirmed: true, beneficiaryName: "Bénéficiaire fictif", weeklyProjection: null,
    payments: [receipt("resp-demo", 80000)],
  },
};
const amount = (plan, identifiedCents) => ({
  ...plan, identifiedCents,
  payments: identifiedCents > 0 ? [receipt("synthetic-" + plan.kind, identifiedCents)] : [],
});
const legacy = plan => ({ ...plan, sourceFreshness: "unknown", sourceAsOf: null, status: "partial",
  warnings: ["source-freshness-unverified", "coverage-incomplete", "source-limitations"] });
export function contributionRingFixture(mode = "ready") {
  const { rrsp, resp } = structuredClone(bases);
  let plans = [rrsp, resp];
  if (mode === "increase") plans = [amount(rrsp, 160000), resp];
  else if (mode === "verified-zero") plans = [amount(rrsp, 0), resp];
  else if (mode === "exceeded") plans = [amount(rrsp, 500000), resp];
  else if (mode === "at-target") plans = [amount(rrsp, rrsp.personalGoalCents), resp];
  else if (mode === "near-target") plans = [amount(rrsp, rrsp.personalGoalCents - 1), resp];
  else if (mode === "future-evidence") plans = [{ ...rrsp, sourceAsOf: "2030-01-05T00:00:00Z" }, { ...resp, sourceAsOf: "2030-01-07T00:00:00Z" }];
  else if (mode === "near-over") plans = [amount(rrsp, rrsp.personalGoalCents + 1), resp];
  else if (mode === "tiny-real") plans = [amount(rrsp, 1), resp];
  else if (mode === "partial") plans = [{ ...rrsp, status: "partial" }, { ...resp, warnings: ["coverage-incomplete"] }];
  else if (mode === "legacy-authority") plans = [legacy(rrsp)];
  else if (mode === "legacy-both") plans = [legacy(rrsp), legacy(resp)];
  else if (mode === "legacy-unknown-beneficiary") plans = [legacy(rrsp), { ...legacy(resp), beneficiaryConfirmed: false }];
  else if (mode === "legacy-zero") plans = [legacy(amount(rrsp, 0))];
  else if (mode === "legacy-progress-change") plans = [legacy(amount(rrsp, 160000))];
  else if (mode === "legacy-over-goal") plans = [legacy(amount(rrsp, 500000))];
  else if (mode === "unverified-destination") plans = [{ ...legacy(rrsp), warnings: ["destination-unverified"] }];
  else if (mode === "unverified-debit") plans = [{ ...legacy(rrsp), warnings: ["source-account-unverified"] }];
  else if (mode === "unknown-warning") plans = [{ ...legacy(rrsp), warnings: ["future-coverage-signal"] }];
  else if (mode === "unconfirmed") plans = [{ ...rrsp, attribution: "unconfirmed" }, { ...resp, beneficiaryConfirmed: false }];
  else if (mode === "missing-evidence") plans = [{ ...rrsp, sourceFreshness: "unknown", sourceAsOf: null }, { ...resp, status: undefined, sourceAsOf: null }];
  else if (mode === "source-unavailable") plans = [{ ...rrsp, warnings: ["source-unavailable"] }, resp];
  else if (mode === "no-goal") plans = [];
  if (mode === "malformed") return { schema: 0 };
  return { schema: 1, evaluatedOn: "2030-01-04", daysPerMonth: 30, plans };
}
