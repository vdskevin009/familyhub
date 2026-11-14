import type { WorkerConfig } from "./types";
import { workerRequestHeaders } from "./worker-transport";
import { validateContributions, type ContributionsSnapshot } from "./contributions";

export async function fetchContributions(config: WorkerConfig, signal: AbortSignal): Promise<ContributionsSnapshot> {
  if (!config.Endpoint || !config.ApiKey) throw new Error("Associez votre PC dans Plus pour consulter vos contributions.");
  const response = await fetch(config.Endpoint.replace(/\/$/, "") + "/contributions/progress", {
    headers: workerRequestHeaders(config, false), cache: "no-store", signal,
  });
  if (!response.ok) throw new Error(response.status === 404 ? "Contributions indisponibles sur ce PC. Une mise à jour du worker est nécessaire." : "Contributions indisponibles. Vérifiez la connexion au PC puis réessayez.");
  const raw = await response.json();
  try {
    if (raw.schema !== 1 || !Array.isArray(raw.plans)) throw new Error();
    for (const p of raw.plans) {
      if (p.currency !== "CAD" || !Array.isArray(p.payments) || p.payments.some((r: {kind: string}) => !["weekly", "one-off"].includes(r.kind)) || !Array.isArray(p.unassigned) || p.unassigned.some((r: {currency: string}) => r.currency !== p.currency)) throw new Error();
    }
    return validateContributions({ schema: "familyhub.contributions-ui.v1", evaluatedOn: raw.evaluatedOn, daysPerMonth: raw.daysPerMonth,
      plans: raw.plans.map((p: { kind: string; currency: string; personalGoalCents: number; identifiedCents: number; deadline: string; attribution: string; beneficiaryName?: string; beneficiaryConfirmed?: boolean; payments: {id: string; date: string; amountCents: number; kind: string}[]; unassigned: unknown[]; warnings: string[]; sourceFreshness: string; weeklyProjection: null | {amountCents: number; remainingOccurrences: number; futureCents: number; assumption: string} }) => ({
        kind: p.kind, currency: p.currency, goalCents: p.personalGoalCents, identifiedCents: p.identifiedCents, deadline: p.deadline,
        attribution: p.attribution, beneficiary: p.beneficiaryName ?? null, beneficiaryConfirmed: p.beneficiaryConfirmed === true,
        sourceAsOf: (p as {sourceAsOf?: string | null}).sourceAsOf ?? null, retrievedAt: (p as {retrievedAt?: string | null}).retrievedAt ?? null,
        weeklyPaid: p.payments.filter(r => r.kind === "weekly"), oneOffPaid: p.payments.filter(r => r.kind === "one-off"), unassigned: p.unassigned,
        warnings: [...p.warnings, ...(p.sourceFreshness !== "dated" ? ["Fraîcheur de la source non confirmée."] : [])],
        weeklyForecast: p.weeklyProjection === null ? null : { amountCents: p.weeklyProjection.amountCents, count: p.weeklyProjection.remainingOccurrences, totalCents: p.weeklyProjection.futureCents, assumption: p.weeklyProjection.assumption },
      })),
    });
  } catch { throw new Error("Données de contributions invalides. Aucun montant n’a été retenu."); }
}
