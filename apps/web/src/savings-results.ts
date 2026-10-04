import type { SavingsState } from "./types";
import { comparisonFingerprint, baselineKey, type SavingsContract, type SavingsJob } from "./savings";

export async function prepareSharedReviews(jobs: SavingsJob[], contracts: SavingsContract[]) {
  const fingerprints = await Promise.all(contracts.map(async contract => ({ contract, fingerprint: await comparisonFingerprint(contract) })));
  return jobs.flatMap(job => {
    const match = fingerprints.find(item => item.contract.id === job.contractId && item.fingerprint === job.baselineKey);
    return match ? [{ job, localKey: baselineKey(match.contract), decisions: {} }] : [];
  });
}
export function mergeResearchReviews(existing: NonNullable<SavingsState["Reviews"]>, incoming: NonNullable<SavingsState["Reviews"]>) {
  const merged = new Map(existing.map(review => [review.job.id, review]));
  for (const review of incoming) {
    const saved = merged.get(review.job.id);
    merged.set(review.job.id, saved ? { ...saved, job: review.job } : review);
  }
  return [...merged.values()].sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt));
}
