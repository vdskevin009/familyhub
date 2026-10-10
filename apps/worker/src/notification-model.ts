import type { FinanceState } from "./finance-model.js";
import { classifiedRows, recurringObservations, summarizeSpending } from "./finance-model.js";
import type { SavingsContract } from "./savings-model.js";
import type { invoiceSnapshot } from "./invoices.js";

export const notificationKinds = ["collection", "reimbursement", "unmatched", "price", "deadline", "weekly"] as const;
export type NotificationKind = typeof notificationKinds[number];
export type NotificationTarget = { view: "reimbursements" | "savings" | "finances"; recordId?: string; queue?: "unmatched"; tab?: "investments"; accountId?: string; from?: string; to?: string; currency?: string; sources?: boolean };
export type Candidate = { key: string; source: "invoices" | "collections" | "contracts" | "finance"; kind: NotificationKind; title: string; detail: string; target: NotificationTarget; sourceDate?: string };
export type NotificationEvent = Omit<Candidate, "key" | "source"> & { id: string; createdAt: string; baseline: boolean; readAt?: string; active: boolean };
export type CollectionEvidence = { id: string; label: string; state: string; lastAttempt?: string; lastSuccess?: string; authReason?: string; error?: string };
export type NotificationEvidence = { invoices?: Awaited<ReturnType<typeof invoiceSnapshot>>; collections?: CollectionEvidence[]; contracts?: SavingsContract[]; finance?: FinanceState };
export type NotificationPreferences = Record<NotificationKind, boolean>;
export const defaultNotificationPreferences = (): NotificationPreferences => Object.fromEntries(notificationKinds.map(k => [k, true])) as NotificationPreferences;
const day = 86_400_000;
export function localDate(now: Date): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const amount = (cents: number, currency: string) => new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);

/** Source facts only; no provider access, inferred promo dates or financial mutations. */
export function notificationCandidates(evidence: NotificationEvidence, now = new Date()) {
  const candidates: Candidate[] = [];
  const ready: Candidate["source"][] = [];
  const today = localDate(now);
  const daysUntil = (date: string) => validDate(date) ? Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / day) : NaN;
  const addDeadline = (key: string, source: Candidate["source"], label: string, date: string, target: NotificationTarget) => {
    const remaining = daysUntil(date);
    if (remaining < 0 || remaining > 30 || !Number.isFinite(remaining)) return;
    const window = remaining <= 1 ? "1" : remaining <= 7 ? "7" : "30";
    candidates.push({ key: `deadline:${key}:${date}:${window}`, source, kind: "deadline", title: label, detail: `Date enregistrée : ${date}. ${remaining === 0 ? "Aujourd’hui." : `Dans ${remaining} jour(s).`} Vérifiez les conditions et la source avant toute décision.`, target, sourceDate: date });
  };
  if (evidence.collections) {
    ready.push("collections");
    for (const c of evidence.collections) {
      if (["error", "login-required"].includes(c.state)) candidates.push({ key: `collection:${c.id}:${c.state}:${c.authReason ?? "error"}:${c.lastSuccess ?? "never"}`, source: "collections", kind: "collection", title: `${c.label} : collecte à vérifier`, detail: "La dernière tentative est bloquée ou incomplète. Consultez son état avant de relancer. Aucun nouvel accès ni remboursement n’est présumé.", target: { view: "reimbursements", sources: true }, sourceDate: c.lastAttempt });
      else if (c.state !== "syncing" && c.lastSuccess && now.getTime() - Date.parse(c.lastSuccess) > 7 * day) candidates.push({ key: `stale:${c.id}:${c.lastSuccess}`, source: "collections", kind: "collection", title: `${c.label} : données anciennes`, detail: "Aucune réussite enregistrée depuis plus de 7 jours. Ce seuil de fraîcheur ne prouve pas qu’une collecte planifiée a échoué.", target: { view: "reimbursements", sources: true }, sourceDate: c.lastSuccess });
    }
  }
  if (evidence.invoices && (!evidence.invoices.setupRequired || evidence.invoices.items.length)) {
    ready.push("invoices");
    const { items, reconciliations, unmatchedReimbursements } = evidence.invoices;
    for (const claim of reconciliations.filter(c => c.WorkflowStatus !== "ignore")) {
      if (claim.HasUnresolvedReimbursementEvidence) continue;
      for (const match of claim.MatchAssignments ?? []) {
        if (match.Verification !== "confirmed-manually" && !(match.Verification === "auto" && match.Confidence >= 90)) continue;
        const item = items.find(i => i.Id === match.ReimbursementDocumentId);
        if (!item || item.IgnoredAt || item.Status === 4 || item.NeedsReview || !item.ReimbursedAmount || item.ReimbursedAmount <= 0 || !item.Currency || item.Currency !== claim.Currency) continue;
        candidates.push({ key: `paid:${item.Id}:${claim.Id}:${item.ReimbursedAmount}:${item.Currency}`, source: "invoices", kind: "reimbursement", title: claim.PotentialRemaining != null && claim.PotentialRemaining > 0 ? "Remboursement partiel enregistré" : "Remboursement enregistré", detail: `Un relevé associé indique ${amount(Math.round(item.ReimbursedAmount * 100), item.Currency)}. Il s’agit du paiement documenté par l’assureur, pas d’une confirmation du dépôt bancaire.`, target: { view: "reimbursements", recordId: claim.Id }, sourceDate: item.StatementDate || item.ReceivedAt });
      }
    }
    for (const entry of unmatchedReimbursements) candidates.push({ key: `unmatched:${entry.DocumentId}:${entry.Reason}`, source: "invoices", kind: "unmatched", title: "Paiement à rapprocher", detail: "Un relevé d’assurance n’est pas associé avec certitude à une dépense. Vérifiez la source avant de confirmer un rapprochement.", target: { view: "reimbursements", recordId: entry.DocumentId, queue: "unmatched" } });
  }
  if (evidence.contracts) {
    ready.push("contracts");
    for (const c of evidence.contracts) {
      addDeadline(`${c.id}:renewal`, "contracts", `Renouvellement : ${c.name}`, c.renewal, { view: "savings", recordId: c.id });
      if (c.commitmentEnd !== c.renewal) addDeadline(`${c.id}:commitment`, "contracts", `Fin d’engagement : ${c.name}`, c.commitmentEnd, { view: "savings", recordId: c.id });
      if (c.promotionEnd?.date && c.promotionEnd.source.trim()) addDeadline(`${c.id}:promotion`, "contracts", `Fin de promotion : ${c.name}`, c.promotionEnd.date, { view: "savings", recordId: c.id });
    }
  }
  const finance = evidence.finance;
  if (finance?.data) {
    ready.push("finance");
    const rows = classifiedRows(finance).filter(r => r.status === "posted" && !r.duplicateCandidate);
    for (const observation of recurringObservations(rows)) {
      const { latest, previous, changeCents } = observation;
      const spacing = (Date.parse(latest.date) - Date.parse(previous.date)) / day;
      // Monthly-sized spacing and a material increase: review lead, never a projected saving.
      if (latest.outflowCents <= 0 || previous.outflowCents <= 0 || spacing < 20 || spacing > 45 || changeCents < 500 || changeCents / previous.outflowCents < .1 || daysUntil(latest.date) < -45 || daysUntil(latest.date) > 0) continue;
      candidates.push({ key: `price:${previous.id}:${latest.id}:${changeCents}`, source: "finance", kind: "price", title: "Prélèvement récurrent à vérifier", detail: `${latest.description} : ${amount(latest.outflowCents, latest.currency)} après ${amount(previous.outflowCents, previous.currency)}. Une hausse de paiement ne prouve pas une hausse de tarif : vérifiez taxes, période et ajustements.`, target: { view: "finances", recordId: latest.id }, sourceDate: latest.date });
    }
    for (const gic of finance.data.gics) addDeadline(`${gic.accountId}:${gic.issueDate}:${gic.principalCents}`, "finance", "Placement : échéance enregistrée", gic.maturityDate, { view: "finances", tab: "investments", accountId: gic.accountId });
    const date = new Date(today + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7 - 1);
    const to = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() - 6);
    const from = date.toISOString().slice(0, 10);
    if (finance.data.scope.from <= from && finance.data.scope.to >= to && finance.data.collectedOn.slice(0, 10) >= to) {
      for (const currency of new Set(rows.filter(r => r.date >= from && r.date <= to).map(r => r.currency))) {
        const summary = summarizeSpending(finance, from, to, "", currency);
        if (!summary.included.length) continue;
        candidates.push({ key: `weekly:${from}:${currency}`, source: "finance", kind: "weekly", title: "Votre semaine de dépenses importées", detail: `Du ${from} au ${to} : ${amount(summary.totalCents, currency)} de consommation nette observée, après remboursements et hors transferts, paiements de carte et placements classés. ${summary.unreviewedCount} opération(s) non confirmée(s). Couverture limitée aux sources importées; ce n'est pas un total garanti du foyer.`, target: { view: "finances", from, to, currency }, sourceDate: to });
      }
    }
  }
  return { candidates, ready };
}
