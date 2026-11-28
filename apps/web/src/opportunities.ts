import type { AppView, ReconciliationCase, SavingsState } from "./types";
import type { InvoiceSnapshot, SharedResearch } from "./worker";
import { buildInvoiceHistoryCases, insurerEvidenceExpenseCases, reimbursementWorkflowStatus, reimbursementWorkflowSummary } from "./invoice-state";
import { classifiedRows, type FinanceState } from "../../worker/src/finance-model";
import { compareBaskets, type GroceryPlan } from "../../worker/src/grocery-planning";
import { receiptSourceType, type GroceryLibrary } from "../../worker/src/grocery-model";
import type { MortgageState } from "../../worker/src/mortgage-model";
import type { SharedLibrary } from "../../worker/src/savings-sharing-model";
import { baselineKey, compareOffer, missingInformation, type SavingsContract } from "../../worker/src/savings-model";
import { prepareClaim } from "../../worker/src/claim-preparation";
import type { Invoice } from "../../worker/src/invoice-model";
import type { ReconciliationCase as WorkerReconciliationCase } from "../../worker/src/reconciliation";

export type SourceId = "claims" | "contracts" | "research" | "finances" | "groceries" | "purchases" | "mortgage";
export type SourceHealth = { id: SourceId; label: string; status: "loading" | "ready" | "error" | "unpaired"; checkedAt: string | null; sourceDate: string | null; error: string | null; coverage?: ClaimCoverage };
/** Bounded projection only: never forward account progress or raw source errors to the assistant. */
export type ClaimCoverage = { complete: boolean | null; heldMessages: number | null };
export function claimCoverage(snapshot: Pick<InvoiceSnapshot, "coverage">): ClaimCoverage {
  const raw = snapshot.coverage;
  const heldMessages = typeof raw?.heldMessages === "number" && Number.isSafeInteger(raw.heldMessages) && raw.heldMessages >= 0 ? raw.heldMessages : null;
  return { complete: raw?.complete === false || (heldMessages ?? 0) > 0 ? false : raw?.complete === true ? true : null, heldMessages };
}
export type SourceResult<T> = SourceHealth & { data: T | null };
export type OpportunityInputs = {
  claims: SourceResult<InvoiceSnapshot>; contracts: SourceResult<SharedLibrary>; research: SourceResult<SharedResearch>;
  finances: SourceResult<FinanceState>; groceries: SourceResult<GroceryPlan>; purchases: SourceResult<GroceryLibrary>; mortgage: SourceResult<MortgageState>;
};
export type OpportunityContext = { kind: "insurance-renewal"; recordId: string; dueDate: string };
export type OpportunityDecision = { opportunityId: string; evidenceVersion: string; state: "seen" | "snoozed" | "dismissed" | "resolved"; at: string; snoozedUntil?: string; reason?: string; context?: OpportunityContext };
export type Opportunity = {
  id: string; evidenceVersion: string; domain: "claims" | "insurance" | "subscriptions" | "finances" | "groceries" | "mortgage" | "system";
  title: string; description: string; actionLabel: string; target: { view: AppView; recordId?: string; tab?: string; jobId?: string; offerIndex?: number };
  benefit: { kind: "recoverable" | "potential" | "time" | "unknown"; amount: number | null; currency: "CAD"; period: "once" | "month" | "year" | "first-year" | null; label: string };
  confidence: "verified" | "conditional" | "unknown"; sourceDate: string | null; freshness: "fresh" | "stale" | "unknown";
  dueDate: string | null; effort: "low" | "medium"; status: "ready" | "needs-information" | "waiting" | "unavailable"; priority: number; evidence: string[];
  decision?: OpportunityDecision["state"]; snoozedUntil?: string; context?: OpportunityContext;
};
type Draft = Omit<Opportunity, "id" | "evidenceVersion"> & { key: string; version: unknown };
export const sourceLabels: Record<SourceId, string> = { claims: "Reimbursements", contracts: "Contracts", research: "Research", finances: "Finances", groceries: "Grocery prices", purchases: "Purchases", mortgage: "Mortgage" };
const dayMs = 86_400_000;
export const dateOnly = (value: string | null | undefined): string | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const day = value.slice(0, 10), parsed = Date.parse(day + "T12:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day ? day : null;
};
/** Deadlines are civil dates in the existing household calendar, not known expiry instants. */
export function opportunitySnoozeTiming(dueDate: string | null, delayMs: number, now = new Date()): "unknown" | "past" | "today" | "same-day" | "after" | "before" {
  if (!dueDate || dateOnly(dueDate) !== dueDate || !Number.isFinite(now.getTime()) || !Number.isFinite(delayMs) || delayMs <= 0) return "unknown";
  const returning = new Date(now.getTime() + delayMs);
  if (!Number.isFinite(returning.getTime())) return "unknown";
  const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = calendar.format(now), returnDate = calendar.format(returning);
  return dueDate < today ? "past" : dueDate === today ? "today" : returnDate === dueDate ? "same-day" : returnDate > dueDate ? "after" : "before";
}
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
const unknownBenefit = (label = "Benefit not yet quantified"): Opportunity["benefit"] => ({ kind: "unknown", amount: null, currency: "CAD", period: null, label });
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

/** Fresh imminent deadlines, useful actions now, then passive follow-up. */
export function rankOpportunities(a: Opportunity, b: Opportunity, now: string) {
  const tier = (o: Opportunity) => {
    const days = o.dueDate && dateOnly(o.dueDate) ? (Date.parse(o.dueDate) - Date.parse(dateOnly(now)!)) / dayMs : null;
    if (o.freshness === "fresh" && o.status !== "waiting" && o.status !== "unavailable" && days !== null && days >= 0 && days <= 7) return 0;
    if (o.status === "ready" && o.freshness === "fresh") return 1;
    if (o.status === "needs-information" && o.freshness === "fresh") return 2;
    if (o.status === "needs-information") return 3;
    if (o.status === "waiting") return 4;
    return 5;
  };
  return tier(a) - tier(b) || b.priority - a.priority || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id.localeCompare(b.id);
}

/** Private, read-only projections. No card starts a collector or changes financial authority. */
export async function buildOpportunityFeed(input: OpportunityInputs, now = new Date().toISOString(), reviews: SavingsState["Reviews"] = []) {
  const drafts: Draft[] = [], today = dateOnly(now)!;
  const add = (draft: Draft) => drafts.push(draft);
  let recoverable = { amount: null as number | null, currency: "CAD" as const, known: 0, unknown: 0 };
  const available = <T,>(source: SourceResult<T>): source is SourceResult<T> & { data: T } => source.status === "ready" && source.data !== null;
  const base = (domain: Opportunity["domain"], source: SourceHealth, days = 30) => ({ domain, sourceDate: source.sourceDate, freshness: freshness(source.sourceDate, now, days), dueDate: null, effort: "low" as const, status: "needs-information" as const, confidence: "conditional" as const });
  if (available(input.claims)) {
    const cases = claimsCases(input.claims.data), summary = reimbursementWorkflowSummary(cases, "all"), fresh = input.claims.data.setupRequired || input.claims.data.error ? "unknown" : freshness(input.claims.sourceDate, now, 7);
    recoverable = { amount: claimCoverage(input.claims.data).complete !== false && fresh === "fresh" && (summary.knownAmounts > 0 || summary.open === 0) ? summary.potentiallyRecoverable : null, currency: "CAD", known: summary.knownAmounts, unknown: summary.unknownAmounts };
    for (const item of cases.filter(c => reimbursementWorkflowStatus(c) === "open")) {
      const own = reimbursementWorkflowSummary([item], "all");
      const amount = fresh === "fresh" && own.knownAmounts > 0 ? own.potentiallyRecoverable : null;
      const targetInsurer = item.NextInsurer === "Blue Cross" ? "blue-cross" : item.NextInsurer === "Desjardins" ? "desjardins" : null;
      const original = input.claims.data.items.find(doc => item.DocumentIds.includes(doc.Id) && doc.Category === 0 && doc.DocumentRole === "expense");
      let dossier: ReturnType<typeof prepareClaim> | undefined;
      // Same read-only source projection as the PC preview. Web types accept
      // legacy snapshots; incomplete legacy shapes abstain instead of launching.
      try { if (original && targetInsurer) dossier = prepareClaim(original.Id, targetInsurer, input.claims.data.items as Invoice[], input.claims.data.reconciliations as WorkerReconciliationCase[]); } catch { /* Incomplete source snapshot: ask for evidence. */ }
      const prepare = ["submit-primary", "submit-secondary"].includes(item.Action) && !item.HasUnresolvedReimbursementEvidence && !item.PreviouslyFound && !item.OriginalInvoiceMissing && !item.Unreconciled && dossier?.readiness.status === "source-ready";
      const preparationEvidence = dossier ? [dossier.fields, dossier.attachments, dossier.coordination, dossier.originalAmountEvidence, dossier.duplicate.status, dossier.blocked] : "original-source-unavailable";
      add({ ...base("claims", input.claims, 7), key: "claim:" + item.Id, version: [item.Action, item.NextInsurer, item.OriginalAmount, item.ReimbursedAmount, item.PotentialRemaining, item.HasUnresolvedReimbursementEvidence, item.PreviouslyFound, item.OriginalInvoiceMissing, item.DocumentIds, item.MatchAssignments, fresh, "dossier-source-readiness", preparationEvidence],
        title: prepare ? "Prepare the next claim" : "Review this reimbursement", description: `${item.Provider || "Healthcare claim"}${item.Member !== "unknown" ? ` · ${item.Member}` : ""}${item.NextInsurer ? ` · ${item.NextInsurer}` : ""}`,
        actionLabel: prepare ? "Open claim" : "Check evidence", target: { view: "reimbursements", recordId: item.Id },
        benefit: { kind: "recoverable", amount, currency: "CAD", period: "once", label: amount === null ? "Amount to verify" : "Potentially recoverable balance" }, status: prepare && fresh === "fresh" ? "ready" : "needs-information",
        priority: (prepare ? 78 : 66) + (amount === null ? 0 : Math.min(8, Math.floor(amount / 50))) - (fresh === "fresh" ? 0 : 12),
        evidence: ["The order of insurers and the decisions on this claim are unchanged.", "Potential amount only, not guaranteed coverage or a payment received.", ...(item.HasUnresolvedReimbursementEvidence ? ["Uncertain match: this amount is excluded from the total."] : []), ...(fresh !== "fresh" ? ["Refresh the source before making a decision."] : []), "No claim has been submitted automatically."] });
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
        version: [baselineKey(c), offer, result.firstYear], title: "Review documented savings", description: `${c.provider || c.name} → ${offer.provider} · ${offer.title}`, actionLabel: "Review shortlisted offer",
        target: { view: "savings", recordId: c.id, jobId: job.id, offerIndex: index }, benefit: { kind: "potential", amount: Math.round(result.firstYear! * 100) / 100, currency: "CAD", period: "first-year", label: "Estimated net savings in the first year" },
        status: "ready", confidence: "conditional", freshness: "fresh", sourceDate: dateOnly(offer.checkedAt), dueDate: dateOnly(offer.validUntil), priority: 80 + Math.min(8, Math.floor(result.firstYear! / 250)),
        evidence: ["You reviewed the requirements and shortlisted this offer on this device.", "The estimate accounts for promotions, switching costs and lost discounts.", "Based on public pricing. Eligibility and the final rate still need confirmation.", "No realized savings, provider contact or contract change has been recorded."] });
    }
    for (const { c, job, offer, index } of reviewable) {
      if (qualifiedContracts.has(c.id)) continue;
      qualifiedContracts.add(c.id);
      add({ ...base(c.category.includes("insurance") ? "insurance" : c.category === "mortgage" ? "mortgage" : "subscriptions", input.research), key: "reviewed-offer:" + c.id, version: [baselineKey(c), offer, "requirements-unreviewed"],
        title: "Check whether the offer is comparable", description: `${c.provider || c.name} → ${offer.provider} · requirements to review`, actionLabel: "Review comparison", target: { view: "savings", recordId: c.id, jobId: job.id, offerIndex: index },
        benefit: unknownBenefit("Savings to verify"), sourceDate: dateOnly(offer.checkedAt), freshness: "fresh", dueDate: dateOnly(offer.validUntil), priority: 58,
        evidence: ["A public price does not establish that the benefits match yours.", "Check the requirements and terms before relying on an estimate."] });
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
        // A request already awaiting a reply is not a new task. A verified
        // deadline within a week returns it to attention without another contact.
        const imminent = policyVerified && days !== null && days >= 0 && days <= 7;
        const waiting = awaiting.length > 0 && !quotes.length && due !== null && days !== null && days > 7;
        add({ ...base("insurance", input.contracts), key: "insurance:" + c.id, version: [due, activePolicies.map(p => [p.id, p.effectiveTo, p.facts]).sort(), policy?.id, policy?.comparison, awaiting.map(r => r.id).sort(), quotes.map(r => [r.id, r.quotedAnnualPremium, r.comparison, r.validUntil]), expired, ...(imminent ? ["deadline-within-7-days"] : [])], sourceDate,
          freshness: expired ? "stale" : policyVerified && activePolicies.length === 1 ? "fresh" : "unknown", dueDate: due,
          ...(due ? { context: { kind: "insurance-renewal" as const, recordId: c.id, dueDate: due } } : {}),
          title: expired ? "Review renewal" : waiting ? "Quotes pending" : imminent && awaiting.length ? "Review upcoming deadline" : due ? "Prepare for renewal" : "Add the insurance expiry date", description: `${c.provider || c.name}${awaiting.length ? ` · ${awaiting.length} ${awaiting.length === 1 ? "quote" : "quotes"} pending` : quotes.length ? ` · ${quotes.length} ${quotes.length === 1 ? "quote" : "quotes"} received` : " · coverage to compare"}`,
          actionLabel: quotes.length ? "Compare coverage" : waiting ? "View follow-up" : "Review policy", target: { view: "savings", recordId: c.id }, benefit: unknownBenefit(), status: waiting ? "waiting" : "needs-information",
          priority: days !== null && days >= 0 && days <= 30 ? 94 : days !== null && days >= 0 && days <= 60 ? 86 : 60,
          evidence: ["A quote request is not a quote received.", "Compare coverage, deductibles, taxes and fees before calculating savings.", ...(activePolicies.length > 1 ? ["Several policies are active. Match the renewal date before prioritizing."] : []), ...(policy && !policyVerified ? ["The policy date is unverified or conflicts with another source."] : []), ...(coverageConflict ? ["Coverage details conflict. The deadline is retained, but equivalence and savings need review."] : []), ...(policy?.limitations ?? []), "No automatic contact or contract changes."] });
      } else if (!insurance && c.category !== "mortgage") {
        const missing = missingInformation(c);
        if (missing.length) add({ ...base("subscriptions", input.contracts), key: "subscriptions:" + c.id, version: [c.id, c.billing, c.promotionEnd, c.currentPromoMonths, c.priceAfterPromo, c.cancellationFee, c.annualLostDiscounts, c.renewal, c.services], sourceDate: dateOnly(c.billing?.asOf), freshness: freshness(c.billing?.asOf ?? null, now, 45),
          title: "Check contract cost", description: `${c.provider || c.name} · comparison incomplete`, actionLabel: "Add supporting evidence", target: { view: "savings", recordId: c.id }, benefit: unknownBenefit(), dueDate: dateOnly(c.promotionEnd?.date) ?? due,
          priority: c.currentPromoMonths > 0 ? 57 : 39, evidence: ["A recorded charge does not establish the current rate.", "Check included services, promotion expiry, fees and discounts lost by switching.", "No savings or duplicate subscription is assumed."] });
      }
    }
  }
  if (available(input.research)) {
    const daily = input.research.data.daily;
    if (daily?.outcome && !["complete", "no-shared-contracts", "running"].includes(daily.outcome)) add({ ...base("system", input.research, 7), key: "research-interrupted", version: [daily.outcome, daily.results?.map(r => r.outcome)], title: "Research needs review", description: "The latest offer check did not finish checking all contracts.", actionLabel: "View research", target: { view: "savings" }, benefit: unknownBenefit("Partial results"), status: "unavailable", priority: 38, evidence: ["Previous results retain their original dates.", "This screen does not retry an unconfirmed request."] });
  }
  if (available(input.finances)) {
    const state = input.finances.data, data = state.data, fresh = freshness(data?.collectedOn ?? null, now, 14);
    const review = classifiedRows(state).filter(r => r.status === "posted" && (r.nature === "review" || r.nature === "expense" && r.category === "other"));
    if (!data || fresh !== "fresh" || review.length) add({ ...base("finances", input.finances, 14), key: "finance-review", version: [Boolean(data), fresh, review.map(r => r.id).sort()], sourceDate: dateOnly(data?.collectedOn), freshness: fresh,
      title: !data ? "Add private statements" : fresh !== "fresh" ? "Refresh spending data" : "Review spending", description: !data ? "A dated statement can help identify fees to review." : `${review.length} transactions to review · source date: ${dateOnly(data.collectedOn) ?? "date unknown"}`,
      actionLabel: data && review.length && fresh === "fresh" ? "Review transaction" : "Open sources", target: { view: "finances", ...(review.length && fresh === "fresh" ? { recordId: review[0].id } : {}), tab: "expenses" }, benefit: unknownBenefit("Fees and possible duplicates to review"), priority: fresh === "fresh" ? 51 : 45,
      evidence: ["Transfers and credit card payments are not savings opportunities.", "Repeated descriptions do not establish a subscription.", "Reading records from the PC does not reconnect the bank."] });
  }
  if (available(input.groceries)) {
    const plan = input.groceries.data, result = compareBaskets(plan, today), best = result.best;
    if (result.count) add({ ...base("groceries", input.groceries, 7), key: "grocery-plan", version: [plan.items.filter(i => i.active), best?.key, best?.total, result.coverage, result.count, result.truncated, plan.prices.map(p => [p.id, p.price, p.approved, p.available, p.evidence.until, p.localityConfirmed])],
      title: best ? "Review a complete basket" : "Complete the local basket", description: best ? `${best.name} · ${result.count} items covered` : `${result.coverage}/${result.count} items with an approved reference · basket needs review`, actionLabel: best ? "Compare baskets" : "View missing prices", target: { view: "groceries", tab: "compare" },
      benefit: unknownBenefit(best ? "Basket priced; savings unknown" : "Savings unavailable"), status: best ? "ready" : "needs-information", confidence: best ? "verified" : "conditional", freshness: best ? "fresh" : freshness(input.groceries.sourceDate, now, 7), priority: best ? 67 : 47,
      evidence: ["Sizes, quantities, location, fulfilment method and fees must be comparable.", "A basket total is not an amount saved.", ...(result.truncated ? ["The search did not cover every combination. No best basket has been identified."] : []), "No order has been placed."] });
  }
  if (available(input.purchases)) {
    for (const r of input.purchases.data.records.filter(r => r.status === "saved" && !r.duplicateOf && receiptSourceType(r) === "confirmation")) add({ ...base("groceries", input.purchases), key: "grocery-receipt:" + r.id, version: [r.id, r.receipt.sourceType, r.receipt.fulfillment, r.receipt.total, r.receipt.warnings], sourceDate: r.receipt.date, freshness: freshness(r.receipt.date, now, 30),
      title: "Find final amount paid", description: `${r.receipt.store || "Order"} · ${r.receipt.date || "date to confirm"}`, actionLabel: "Open purchase", target: { view: "groceries", tab: "tickets", recordId: r.id }, benefit: unknownBenefit("Estimate, not the price paid"), priority: 49,
      evidence: ["Even a delivered order confirmation does not establish the final amount charged.", "Estimated totals are excluded from paid spending."] });
  }
  if (available(input.mortgage)) {
    const state = input.mortgage.data, latest = [...state.snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).at(-1);
    add({ ...base("mortgage", input.mortgage, 3), key: "mortgage-evidence", version: [latest?.status, state.assumptions.map(a => [a.principal, a.currentRate, a.remainingMonths, a.currentMaturity]), state.quotes.map(q => [q.id, q.rate, q.receivedDate]), state.offers?.map(q => [q.id, q.rate, q.receivedDate])], sourceDate: latest?.collectedAt ?? null, freshness: freshness(latest?.collectedAt ?? null, now, 3),
      title: "Calculate net mortgage savings", description: latest ? "Rates observed. Confirm the balance, penalty and fees." : "A current statement is needed for a meaningful comparison.", actionLabel: "Open mortgage", target: { view: "mortgage" }, benefit: unknownBenefit("Net savings unknown"), priority: 44,
      evidence: ["A public rate is not a personal mortgage approval.", "Lower payments, interest savings and cash back are separate.", "Assumptions cannot replace a documented balance or penalty."] });
  }
  const failed = Object.values(input).filter(s => s.status === "error" || s.status === "unpaired");
  if (failed.length) add({ domain: "system", key: "sources-unavailable", version: failed.map(s => [s.id, s.status]).sort(), title: failed.every(s => s.status === "unpaired") ? "Connect your household PC" : "Sources need refreshing", description: failed.map(s => s.label).join(" · "), actionLabel: "Check connection", target: { view: "more" }, benefit: unknownBenefit("Incomplete information"), confidence: "unknown", sourceDate: null, freshness: "unknown", dueDate: null, effort: "low", status: "unavailable", priority: Object.values(input).some(s => s.status === "ready" && s.data !== null) ? 25 : 96, evidence: ["An unavailable source does not mean there is nothing to do.", "Private data stays on your PC. No new collection starts here."] });
  const opportunities = await Promise.all(drafts.map(async ({ key, version, ...card }): Promise<Opportunity> => ({ ...card, id: card.domain + ":" + await digest(key), evidenceVersion: "v1:" + await digest(version) })));
  opportunities.sort((a, b) => rankOpportunities(a, b, now));
  return { opportunities, recoverable };
}
