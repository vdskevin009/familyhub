import type { WorkerConfig } from "./types";
import { workerRequestHeaders } from "./worker-transport";
import { validateContributions, type ContributionsSnapshot, type InferredContributionPayment } from "./contributions";

export async function fetchContributions(config: WorkerConfig, signal: AbortSignal): Promise<ContributionsSnapshot> {
  if (!config.Endpoint || !config.ApiKey) throw new Error("Pair your PC in More to view your contributions.");
  const response = await fetch(config.Endpoint.replace(/\/$/, "") + "/contributions/progress", {
    headers: workerRequestHeaders(config, false), cache: "no-store", signal,
  });
  if (!response.ok) throw new Error(response.status === 404 ? "Contributions are unavailable on this PC. Update the worker to continue." : "Contributions are unavailable. Check the connection to your PC, then try again.");
  const raw = await response.json();
  try {
    if (raw.schema !== 1 || !Array.isArray(raw.plans)) throw new Error();
    for (const p of raw.plans) {
      if (p.currency !== "CAD" || !Array.isArray(p.warnings) || !Array.isArray(p.payments) || p.payments.some((r: {kind: string}) => !["weekly", "one-off"].includes(r.kind)) || !Array.isArray(p.unassigned) || p.unassigned.some((r: {currency: string}) => r.currency !== p.currency)) throw new Error();
    }
    return validateContributions({ schema: "familyhub.contributions-ui.v1", evaluatedOn: raw.evaluatedOn, daysPerMonth: raw.daysPerMonth,
      plans: raw.plans.map((p: { kind: string; currency: string; personalGoalCents: number; identifiedCents: number; inferredCents?: number | null; inferenceStatus?: string; inferredPayments?: InferredContributionPayment[]; deadline: string; attribution: string; beneficiaryName?: string; beneficiaryConfirmed?: boolean; payments: {id: string; date: string; amountCents: number; kind: string}[]; unassigned: unknown[]; warnings: string[]; sourceFreshness: string; status?: unknown; weeklyProjection: null | {amountCents: number; remainingOccurrences: number; futureCents: number; assumption: string} }) => ({
        kind: p.kind, currency: p.currency, goalCents: p.personalGoalCents, identifiedCents: p.identifiedCents, deadline: p.deadline,
        attribution: p.attribution, beneficiary: p.beneficiaryName ?? null, beneficiaryConfirmed: p.beneficiaryConfirmed === true,
        sourceAsOf: (p as {sourceAsOf?: string | null}).sourceAsOf ?? null, retrievedAt: (p as {retrievedAt?: string | null}).retrievedAt ?? null,
        inferredCents: p.inferredCents, inferenceStatus: p.inferenceStatus, inferredPayments: p.inferredPayments,
        weeklyPaid: p.payments.filter(r => r.kind === "weekly"), oneOffPaid: p.payments.filter(r => r.kind === "one-off"), unassigned: p.unassigned,
        // Presentation only: legacy or explicitly partial coverage never proves a goal ratio.
        warnings: [...p.warnings, ...(p.sourceFreshness !== "dated" ? ["source-freshness-unverified"] : []), ...(p.status !== "complete" ? ["coverage-unverified"] : [])],
        weeklyForecast: p.weeklyProjection === null ? null : { amountCents: p.weeklyProjection.amountCents, count: p.weeklyProjection.remainingOccurrences, totalCents: p.weeklyProjection.futureCents, assumption: p.weeklyProjection.assumption },
      })),
    });
  } catch { throw new Error("Contribution data was invalid. No amounts were used."); }
}
