import type { AppView, ReconciliationCase, SavingsState } from "./types";
import type { InvoiceSnapshot, SharedResearch } from "./worker";
import { buildInvoiceHistoryCases, insurerEvidenceExpenseCases, reimbursementWorkflowStatus, reimbursementWorkflowSummary } from "./invoice-state";
import { classifiedRows, type FinanceState } from "../../worker/src/finance-model";
import { compareBaskets, type GroceryPlan } from "../../worker/src/grocery-planning";
import { receiptSourceType, type GroceryLibrary } from "../../worker/src/grocery-model";
import type { MortgageState } from "../../worker/src/mortgage-model";
import type { SharedLibrary } from "../../worker/src/savings-sharing-model";
import { baselineKey, compareOffer, missingInformation, type SavingsContract } from "../../worker/src/savings-model";

export type SourceId = "claims" | "contracts" | "research" | "finances" | "groceries" | "purchases" | "mortgage";
export type SourceHealth = { id: SourceId; label: string; status: "loading" | "ready" | "error" | "unpaired"; checkedAt: string | null; sourceDate: string | null; error: string | null };
export type SourceResult<T> = SourceHealth & { data: T | null };
export type OpportunityInputs = {
  claims: SourceResult<InvoiceSnapshot>; contracts: SourceResult<SharedLibrary>; research: SourceResult<SharedResearch>;
  finances: SourceResult<FinanceState>; groceries: SourceResult<GroceryPlan>; purchases: SourceResult<GroceryLibrary>; mortgage: SourceResult<MortgageState>;
};
export type OpportunityDecision = { opportunityId: string; evidenceVersion: string; state: "seen" | "snoozed" | "dismissed" | "resolved"; at: string; snoozedUntil?: string; reason?: string };
export type Opportunity = {
  id: string; evidenceVersion: string; domain: "claims" | "insurance" | "subscriptions" | "finances" | "groceries" | "mortgage" | "system";
  title: string; description: string; actionLabel: string; target: { view: AppView; recordId?: string; tab?: string; jobId?: string; offerIndex?: number };
  benefit: { kind: "recoverable" | "potential" | "time" | "unknown"; amount: number | null; currency: "CAD"; period: "once" | "month" | "year" | "first-year" | null; label: string };
  confidence: "verified" | "conditional" | "unknown"; sourceDate: string | null; freshness: "fresh" | "stale" | "unknown";
  dueDate: string | null; effort: "low" | "medium"; status: "ready" | "needs-information" | "unavailable"; priority: number; evidence: string[];
  decision?: OpportunityDecision["state"]; snoozedUntil?: string;
};
type Draft = Omit<Opportunity, "id" | "evidenceVersion"> & { key: string; version: unknown };
export const sourceLabels: Record<SourceId, string> = { claims: "Remboursements", contracts: "Contrats", research: "Recherches", finances: "Finances", groceries: "Prix des courses", purchases: "Achats", mortgage: "Hypothèque" };
const dayMs = 86_400_000;
export const dateOnly = (value: string | null | undefined): string | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const day = value.slice(0, 10), parsed = Date.parse(day + "T12:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day ? day : null;
};
export function freshness(sourceDate: string | null, now: string, days: number): Opportunity["freshness"] {
  const source = dateOnly(sourceDate), today = dateOnly(now);
  if (!source || !today || source > today) return "unknown";
  return (Date.parse(today) - Date.parse(source)) / dayMs > days ? "stale" : "fresh";
}
export function opportunityHref(target: Opportunity["target"]): string {
  const query = new URLSearchParams({ view: target.view });
  if (target.recordId) query.set("record", target.recordId);
  if (target.tab) query.set("tab", target.tab);
  if (target.jobId) query.set("job", target.jobId);
  if (target.offerIndex !== undefined) query.set("offer", String(target.offerIndex));
  return "?" + query.toString();
}
export function applyOpportunityDecisions(opportunities: Opportunity[], decisions: Record<string, OpportunityDecision>, now: string) {
  const allOpportunities = opportunities.map(opportunity => {
    const d = decisions[opportunity.id];
    if (!d || d.evidenceVersion !== opportunity.evidenceVersion || d.state === "snoozed" && (!d.snoozedUntil || Date.parse(d.snoozedUntil) <= Date.parse(now))) return opportunity;
    return { ...opportunity, decision: d.state, ...(d.snoozedUntil ? { snoozedUntil: d.snoozedUntil } : {}) };
  });
  return { allOpportunities, opportunities: allOpportunities.filter(o => !o.decision || o.decision === "seen") };
}
const unknownBenefit = (label = "Gain à chiffrer"): Opportunity["benefit"] => ({ kind: "unknown", amount: null, currency: "CAD", period: null, label });
const latestDate = (dates: (string | null | undefined)[]) => dates.map(dateOnly).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
function baselineEvidenceCurrent(contract: SavingsContract, now: string) {
  // The mortgage model still labels principal/amortization as assumptions. Do not turn
  // a recent payment (capital + interest) into a verified current loan balance.
  if (contract.category === "mortgage") return false;
  const billing = contract.billing;
  if (!billing?.source.trim() || billing.amount === null) return false;
  if (contract.category.includes("insurance")) {
    const ref = contract.insuranceReference, today = dateOnly(now)!;
    if (!ref) return false;
    const superseded = new Set(ref.records.map(r => r.supersedes).filter(Boolean));
    const active = ref.records.filter(r => r.kind === "policy" && r.status === "documented" && !superseded.has(r.id) && r.effectiveFrom && r.effectiveFrom <= today && r.effectiveTo && r.effectiveTo >= today);
    if (active.length !== 1 || !active[0].sourceIds.length || active[0].facts.some(f => f.certainty === "conflict") || !active[0].sourceIds.every(id => ref.sources.some(s => s.id === id && s.kind !== "public" && !["historical", "advertisement"].includes(s.scope) && s.verification !== "unverified"))) return false;
  }
  const period = billing.count * ({ days: 1, weeks: 7, months: 31, years: 366 }[billing.unit]);
  if (freshness(billing.asOf, now, Math.max(45, Math.min(400, period + 31))) !== "fresh") return false;
  const renewal = dateOnly(contract.renewal);
  return !renewal || renewal >= dateOnly(now)!;
}
function claimsCases(snapshot: InvoiceSnapshot): ReconciliationCase[] {
  const ignored = (snapshot.ignoredExpenses ?? []).map(c => ({ ...c, WorkflowStatus: c.WorkflowStatus ?? "ignore" as const }));
  const base = [...snapshot.reconciliations, ...ignored];
  const inference = [...snapshot.unmatchedReimbursements, ...snapshot.ignoredUnmatchedReimbursements].filter((c, i, a) => a.findIndex(x => x.DocumentId === c.DocumentId) === i);
  const cases = buildInvoiceHistoryCases([...base, ...insurerEvidenceExpenseCases(base, inference, snapshot.items)], snapshot.items);
  return cases.filter((c, i) => cases.findIndex(x => x.Id === c.Id) === i);
}
async function digestText(value: string) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const digest = (value: unknown) => digestText(JSON.stringify(value));

/** Private, read-only projections. No card starts a collector or changes financial authority. */
export async function buildOpportunityFeed(input: OpportunityInputs, now = new Date().toISOString(), reviews: SavingsState["Reviews"] = []) {
  const drafts: Draft[] = [], today = dateOnly(now)!;
  const add = (draft: Draft) => drafts.push(draft);
  let recoverable = { amount: null as number | null, currency: "CAD" as const, known: 0, unknown: 0 };
  const available = <T,>(source: SourceResult<T>): source is SourceResult<T> & { data: T } => source.status === "ready" && source.data !== null;
  const base = (domain: Opportunity["domain"], source: SourceHealth, days = 30) => ({ domain, sourceDate: source.sourceDate, freshness: freshness(source.sourceDate, now, days), dueDate: null, effort: "low" as const, status: "needs-information" as const, confidence: "conditional" as const });
  if (available(input.claims)) {
    const cases = claimsCases(input.claims.data), summary = reimbursementWorkflowSummary(cases, "all"), fresh = input.claims.data.setupRequired || input.claims.data.error ? "unknown" : freshness(input.claims.sourceDate, now, 7);
    recoverable = { amount: fresh === "fresh" && (summary.knownAmounts > 0 || summary.open === 0) ? summary.potentiallyRecoverable : null, currency: "CAD", known: summary.knownAmounts, unknown: summary.unknownAmounts };
    for (const item of cases.filter(c => reimbursementWorkflowStatus(c) === "open")) {
      const own = reimbursementWorkflowSummary([item], "all");
      const amount = fresh === "fresh" && own.knownAmounts > 0 ? own.potentiallyRecoverable : null;
      const prepare = ["submit-primary", "submit-secondary"].includes(item.Action) && !item.HasUnresolvedReimbursementEvidence && !item.PreviouslyFound && !item.OriginalInvoiceMissing && !item.Unreconciled;
      add({ ...base("claims", input.claims, 7), key: "claim:" + item.Id, version: [item.Action, item.NextInsurer, item.OriginalAmount, item.ReimbursedAmount, item.PotentialRemaining, item.HasUnresolvedReimbursementEvidence, item.PreviouslyFound, item.OriginalInvoiceMissing, item.DocumentIds, item.MatchAssignments, fresh],
        title: prepare ? "Préparer la prochaine demande" : "Clarifier ce remboursement", description: `${item.Provider || "Dossier de soins"}${item.Member !== "unknown" ? ` · ${item.Member}` : ""}${item.NextInsurer ? ` · ${item.NextInsurer}` : ""}`,
        actionLabel: prepare ? "Ouvrir le dossier" : "Vérifier les preuves", target: { view: "reimbursements", recordId: item.Id },
        benefit: { kind: "recoverable", amount, currency: "CAD", period: "once", label: amount === null ? "Montant à vérifier" : "Reste potentiellement récupérable" }, status: prepare && fresh === "fresh" ? "ready" : "needs-information",
        priority: (prepare ? 78 : 66) + (amount === null ? 0 : Math.min(8, Math.floor(amount / 50))) - (fresh === "fresh" ? 0 : 12),
        evidence: ["L’ordre des assureurs et les décisions du dossier restent inchangés.", "Montant potentiel, ni droit garanti ni paiement reçu.", ...(item.HasUnresolvedReimbursementEvidence ? ["Rapprochement ambigu : montant exclu du total."] : []), ...(fresh !== "fresh" ? ["Collecte à actualiser avant toute décision."] : []), "Aucune demande soumise automatiquement."] });
    }
  }
  const qualifiedContracts = new Set<string>();
  if (available(input.contracts) && available(input.research)) {
    const contracts = input.contracts.data.records.map(r => r.contract), knownIds = new Set(contracts.map(c => c.id));
    const candidates = [];
    const reviewable = [];
    for (const c of contracts) {
      const localKey = baselineKey(c), fingerprint = await digestText(localKey);
      const currentJobs = input.research.data.jobs.filter(j => j.contractId === c.id && j.baselineKey === fingerprint && j.status === "complete" && j.report).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = currentJobs[0];
      if (latest?.report) {
        const local = reviews?.find(r => r.job.id === latest.id && r.localKey === localKey);
        const index = latest.report.offers.findIndex((offer, i) => {
          if (local?.decisions[String(i)] === "dismissed") return false;
          const result = compareOffer(c, offer, new Date(now), false);
          return freshness(offer.checkedAt, now, 30) === "fresh" && result.firstYear !== null && result.firstYear > 0 && result.reasons.every(reason => reason.startsWith("Review all policy"));
        });
        if (index >= 0) reviewable.push({ c, job: latest, offer: latest.report.offers[index], index });
      }
      for (const review of reviews ?? []) {
        if (review.job.contractId !== c.id || review.localKey !== localKey || review.job.baselineKey !== fingerprint) continue;
        const job = input.research.data.jobs.find(j => j.id === review.job.id && j.contractId === c.id && j.baselineKey === fingerprint && j.status === "complete");
        if (!job?.report) continue;
        for (const [index, offer] of job.report.offers.entries()) {
          if (review.decisions[String(index)] !== "shortlist" || JSON.stringify(review.job.report?.offers[index]) !== JSON.stringify(offer)) continue;
          const result = compareOffer(c, offer, new Date(now), true), affected = new Set([c.id, ...offer.affectedContractIds]);
          if (!baselineEvidenceCurrent(c, now) || freshness(offer.checkedAt, now, 30) !== "fresh" || result.firstYear === null || result.firstYear <= 0 || result.reasons.length || [...affected].some(id => !knownIds.has(id) || id !== c.id)) continue;
          candidates.push({ c, job, offer, index, result, affected });
        }
      }
    }
    candidates.sort((a, b) => b.result.firstYear! - a.result.firstYear! || a.c.id.localeCompare(b.c.id) || a.job.id.localeCompare(b.job.id) || a.index - b.index);
    for (const { c, job, offer, index, result, affected } of candidates) {
      if ([...affected].some(id => qualifiedContracts.has(id))) continue;
      affected.forEach(id => qualifiedContracts.add(id));
      add({ ...base(c.category.includes("insurance") ? "insurance" : c.category === "mortgage" ? "mortgage" : "subscriptions", input.research), key: "reviewed-offer:" + c.id,
        version: [baselineKey(c), offer, result.firstYear], title: "Examiner une économie documentée", description: `${c.provider || c.name} → ${offer.provider} · ${offer.title}`, actionLabel: "Examiner l’offre retenue",
        target: { view: "savings", recordId: c.id, jobId: job.id, offerIndex: index }, benefit: { kind: "potential", amount: Math.round(result.firstYear! * 100) / 100, currency: "CAD", period: "first-year", label: "Économie nette estimée — première année" },
        status: "ready", confidence: "conditional", freshness: "fresh", sourceDate: dateOnly(offer.checkedAt), dueDate: dateOnly(offer.validUntil), priority: 80 + Math.min(8, Math.floor(result.firstYear! / 250)),
        evidence: ["Exigences revues et offre placée dans votre sélection sur cet appareil.", "Promotions, frais de changement et rabais perdus inclus dans le calcul.", "Estimation publique : admissibilité et tarif final restent à confirmer.", "Aucun gain réalisé, contact ni changement de contrat enregistré."] });
    }
    for (const { c, job, offer, index } of reviewable) {
      if (qualifiedContracts.has(c.id)) continue;
      qualifiedContracts.add(c.id);
      add({ ...base(c.category.includes("insurance") ? "insurance" : c.category === "mortgage" ? "mortgage" : "subscriptions", input.research), key: "reviewed-offer:" + c.id, version: [baselineKey(c), offer, "requirements-unreviewed"],
        title: "Vérifier une offre comparable", description: `${c.provider || c.name} → ${offer.provider} · exigences à revoir`, actionLabel: "Examiner la comparaison", target: { view: "savings", recordId: c.id, jobId: job.id, offerIndex: index },
        benefit: unknownBenefit("Économie à valider"), sourceDate: dateOnly(offer.checkedAt), freshness: "fresh", dueDate: dateOnly(offer.validUntil), priority: 58,
        evidence: ["Le prix public ne prouve pas l’équivalence de vos prestations.", "Validez les exigences et les conditions avant de retenir une estimation."] });
    }
  }
  if (available(input.contracts)) {
    for (const { contract: c } of input.contracts.data.records) {
      if (qualifiedContracts.has(c.id)) continue;
      const ref = c.insuranceReference, records = ref?.records ?? [], superseded = new Set(records.map(r => r.supersedes).filter(Boolean));
      const policies = records.filter(r => r.kind === "policy" && r.status === "documented" && !superseded.has(r.id));
      const activePolicies = policies.filter(p => p.effectiveTo && p.effectiveTo >= today && (!p.effectiveFrom || p.effectiveFrom <= today));
      const policy = activePolicies.length === 1 ? activePolicies[0] : activePolicies.length === 0 && policies.length === 1 ? policies[0] : undefined;
      // Coverage disagreements block equivalence, but do not erase an independently documented policy date.
      // Fact codes are open-ended: only explicit policy date/period fields invalidate this deadline.
      const dateFactCodes = new Set(["effectiveFrom", "effectiveTo", "policy.effectiveFrom", "policy.effectiveTo", "policy.period"]);
      const dateConflict = policy?.facts.some(f => f.certainty === "conflict" && dateFactCodes.has(f.code));
      const coverageConflict = policy?.facts.some(f => f.certainty === "conflict" && !dateFactCodes.has(f.code));
      const policyVerified = policy && policy.sourceIds.length > 0 && policy.sourceIds.every(id => ref?.sources.some(s => s.id === id && s.verification !== "unverified" && s.kind !== "public" && s.scope !== "historical" && s.scope !== "advertisement")) && !dateConflict;
      const due = activePolicies.length > 1 || policy && !policyVerified ? null : dateOnly(policy?.effectiveTo) ?? dateOnly(c.renewal);
      const days = due ? Math.round((Date.parse(due) - Date.parse(today)) / dayMs) : null;
      const insurance = c.category === "car-insurance" || c.category === "home-insurance";
      const awaiting = records.filter(r => r.kind === "quote-request" && r.status === "awaiting_quote" && !superseded.has(r.id));
      const quotes = records.filter(r => r.kind === "quote" && r.status === "received" && r.validUntil && r.validUntil >= today && !superseded.has(r.id));
      const sourceDate = latestDate(ref?.sources.map(s => s.date) ?? [c.billing?.asOf]);
      if (insurance && (days === null || days <= 90 || awaiting.length || quotes.length)) {
        const expired = due !== null && due < today;
        add({ ...base("insurance", input.contracts), key: "insurance:" + c.id, version: [due, activePolicies.map(p => [p.id, p.effectiveTo, p.facts]).sort(), policy?.id, policy?.comparison, awaiting.map(r => r.id).sort(), quotes.map(r => [r.id, r.quotedAnnualPremium, r.comparison, r.validUntil]), expired], sourceDate,
          freshness: expired ? "stale" : policyVerified && activePolicies.length === 1 ? "fresh" : "unknown", dueDate: due,
          title: expired ? "Vérifier le renouvellement" : due ? "Préparer le renouvellement" : "Compléter l’échéance d’assurance", description: `${c.provider || c.name}${awaiting.length ? ` · ${awaiting.length} devis en attente` : quotes.length ? ` · ${quotes.length} devis reçu(s)` : " · garanties à comparer"}`,
          actionLabel: quotes.length ? "Comparer les garanties" : "Ouvrir le dossier", target: { view: "savings", recordId: c.id }, benefit: unknownBenefit(),
          priority: days !== null && days >= 0 && days <= 30 ? 94 : days !== null && days >= 0 && days <= 60 ? 86 : 60,
          evidence: ["Demande de devis et offre reçue sont distinctes.", "Comparer garanties, franchises, taxes et frais avant de chiffrer.", ...(activePolicies.length > 1 ? ["Plusieurs polices actives : échéance à rapprocher avant de prioriser."] : []), ...(policy && !policyVerified ? ["Preuve de date de police non vérifiée ou contradictoire."] : []), ...(coverageConflict ? ["Garanties contradictoires : échéance conservée, équivalence et gain à vérifier."] : []), ...(policy?.limitations ?? []), "Aucun contact ni changement de contrat automatique."] });
      } else if (!insurance && c.category !== "mortgage") {
        const missing = missingInformation(c);
        if (missing.length) add({ ...base("subscriptions", input.contracts), key: "subscriptions:" + c.id, version: [c.id, c.billing, c.promotionEnd, c.currentPromoMonths, c.priceAfterPromo, c.cancellationFee, c.annualLostDiscounts, c.renewal, c.services], sourceDate: dateOnly(c.billing?.asOf), freshness: freshness(c.billing?.asOf ?? null, now, 45),
          title: "Vérifier le coût du contrat", description: `${c.provider || c.name} · comparaison encore incomplète`, actionLabel: "Compléter les preuves", target: { view: "savings", recordId: c.id }, benefit: unknownBenefit(), dueDate: dateOnly(c.promotionEnd?.date) ?? due,
          priority: c.currentPromoMonths > 0 ? 57 : 39, evidence: ["Le débit observé ne suffit pas à établir le tarif actuel.", "Vérifier les services inclus, la fin de promotion, les frais et les rabais perdus.", "Aucune économie ni redondance d’abonnement n’est présumée."] });
      }
    }
  }
  if (available(input.research)) {
    const daily = input.research.data.daily;
    if (daily?.outcome && !["complete", "no-shared-contracts", "running"].includes(daily.outcome)) add({ ...base("system", input.research, 7), key: "research-interrupted", version: [daily.outcome, daily.results?.map(r => r.outcome)], title: "Recherche à vérifier", description: "La dernière vérification des offres n’a pas terminé tous les contrats.", actionLabel: "Voir les recherches", target: { view: "savings" }, benefit: unknownBenefit("Résultats partiels"), status: "unavailable", priority: 38, evidence: ["Les anciens résultats gardent leur date.", "Aucune requête incertaine n’est relancée par cet écran."] });
  }
  if (available(input.finances)) {
    const state = input.finances.data, data = state.data, fresh = freshness(data?.collectedOn ?? null, now, 14);
    const review = classifiedRows(state).filter(r => r.status === "posted" && (r.nature === "review" || r.nature === "expense" && r.category === "other"));
    if (!data || fresh !== "fresh" || review.length) add({ ...base("finances", input.finances, 14), key: "finance-review", version: [Boolean(data), fresh, review.map(r => r.id).sort()], sourceDate: dateOnly(data?.collectedOn), freshness: fresh,
      title: !data ? "Ajouter les relevés privés" : fresh !== "fresh" ? "Actualiser les dépenses" : "Clarifier les dépenses", description: !data ? "Un relevé daté permet d’identifier les frais à vérifier." : `${review.length} opération(s) à clarifier · sources du ${dateOnly(data.collectedOn) ?? "jour inconnu"}`,
      actionLabel: data && review.length && fresh === "fresh" ? "Vérifier une opération" : "Ouvrir les sources", target: { view: "finances", ...(review.length && fresh === "fresh" ? { recordId: review[0].id } : {}), tab: "expenses" }, benefit: unknownBenefit("Frais et doublons à vérifier"), priority: fresh === "fresh" ? 51 : 45,
      evidence: ["Les transferts et paiements de carte ne sont pas des dépenses à économiser.", "Une répétition de libellé n’établit pas un abonnement.", "La lecture du PC ne reconnecte pas la banque."] });
  }
  if (available(input.groceries)) {
    const plan = input.groceries.data, result = compareBaskets(plan, today), best = result.best;
    if (result.count) add({ ...base("groceries", input.groceries, 7), key: "grocery-plan", version: [plan.items.filter(i => i.active), best?.key, best?.total, result.coverage, result.count, result.truncated, plan.prices.map(p => [p.id, p.price, p.approved, p.available, p.evidence.until, p.localityConfirmed])],
      title: best ? "Un panier complet à examiner" : "Compléter le panier local", description: best ? `${best.name} · ${result.count} articles couverts` : `${result.coverage}/${result.count} articles avec une référence approuvée · panier à vérifier`, actionLabel: best ? "Comparer les paniers" : "Voir les prix manquants", target: { view: "groceries", tab: "compare" },
      benefit: unknownBenefit(best ? "Panier chiffré, gain non établi" : "Gain indisponible"), status: best ? "ready" : "needs-information", confidence: best ? "verified" : "conditional", freshness: best ? "fresh" : freshness(input.groceries.sourceDate, now, 7), priority: best ? 67 : 47,
      evidence: ["Formats, quantité, lieu, mode et frais doivent être comparables.", "Un total de panier n’est pas une économie.", ...(result.truncated ? ["Recherche de combinaisons incomplète : aucun meilleur panier affirmé."] : []), "Aucune commande passée."] });
  }
  if (available(input.purchases)) {
    for (const r of input.purchases.data.records.filter(r => r.status === "saved" && !r.duplicateOf && receiptSourceType(r) === "confirmation")) add({ ...base("groceries", input.purchases), key: "grocery-receipt:" + r.id, version: [r.id, r.receipt.sourceType, r.receipt.fulfillment, r.receipt.total, r.receipt.warnings], sourceDate: r.receipt.date, freshness: freshness(r.receipt.date, now, 30),
      title: "Retrouver le montant final", description: `${r.receipt.store || "Commande"} · ${r.receipt.date || "date à confirmer"}`, actionLabel: "Ouvrir l’achat", target: { view: "groceries", tab: "tickets", recordId: r.id }, benefit: unknownBenefit("Estimation, pas prix payé"), priority: 49,
      evidence: ["Une confirmation, même livrée, n’atteste pas le montant final débité.", "Le total estimatif reste exclu des dépenses payées."] });
  }
  if (available(input.mortgage)) {
    const state = input.mortgage.data, latest = [...state.snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).at(-1);
    add({ ...base("mortgage", input.mortgage, 3), key: "mortgage-evidence", version: [latest?.status, state.assumptions.map(a => [a.principal, a.currentRate, a.remainingMonths, a.currentMaturity]), state.quotes.map(q => [q.id, q.rate, q.receivedDate]), state.offers?.map(q => [q.id, q.rate, q.receivedDate])], sourceDate: latest?.collectedAt ?? null, freshness: freshness(latest?.collectedAt ?? null, now, 3),
      title: "Établir le gain hypothécaire net", description: latest ? "Taux observés ; solde, pénalité et frais à confirmer." : "Le relevé actuel est nécessaire pour une comparaison utile.", actionLabel: "Ouvrir l’hypothèque", target: { view: "mortgage" }, benefit: unknownBenefit("Gain net inconnu"), priority: 44,
      evidence: ["Un taux public n’est pas une offre personnellement approuvée.", "Baisse de mensualité, économie d’intérêts et cashback restent distincts.", "Les hypothèses ne remplacent pas un solde ni une pénalité documentés."] });
  }
  const failed = Object.values(input).filter(s => s.status === "error" || s.status === "unpaired");
  if (failed.length) add({ domain: "system", key: "sources-unavailable", version: failed.map(s => [s.id, s.status]).sort(), title: failed.every(s => s.status === "unpaired") ? "Connecter le PC du foyer" : "Sources à actualiser", description: failed.map(s => s.label).join(" · "), actionLabel: "Vérifier la connexion", target: { view: "more" }, benefit: unknownBenefit("Situation partiellement connue"), confidence: "unknown", sourceDate: null, freshness: "unknown", dueDate: null, effort: "low", status: "unavailable", priority: Object.values(input).some(s => s.status === "ready" && s.data !== null) ? 25 : 96, evidence: ["Une source indisponible ne signifie pas qu’il n’y a rien à faire.", "Les données privées restent sur le PC ; aucune nouvelle collecte n’est lancée."] });
  const opportunities = await Promise.all(drafts.map(async ({ key, version, ...card }): Promise<Opportunity> => ({ ...card, id: card.domain + ":" + await digest(key), evidenceVersion: "v1:" + await digest(version) })));
  opportunities.sort((a, b) => b.priority - a.priority || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id.localeCompare(b.id));
  return { opportunities, recoverable };
}
