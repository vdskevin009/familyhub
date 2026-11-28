/** Read-only private projection. No default household goal or beneficiary. */
export type ContributionPayment = { id: string; date: string; amountCents: number };
export type InferredContributionPayment = ContributionPayment & {
  attribution: "inferred"; rationale: string; evidenceTransactionIds: string[];
  sourceKey: string; collectedAt: string; bankReceiptConfirmed: false;
};
export type ContributionCard = {
  kind: "rrsp" | "resp"; currency: string; goalCents: number; identifiedCents: number;
  deadline: string; attribution: "confirmed" | "unconfirmed";
  beneficiary: string | null; beneficiaryConfirmed: boolean;
  weeklyPaid: ContributionPayment[]; oneOffPaid: ContributionPayment[];
  unassigned: ContributionPayment[];
  inferredCents?: number | null; inferenceStatus?: "not-configured" | "requires-review" | "source-unavailable" | "available" | "partial-conflict" | "partial-canonical-overlap"; inferredPayments?: InferredContributionPayment[];
  weeklyForecast: { amountCents: number; count: number; totalCents: number; assumption: string } | null;
  warnings: string[];
  sourceAsOf?: string | null; retrievedAt?: string | null;
};
export type ContributionsSnapshot = {
  schema: "familyhub.contributions-ui.v1";
  evaluatedOn: string;
  daysPerMonth: number;
  plans: ContributionCard[];
};

const dayTime = (value: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
};
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function validateContributions(value: unknown): ContributionsSnapshot {
  const s = value as ContributionsSnapshot;
  const bad = () => { throw new Error("Contribution data was invalid. No amounts were used."); };
  if (!s || s.schema !== "familyhub.contributions-ui.v1" || !Number.isFinite(dayTime(s.evaluatedOn)) || !Number.isFinite(s.daysPerMonth) || s.daysPerMonth < 1 || s.daysPerMonth > 366 || !Array.isArray(s.plans) || s.plans.length > 2) return bad();
  const kinds = new Set<string>();
  for (const p of s.plans) {
    if (!p || !["rrsp", "resp"].includes(p.kind) || kinds.has(p.kind) || !/^[A-Z]{3}$/.test(p.currency) || !cents(p.goalCents) || p.goalCents <= 0 || !cents(p.identifiedCents) || !Number.isFinite(dayTime(p.deadline)) || !["confirmed", "unconfirmed"].includes(p.attribution) || (p.beneficiary !== null && typeof p.beneficiary !== "string") || typeof p.beneficiaryConfirmed !== "boolean" || !Array.isArray(p.warnings) || p.warnings.some(w => typeof w !== "string")) return bad();
    kinds.add(p.kind);
    if ((p.sourceAsOf != null && !Number.isFinite(Date.parse(p.sourceAsOf))) || (p.retrievedAt != null && !Number.isFinite(Date.parse(p.retrievedAt))) || (p.kind === "resp" && p.beneficiaryConfirmed && !p.beneficiary?.trim())) return bad();
    const ids = new Set<string>();
    for (const list of [p.weeklyPaid, p.oneOffPaid, p.unassigned]) {
      if (!Array.isArray(list)) return bad();
      for (const row of list) {
        if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) || !Number.isFinite(dayTime(row.date)) || row.date > s.evaluatedOn || !cents(row.amountCents)) return bad();
        ids.add(row.id);
      }
    }
    if (p.weeklyPaid.concat(p.oneOffPaid).reduce((sum, row) => sum + row.amountCents, 0) !== p.identifiedCents) return bad();
    const inferred = p.inferredPayments ?? [];
    if ((p.inferredPayments === undefined) !== (p.inferredCents === undefined) || !Array.isArray(inferred) || (p.inferredCents !== null && !cents(p.inferredCents ?? 0))) return bad();
    if (p.inferenceStatus !== undefined && !["not-configured", "requires-review", "source-unavailable", "available", "partial-conflict", "partial-canonical-overlap"].includes(p.inferenceStatus)) return bad();
    if (p.inferredCents === null && inferred.length > 0) return bad();
    const sourceKeys = new Set<string>();
    for (const row of inferred) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) || !Number.isFinite(dayTime(row.date)) || row.date > s.evaluatedOn || !cents(row.amountCents) || row.amountCents === 0 || row.attribution !== "inferred" || row.bankReceiptConfirmed !== false || typeof row.rationale !== "string" || !row.rationale.trim() || row.rationale.length > 2000 || typeof row.sourceKey !== "string" || !/^fsi_[a-f0-9]{64}$/.test(row.sourceKey) || sourceKeys.has(row.sourceKey) || !Number.isFinite(Date.parse(row.collectedAt)) || !Array.isArray(row.evidenceTransactionIds) || row.evidenceTransactionIds.length === 0 || row.evidenceTransactionIds.some(id => typeof id !== "string" || !id) || new Set(row.evidenceTransactionIds).size !== row.evidenceTransactionIds.length) return bad();
      ids.add(row.id); sourceKeys.add(row.sourceKey);
    }
    const inferredTotal = inferred.reduce((sum, row) => sum + row.amountCents, 0);
    if (!cents(inferredTotal) || inferredTotal !== (p.inferredCents ?? 0)) return bad();
    const f = p.weeklyForecast;
    if (f !== null && (p.kind !== "rrsp" || !cents(f?.amountCents) || !cents(f?.count) || !cents(f?.totalCents) || f.totalCents !== f.amountCents * f.count || typeof f.assumption !== "string" || !f.assumption.trim())) return bad();
  }
  return s;
}

export function contributionMetrics(plan: ContributionCard, snapshot: Pick<ContributionsSnapshot, "evaluatedOn" | "daysPerMonth">) {
  const remainingDays = Math.max(0, Math.round((dayTime(plan.deadline) - dayTime(snapshot.evaluatedOn)) / 86400000));
  const forecastCents = plan.kind === "rrsp" && remainingDays > 0 ? plan.weeklyForecast?.totalCents ?? 0 : 0;
  const remainingCents = Math.max(0, plan.goalCents - plan.identifiedCents - forecastCents);
  const monthlyCents = remainingDays > 0 ? remainingCents * snapshot.daysPerMonth / remainingDays : null;
  const confirmed = plan.attribution === "confirmed" && (plan.kind !== "resp" || plan.beneficiaryConfirmed);
  const reached = plan.identifiedCents >= plan.goalCents && confirmed;
  return { remainingDays, forecastCents, remainingCents, monthlyCents, reached,
    percent: plan.identifiedCents / plan.goalCents * 100,
    effort: !reached && (monthlyCents === null ? remainingCents > 0 : monthlyCents > 100000),
    months: Math.floor(remainingDays / snapshot.daysPerMonth),
    days: Math.floor(remainingDays % snapshot.daysPerMonth),
  };
}
