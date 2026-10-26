import type { MortgageDailyReport } from "./mortgage-daily.js";
import type { FinanceState } from "./finance-model.js";
import { classifiedRows, recurringObservations, summarizeSpending } from "./finance-model.js";
import type { SavingsContract } from "./savings-model.js";
import type { invoiceSnapshot } from "./invoices.js";

export const notificationKinds = ["collection", "reimbursement", "unmatched", "price", "deadline", "weekly", "mortgage"] as const;
export type NotificationKind = typeof notificationKinds[number];
export type NotificationTarget = { view: "reimbursements" | "savings" | "finances" | "mortgage"; recordId?: string; queue?: "unmatched"; tab?: "investments"; accountId?: string; from?: string; to?: string; currency?: string; sources?: boolean };
export type Candidate = { baselineGroup?: "insurance-policy"; groupKey?: string; evidenceKey?: string; actionable?: boolean; pushEligible?: boolean; expiresAt?: string; priority?: number; key: string; source: "invoices" | "collections" | "contracts" | "finance" | "mortgage"; kind: NotificationKind; title: string; detail: string; target: NotificationTarget; sourceDate?: string };
export type NotificationDecision = { evidenceVersion: string; state: "snoozed" | "resolved" | "dismissed"; at: string; snoozedUntil?: string };
export type NotificationEvent = Omit<Candidate, "key" | "source" | "baselineGroup" | "groupKey" | "evidenceKey" | "pushEligible"> & { id: string; groupId?: string; evidenceVersion?: string; createdAt: string; baseline: boolean; readAt?: string; active: boolean; decision?: NotificationDecision; pushState?: "pending" | "handled" | "expired" };
export const notificationDeliveryPolicy = { timeZone: "America/Vancouver", fromHour: 8, untilHour: 21, maximumPerDay: 1, actionOnly: true } as const;
export function notificationActionState(event: NotificationEvent, now = Date.now()): "open" | NotificationDecision["state"] {
  const decision = event.decision;
  return !decision || decision.state === "snoozed" && Date.parse(decision.snoozedUntil || "") <= now ? "open" : decision.state;
}
export function notificationNeedsAttention(event: NotificationEvent, now = Date.now()): boolean {
  return event.active && !event.baseline && event.actionable !== false && notificationActionState(event, now) === "open";
}
export type CollectionEvidence = { id: string; label: string; state: string; lastAttempt?: string; lastSuccess?: string; authReason?: string; error?: string };
export type NotificationEvidence = { invoices?: Awaited<ReturnType<typeof invoiceSnapshot>>; collections?: CollectionEvidence[]; contracts?: SavingsContract[]; finance?: FinanceState; mortgage?: MortgageDailyReport[] };
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
  const expiry = (date: string | undefined, days: number) => date && Number.isFinite(Date.parse(date)) ? new Date(Date.parse(date) + days * day).toISOString() : undefined;
  const recent = (date: string | undefined, days: number) => !!date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= now.getTime() + day && Date.parse(date) >= now.getTime() - days * day;
  const daysUntil = (date: string) => validDate(date) ? Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / day) : NaN;
  const addDeadline = (key: string, source: Candidate["source"], label: string, date: string, target: NotificationTarget, pushEligible = true, baselineGroup?: Candidate["baselineGroup"]) => {
    const remaining = daysUntil(date);
    if (remaining < 0 || remaining > 30 || !Number.isFinite(remaining)) return;
    const window = remaining <= 1 ? "1" : remaining <= 7 ? "7" : "30";
    candidates.push({ baselineGroup, groupKey: `deadline:${key}`, evidenceKey: date, actionable: true, pushEligible, priority: remaining <= 1 ? 3 : remaining <= 7 ? 2 : 1, expiresAt: expiry(date + "T12:00:00Z", 1), key: `deadline:${key}:${date}:${window}`, source, kind: "deadline", title: label, detail: `Date enregistrée : ${date}. ${remaining === 0 ? "Aujourd’hui." : `Dans ${remaining} jour(s).`} Vérifiez les conditions et la source avant toute décision.`, target, sourceDate: date });
  };
  if (evidence.mortgage) {
    const history=evidence.mortgage.filter(r=>Number.isFinite(Date.parse(r.generatedAt)) && Date.parse(r.generatedAt)<=now.getTime());
    const report=[...history].sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt))[0];
    // notify marks a newly material report, not delivery completion. A still-current signal
    // remains eligible while quiet hours/budget defer its durable pending notification.
    // First baselines never had a material notify=true; handled/seen events never rearm.
    const materialSignals=new Set(history.flatMap(r=>r.signals.filter(signal=>signal.notify).map(signal=>signal.id+":"+signal.evidenceFingerprint)));
    if(report?.localDate===today) {
      ready.push("mortgage");
      for(const signal of report.signals) candidates.push({source:"mortgage",kind:"mortgage",key:"mortgage:"+signal.id+":"+signal.evidenceFingerprint,groupKey:"mortgage:"+signal.id,evidenceKey:signal.evidenceFingerprint,actionable:true,pushEligible:materialSignals.has(signal.id+":"+signal.evidenceFingerprint),priority:signal.kind==="net-gain"?2:1,expiresAt:expiry(report.generatedAt,1),title:signal.title,detail:[signal.changed,signal.nextAction,...signal.uncertainties.slice(0,3)].join(" "),target:{view:"mortgage"},sourceDate:report.generatedAt});
    }
  }
  if (evidence.collections) {
    ready.push("collections");
    for (const c of evidence.collections) {
      if (["error", "login-required"].includes(c.state)) candidates.push({ groupKey: `collection:${c.id}`, evidenceKey: `${c.state}:${c.authReason ?? "error"}:${c.lastSuccess ?? "never"}`, actionable: true, pushEligible: recent(c.lastAttempt, 2), expiresAt: expiry(c.lastAttempt, 2), priority: 2, key: `collection:${c.id}:${c.state}:${c.authReason ?? "error"}:${c.lastSuccess ?? "never"}`, source: "collections", kind: "collection", title: `${c.label} : collecte à vérifier`, detail: "La dernière tentative est bloquée ou incomplète. Consultez son état avant de relancer. Aucun nouvel accès ni remboursement n’est présumé.", target: { view: "reimbursements", sources: true }, sourceDate: c.lastAttempt });
      else if (c.state !== "syncing" && c.lastSuccess && now.getTime() - Date.parse(c.lastSuccess) > 7 * day) candidates.push({ groupKey: `collection:${c.id}`, evidenceKey: `stale:${c.lastSuccess}`, actionable: true, pushEligible: recent(c.lastSuccess, 14), expiresAt: expiry(c.lastSuccess, 14), priority: 1, key: `stale:${c.id}:${c.lastSuccess}`, source: "collections", kind: "collection", title: `${c.label} : données anciennes`, detail: "Aucune réussite enregistrée depuis plus de 7 jours. Ce seuil de fraîcheur ne prouve pas qu’une collecte planifiée a échoué.", target: { view: "reimbursements", sources: true }, sourceDate: c.lastSuccess });
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
        candidates.push({ groupKey: `paid:${item.Id}`, evidenceKey: `${item.ReimbursedAmount}:${item.Currency}`, actionable: false, pushEligible: false, expiresAt: expiry(item.StatementDate || item.ReceivedAt, 7), key: `paid:${item.Id}:${claim.Id}:${item.ReimbursedAmount}:${item.Currency}`, source: "invoices", kind: "reimbursement", title: claim.PotentialRemaining != null && claim.PotentialRemaining > 0 ? "Remboursement partiel enregistré" : "Remboursement enregistré", detail: `Un relevé associé indique ${amount(Math.round(item.ReimbursedAmount * 100), item.Currency)}. Il s’agit du paiement documenté par l’assureur, pas d’une confirmation du dépôt bancaire.`, target: { view: "reimbursements", recordId: claim.Id }, sourceDate: item.StatementDate || item.ReceivedAt });
      }
    }
    for (const entry of unmatchedReimbursements) {
      const source = items.find(item => item.Id === entry.DocumentId), sourceDate = source?.StatementDate || source?.ReceivedAt;
      candidates.push({ groupKey: `unmatched:${entry.DocumentId}`, evidenceKey: entry.Reason, actionable: true, pushEligible: recent(sourceDate, 30) && recent(evidence.invoices.lastSuccess, 7), expiresAt: expiry(sourceDate, 30), priority: 1, sourceDate, key: `unmatched:${entry.DocumentId}:${entry.Reason}`, source: "invoices", kind: "unmatched", title: "Paiement à rapprocher", detail: "Un relevé d’assurance n’est pas associé avec certitude à une dépense. Vérifiez la source avant de confirmer un rapprochement.", target: { view: "reimbursements", recordId: entry.DocumentId, queue: "unmatched" } });
    }
  }
  if (evidence.contracts) {
    ready.push("contracts");
    for (const c of evidence.contracts) {
      const ref = c.insuranceReference, records = ref?.records ?? [], superseded = new Set(records.map(r => r.supersedes).filter(Boolean));
      const policies = records.filter(r => r.kind === "policy" && r.status === "documented" && !superseded.has(r.id));
      const active = policies.filter(p => p.effectiveTo && p.effectiveTo >= today && (!p.effectiveFrom || p.effectiveFrom <= today));
      const policy = active.length === 1 ? active[0] : active.length === 0 && policies.length === 1 ? policies[0] : undefined;
      const dateCodes = new Set(["effectiveFrom", "effectiveTo", "policy.effectiveFrom", "policy.effectiveTo", "policy.period"]);
      const verified = policy && policy.sourceIds.length > 0 && policy.sourceIds.every(id => ref?.sources.some(s => s.id === id && s.verification !== "unverified" && s.kind !== "public" && !["historical", "advertisement"].includes(s.scope)))
        && !policy.facts.some(f => f.certainty === "conflict" && dateCodes.has(f.code));
      // Conflicting coverage blocks equivalence, not an independently verified policy date.
      const renewal = active.length > 1 || policy && !verified ? "" : policy?.effectiveTo ?? c.renewal;
      addDeadline(`${c.id}:renewal`, "contracts", `Renouvellement : ${c.name}`, renewal, { view: "savings", recordId: c.id }, true, policy ? "insurance-policy" : undefined);
      if (c.commitmentEnd !== renewal) addDeadline(`${c.id}:commitment`, "contracts", `Fin d’engagement : ${c.name}`, c.commitmentEnd, { view: "savings", recordId: c.id });
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
      candidates.push({ groupKey: `price:${latest.accountId}:${latest.currency}:${latest.description.trim().toUpperCase()}`, evidenceKey: `${previous.id}:${latest.id}:${previous.outflowCents}:${latest.outflowCents}`, actionable: true, pushEligible: recent(finance.data!.collectedOn, 45), expiresAt: expiry(latest.date, 45), priority: 1, key: `price:${previous.id}:${latest.id}:${changeCents}`, source: "finance", kind: "price", title: "Prélèvement récurrent à vérifier", detail: `${latest.description} : ${amount(latest.outflowCents, latest.currency)} après ${amount(previous.outflowCents, previous.currency)}. Une hausse de paiement ne prouve pas une hausse de tarif : vérifiez taxes, période et ajustements.`, target: { view: "finances", recordId: latest.id }, sourceDate: latest.date });
    }
    for (const gic of finance.data.gics) addDeadline(`${gic.accountId}:${gic.issueDate}:${gic.principalCents}`, "finance", "Placement : échéance enregistrée", gic.maturityDate, { view: "finances", tab: "investments", accountId: gic.accountId }, recent(finance.data.collectedOn, 45));
    const date = new Date(today + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7 - 1);
    const to = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() - 6);
    const from = date.toISOString().slice(0, 10);
    if (finance.data.scope.from <= from && finance.data.scope.to >= to && finance.data.collectedOn.slice(0, 10) >= to) {
      for (const currency of new Set(rows.filter(r => r.date >= from && r.date <= to).map(r => r.currency))) {
        const summary = summarizeSpending(finance, from, to, "", currency);
        if (!summary.included.length) continue;
        candidates.push({ groupKey: `weekly:${from}:${currency}`, evidenceKey: `${from}:${currency}`, actionable: false, pushEligible: false, expiresAt: expiry(to, 7), key: `weekly:${from}:${currency}`, source: "finance", kind: "weekly", title: "Votre semaine de dépenses importées", detail: `Du ${from} au ${to} : ${amount(summary.totalCents, currency)} de consommation nette observée, après remboursements et hors transferts, paiements de carte et placements classés. ${summary.unreviewedCount} opération(s) non confirmée(s). Couverture limitée aux sources importées; ce n'est pas un total garanti du foyer.`, target: { view: "finances", from, to, currency }, sourceDate: to });
      }
    }
  }
  return { candidates, ready };
}
