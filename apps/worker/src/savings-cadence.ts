import { savingsExpiryTime, type SavingsContract, type SavingsJob } from "./savings-model.js";
const day = 86_400_000;
/** Scheduling metadata is private. Only the existing public whitelist reaches research. */
export function researchIntervalDays(contract: SavingsContract, now: Date): number {
  const reference = contract.insuranceReference;
  const superseded = new Set(reference?.records.map(r => r.supersedes).filter(Boolean));
  const dates = [contract.renewal, contract.commitmentEnd, contract.promotionEnd?.date,
    ...(reference?.records.filter(r => r.kind === "policy" && r.status === "documented" && !superseded.has(r.id)
      && r.sourceIds.some(id => reference.sources.some(s => s.id === id && s.verification !== "unverified")))
      .map(r => r.effectiveTo) ?? [])];
  const until = dates.flatMap(value => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return [];
    const stamp = Date.parse(value + "T23:59:59Z");
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value || stamp < now.getTime()) return [];
    return [(stamp - now.getTime()) / day];
  });
  if (until.some(days => days <= 7)) return 1;
  if (contract.category === "mortgage") return until.some(days => days <= 90) ? 1 : 7;
  if (contract.category === "home-insurance" || contract.category === "car-insurance") return until.some(days => days <= 60) ? 7 : 30;
  return 7;
}
export function reusableResearch(contract: SavingsContract, fingerprint: string, jobs: SavingsJob[], now = new Date()): SavingsJob | undefined {
  const interval = researchIntervalDays(contract, now) * day;
  return jobs.filter(job => job.contractId === contract.id && job.baselineKey === fingerprint && job.status === "complete"
    && job.report && Number.isFinite(Date.parse(job.completedAt ?? job.createdAt))
    && Date.parse(job.completedAt ?? job.createdAt) <= now.getTime()
    && now.getTime() - Date.parse(job.completedAt ?? job.createdAt) < interval
    // Saving a result does not refresh its source checks. Both clocks must satisfy the cadence.
    && job.report.offers.every(offer => {
      const checked = Date.parse(offer.checkedAt);
      const expiry = offer.validUntil === null ? null : savingsExpiryTime(offer.validUntil);
      return Number.isFinite(checked) && checked <= now.getTime() && now.getTime() - checked < interval
        && (offer.validUntil === null || expiry !== null && expiry >= now.getTime());
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0];
}
