import { localDate, validateQuote, type Quote } from "./mortgage-model.js";

/** Additive private decision evidence. Null means unknown; it never means free. */
export type CostEvidence = {
  amount: number | null; source: string | null; asOf: string | null;
  validUntil: string | null; financed: boolean;
};
export type DecisionProfile = {
  schema: 1; id: string; recordedAt: string; source: string;
  balanceAsOf: string | null; principal: number | null; currentRate: number | null;
  remainingMonths: number | null; maturityDate: string | null; nextPaymentDate: string | null;
  paymentAmount: number | null; rateType: "fixed" | "variable" | null;
  paymentMode: "fixed-payment" | "adjustable-payment" | null;
  compounding: "semiannual" | "monthly" | null;
  penalty: CostEvidence; currentCashbackClawback: CostEvidence; notes: string[];
  evidenceStatus?: "documented" | "user-reported" | "incomplete";
};
export type DecisionTerms = {
  schema: 1; id: string; offerId: string; recordedAt: string; source: string;
  validUntil: string | null; eligibility: "confirmed" | "unconfirmed";
  offerStatus: "indicative" | "confirmed"; compounding: "semiannual" | "monthly" | null;
  paymentAmount: number | null; fees: CostEvidence; cashback: CostEvidence;
  cashbackPaidOn: string | null;
  /** Repayment applicable at the comparison horizon under the explicitly recorded conditions. */
  cashbackClawback: CostEvidence; conditions: string[];
  /** discountPoints is positive for prime minus a discount; no prime rate is inferred. */
  prime?: { lender: string | null; rate: number | null; discountPoints: number | null; asOf: string; source: string };
};
export type RateScenario = {
  id: string; label: string; basis: "simulation";
  events: { effectiveDate: string; changePercentagePoints: number }[]; notes: string[];
};
export type LoanRow = { date: string; payment: number; interest: number; balance: number; annualRate: number; cumulativePayments: number; cumulativeInterest: number };
export type LoanProjection = { initialPayment: number; totalPayments: number; interest: number; balance: number; rows: LoanRow[]; warnings: string[] };
export type MortgageComparison = {
  offerId: string; status: "estimated" | "unavailable"; confirmed: boolean;
  startDate: string; endDate: string | null; netGain: number | null;
  breakEvenMonths: number | null; breakEvenDate: string | null;
  current: LoanProjection | null; replacement: LoanProjection | null;
  costs: { penalty: number | null; fees: number | null; currentCashbackClawback: number | null; financed: number | null; upfront: number | null; cashback: number | null; cashbackClawback: number | null };
  monthlyPaymentChange: number | null; uncertainties: string[]; nextAction: string; scenario: RateScenario;
};
export type LoanInput = {
  principal: number; annualRate: number; remainingMonths: number; startDate: string; endDate: string;
  nextPaymentDate: string; compounding: "semiannual" | "monthly";
  paymentMode: "fixed-payment" | "adjustable-payment"; paymentAmount: number | null;
  rateEvents?: { effectiveDate: string; annualRate: number }[];
};

const dayMs = 86_400_000;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 2000;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "T12:00:00Z")) && new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000_000 && Math.abs(v * 100 - Math.round(v * 100)) < .0001;
const rate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 30;
const nullable = (v: unknown, valid: (x: unknown) => boolean) => v === null || valid(v);
const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 30 && v.every(text);
const invalid = (): never => { throw new Error("Invalid mortgage decision evidence; existing evidence preserved"); };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const days = (a: string, b: string) => (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / dayMs;
function addMonths(day: string, months: number): string {
  const source = new Date(day + "T12:00:00Z"), d = new Date(source);
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(source.getUTCDate(), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
function cost(input: unknown): CostEvidence {
  const v = input as CostEvidence;
  if (!v || !nullable(v.amount, money) || !nullable(v.source, text) || !nullable(v.asOf, date) || !nullable(v.validUntil, date) || typeof v.financed !== "boolean" || v.asOf && v.validUntil && v.validUntil < v.asOf) invalid();
  if (v.amount !== null && (!v.source || !v.asOf)) invalid();
  return v;
}
export function validateDecisionProfile(input: unknown): DecisionProfile {
  const p = input as DecisionProfile;
  if (!p || p.schema !== 1 || !text(p.id) || !timestamp(p.recordedAt) || !text(p.source) || !nullable(p.balanceAsOf, date) || !nullable(p.principal, v => money(v) && v > 0) || !nullable(p.currentRate, rate) || !nullable(p.remainingMonths, v => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 600) || !nullable(p.maturityDate, date) || !nullable(p.nextPaymentDate, date) || !nullable(p.paymentAmount, v => money(v) && v > 0) || ![null, "fixed", "variable"].includes(p.rateType) || ![null, "fixed-payment", "adjustable-payment"].includes(p.paymentMode) || ![null, "semiannual", "monthly"].includes(p.compounding) || !list(p.notes)) invalid();
  cost(p.penalty); cost(p.currentCashbackClawback);
  if (p.evidenceStatus !== undefined && !["documented", "user-reported", "incomplete"].includes(p.evidenceStatus)) invalid();
  if (p.balanceAsOf && p.maturityDate && p.maturityDate <= p.balanceAsOf || p.balanceAsOf && p.nextPaymentDate && (p.nextPaymentDate <= p.balanceAsOf || p.nextPaymentDate > addMonths(p.balanceAsOf, 1))) invalid();
  if (p.rateType === "fixed" && p.paymentMode === "adjustable-payment") invalid();
  return clone(p);
}
export function validateDecisionTerms(input: unknown): DecisionTerms {
  const t = input as DecisionTerms;
  if (!t || t.schema !== 1 || !text(t.id) || !text(t.offerId) || !timestamp(t.recordedAt) || !text(t.source) || !nullable(t.validUntil, date) || !["confirmed", "unconfirmed"].includes(t.eligibility) || !["confirmed", "indicative"].includes(t.offerStatus) || ![null, "semiannual", "monthly"].includes(t.compounding) || !nullable(t.paymentAmount, v => money(v) && v > 0) || !nullable(t.cashbackPaidOn, date) || !list(t.conditions)) invalid();
  cost(t.fees); cost(t.cashback); cost(t.cashbackClawback);
  if (t.prime && (!nullable(t.prime.lender, text) || !nullable(t.prime.rate, rate) || !nullable(t.prime.discountPoints, rate) || !date(t.prime.asOf) || !text(t.prime.source))) invalid();
  if (t.cashback.financed || t.cashbackClawback.financed || t.cashback.amount !== null && t.cashbackClawback.amount !== null && t.cashbackClawback.amount > t.cashback.amount) invalid();
  return clone(t);
}
export function latestDecisionProfile(records: DecisionProfile[]): DecisionProfile | undefined {
  return [...records].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0];
}
export function decisionTermsFor(records: DecisionTerms[], offerId: string): DecisionTerms | undefined {
  return [...records].filter(t => t.offerId === offerId).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0];
}
/** Relative shocks to the contractual variable rate, not predictions of prime or of Bank of Canada decisions. */
export function rateScenarios(asOf: string): RateScenario[] {
  if (!date(asOf)) invalid();
  const effectiveDate = addMonths(asOf, 1);
  return [0, -.25, -.5, .25, .5].map(delta => ({
    id: delta === 0 ? "stable" : `${delta < 0 ? "down" : "up"}-${Math.round(Math.abs(delta) * 100)}`,
    label: delta === 0 ? "Stabilité" : `${delta < 0 ? "Baisse" : "Hausse"} ${Math.abs(delta).toFixed(2).replace(".", ",")} point`,
    basis: "simulation", events: delta === 0 ? [] : [{ effectiveDate, changePercentagePoints: delta }],
    notes: [delta === 0 ? "Taux maintenus constants pour cette simulation." : `Variation hypothétique appliquée au taux contractuel variable à partir du ${effectiveDate}, puis maintenue.`, "Aucune probabilité attribuée; le taux directeur, le prime du prêteur et les offres fixes ne sont pas interchangeables."]
  }));
}
export function validateRateScenario(input: unknown): RateScenario {
  const s = input as RateScenario;
  if (!s || !text(s.id) || !text(s.label) || s.basis !== "simulation" || !Array.isArray(s.events) || s.events.length > 20 || !list(s.notes)) invalid();
  for (const event of s.events) if (!event || !date(event.effectiveDate) || typeof event.changePercentagePoints !== "number" || !Number.isFinite(event.changePercentagePoints) || Math.abs(event.changePercentagePoints) > 10) invalid();
  if (new Set(s.events.map(e => e.effectiveDate)).size !== s.events.length || s.events.some((e, i) => i > 0 && e.effectiveDate <= s.events[i - 1].effectiveDate)) invalid();
  return clone(s);
}
function monthlyRate(annualRate: number, convention: "semiannual" | "monthly") {
  return convention === "semiannual" ? Math.expm1(Math.log1p(annualRate / 200) / 6) : annualRate / 1200;
}
function paymentFor(principal: number, annualRate: number, months: number, convention: "semiannual" | "monthly") {
  const r = monthlyRate(annualRate, convention);
  return r === 0 ? principal / months : principal * r / -Math.expm1(-months * Math.log1p(r));
}
/** Monthly payment calendar. Partial periods accrue by their fraction of that actual calendar month;
 * this explicit approximation is not a lender payout statement. Rate changes split an interest period. */
export function simulateLoan(input: LoanInput): LoanProjection {
  const p = input;
  if (!Number.isFinite(p.principal) || p.principal <= 0 || !rate(p.annualRate) || !Number.isInteger(p.remainingMonths) || p.remainingMonths < 1 || p.remainingMonths > 600 || !date(p.startDate) || !date(p.endDate) || !date(p.nextPaymentDate) || p.endDate < p.startDate || p.nextPaymentDate <= p.startDate || p.nextPaymentDate > addMonths(p.startDate, 1) || days(p.startDate, p.endDate) > 18_300 || !["semiannual", "monthly"].includes(p.compounding) || !["fixed-payment", "adjustable-payment"].includes(p.paymentMode) || p.paymentAmount !== null && (!Number.isFinite(p.paymentAmount) || p.paymentAmount <= 0) || p.paymentMode === "fixed-payment" && p.paymentAmount === null) invalid();
  const events = p.rateEvents ?? [];
  if (!Array.isArray(events) || events.length > 30 || events.some((e, i) => !date(e.effectiveDate) || !rate(e.annualRate) || e.effectiveDate < p.startDate || i > 0 && e.effectiveDate <= events[i - 1].effectiveDate)) invalid();
  let balance = p.principal, annualRate = p.annualRate, cursor = p.startDate, paidCount = 0, eventIndex = 0;
  let totalPayments = 0, totalInterest = 0;
  let payment = p.paymentAmount ?? paymentFor(balance, annualRate, p.remainingMonths, p.compounding);
  const rows: LoanRow[] = [], warnings: string[] = [];
  let initialPayment = payment;
  while (cursor < p.endDate) {
    const paymentDate = addMonths(p.nextPaymentDate, paidCount), periodStart = paidCount === 0 ? addMonths(p.nextPaymentDate, -1) : addMonths(p.nextPaymentDate, paidCount - 1);
    const target = paymentDate < p.endDate ? paymentDate : p.endDate;
    const periodDays = days(periodStart, paymentDate);
    let factor = 1, segmentStart = cursor;
    while (eventIndex < events.length && events[eventIndex].effectiveDate <= target) {
      const event = events[eventIndex];
      factor *= Math.pow(1 + monthlyRate(annualRate, p.compounding), days(segmentStart, event.effectiveDate) / periodDays);
      annualRate = event.annualRate; segmentStart = event.effectiveDate; eventIndex++;
      if (p.paymentMode === "adjustable-payment") payment = paymentFor(balance, annualRate, Math.max(1, p.remainingMonths - paidCount), p.compounding);
    }
    factor *= Math.pow(1 + monthlyRate(annualRate, p.compounding), days(segmentStart, target) / periodDays);
    const interest = balance * (factor - 1);
    const paid = target === paymentDate ? Math.min(payment, balance + interest) : 0;
    if (rows.length === 0 && paid > 0) initialPayment = paid;
    balance = Math.max(0, balance + interest - paid); totalPayments += paid; totalInterest += interest;
    rows.push({ date: target, payment: paid, interest, balance, annualRate, cumulativePayments: totalPayments, cumulativeInterest: totalInterest });
    if (target === paymentDate) {
      if (paid + .005 < interest && !warnings.includes("Amortissement négatif : le versement ne couvre pas les intérêts; règles de déclenchement du prêteur à confirmer.")) warnings.push("Amortissement négatif : le versement ne couvre pas les intérêts; règles de déclenchement du prêteur à confirmer.");
      paidCount++;
    }
    cursor = target;
  }
  return { initialPayment, totalPayments, interest: totalInterest, balance, rows, warnings };
}
function costReasons(v: CostEvidence, label: string, asOf: string, maxAge: number): string[] {
  if (v.amount === null || v.asOf === null || v.source === null) return [`${label} : montant et preuve datée à confirmer (zéro doit être explicite).`];
  if (v.asOf > asOf) return [`${label} : preuve postérieure à la date de comparaison.`];
  if (v.validUntil && v.validUntil < asOf || !v.validUntil && days(v.asOf, asOf) > maxAge) return [`${label} : preuve périmée; actualisation nécessaire.`];
  return [];
}
function unavailable(offerId: string, asOf: string, scenario: RateScenario, reasons: string[], endDate: string | null = null): MortgageComparison {
  return { offerId, status: "unavailable", confirmed: false, startDate: asOf, endDate, netGain: null, breakEvenMonths: null, breakEvenDate: null, current: null, replacement: null,
    costs: { penalty: null, fees: null, currentCashbackClawback: null, financed: null, upfront: null, cashback: null, cashbackClawback: null }, monthlyPaymentChange: null,
    uncertainties: [...new Set(reasons)], nextAction: reasons[0] ?? "Confirmer les conditions et coûts avec les pièces disponibles.", scenario };
}
/** Compare equal borrowed household capital and remaining amortization until CURRENT maturity.
 * Financed switching costs enter new debt exactly once; lower payments alone never establish savings. */
export function compareMortgage(profile: DecisionProfile | null | undefined, offer: Quote, terms: DecisionTerms | null | undefined, asOf: string, scenario?: RateScenario, policy: { maximumQuoteAgeDays?: number } = {}): MortgageComparison {
  if (!date(asOf)) invalid();
  const maximumQuoteAgeDays = policy.maximumQuoteAgeDays ?? 14;
  if (!Number.isInteger(maximumQuoteAgeDays) || maximumQuoteAgeDays < 1 || maximumQuoteAgeDays > 90) invalid();
  const path = validateRateScenario(scenario ?? rateScenarios(asOf)[0]);
  const missing: string[] = [];
  if (!profile) missing.push("Profil contractuel privé absent : solde, versement, amortissement et échéance exacte à confirmer.");
  if (!terms) missing.push("Conditions financières de cette offre absentes : frais, cashback et récupération à confirmer.");
  if (missing.length) return unavailable(offer.id, asOf, path, missing, profile?.maturityDate ?? null);
  let p: DecisionProfile, t: DecisionTerms;
  try { p = validateDecisionProfile(profile); t = validateDecisionTerms(terms); validateQuote(offer); } catch { return unavailable(offer.id, asOf, path, ["Preuves contractuelles invalides : relire les sources sans remplacer les valeurs manquantes."]); }
  const reasons: string[] = [], warnings: string[] = [];
  if (localDate(p.recordedAt) > asOf || localDate(t.recordedAt) > asOf) reasons.push("Profil ou conditions enregistrés après la date de comparaison : aucune connaissance future présumée.");
  if (p.evidenceStatus !== "documented") warnings.push("Profil fourni ou incomplet : les montants et conditions restent à corroborer avec le contrat.");
  if (t.prime) {
    if (t.prime.asOf > asOf) reasons.push("Prime du prêteur postérieur à la comparaison.");
    if (t.prime.rate !== null && t.prime.discountPoints !== null && t.prime.asOf === offer.receivedDate && Math.abs(t.prime.rate - t.prime.discountPoints - offer.rate) > .0001) reasons.push("Le prime daté et le rabais contredisent le taux du devis; confirmer la source.");
    if (t.prime.asOf !== asOf) warnings.push(`Prime ou rabais provenant du ${t.prime.asOf}; aucun prime actuel n’est déduit de ce devis.`);
  }
  if (t.offerId !== offer.id) reasons.push("Les conditions ne correspondent pas à ce devis.");
  const required: [unknown, string][] = [[p.principal, "Solde restant"], [p.balanceAsOf, "Date du solde"], [p.currentRate, "Taux actuel"], [p.remainingMonths, "Amortissement restant"], [p.maturityDate, "Échéance actuelle exacte"], [p.nextPaymentDate, "Prochain versement"], [p.paymentAmount, "Versement contractuel actuel"], [p.rateType, "Type du taux actuel"], [p.paymentMode, "Structure du versement actuel"], [p.compounding, "Capitalisation du prêt actuel"], [t.compounding, "Capitalisation de l’offre"]];
  required.forEach(([value, label]) => { if (value === null) reasons.push(`${label} à confirmer.`); });
  if (p.balanceAsOf && (p.balanceAsOf > asOf || days(p.balanceAsOf, asOf) > 31)) reasons.push("Solde daté de plus de 31 jours ou postérieur à la comparaison : actualiser le relevé.");
  if (p.rateType === "variable" && p.balanceAsOf && p.balanceAsOf !== asOf) reasons.push("Prêt actuel variable : solde et taux du jour requis sans historique contractuel des variations.");
  if (p.maturityDate && p.maturityDate <= asOf) reasons.push("Échéance actuelle atteinte : confirmer le contrat renouvelé avant toute comparaison.");
  if (p.maturityDate && p.remainingMonths && p.maturityDate > addMonths(asOf, p.remainingMonths)) reasons.push("Échéance supérieure à l’amortissement restant : données contradictoires à vérifier.");
  if (p.maturityDate && p.maturityDate > addMonths(asOf, offer.product.endsWith("3") ? 36 : 60)) reasons.push("Le nouveau terme finit avant l’échéance comparée : taux de continuation inconnu.");
  if (offer.status === "historical") reasons.push("Devis historique : obtenir une offre actuelle comparable.");
  if (offer.receivedDate > asOf) reasons.push("Le devis est postérieur à la comparaison.");
  if (t.validUntil && t.validUntil < asOf || !t.validUntil && days(offer.receivedDate, asOf) > maximumQuoteAgeDays) reasons.push("Offre expirée ou ancienne sans validité confirmée : demander une confirmation datée.");
  if (!t.validUntil) warnings.push("Échéance de l’offre inconnue; sa disponibilité doit être confirmée.");
  if (offer.variant === "unconfirmed-payment") reasons.push("Structure de paiement variable non confirmée.");
  if (offer.variant === "fixed-payment" && t.paymentAmount === null) reasons.push("Versement contractuel fixe de l’offre variable à confirmer.");
  if (t.cashback.amount && t.cashbackPaidOn === null) reasons.push("Date du versement du cashback à confirmer.");
  if (t.cashback.amount && t.cashbackPaidOn && t.cashbackPaidOn < asOf) reasons.push("Cashback daté avant le changement de prêt : vérifier la date de versement.");
  if (t.cashback.amount && t.conditions.length === 0) reasons.push("Conditions de cashback et de récupération à confirmer.");
  reasons.push(...costReasons(p.penalty, "Pénalité de remboursement", asOf, 14), ...costReasons(p.currentCashbackClawback, "Récupération de l’ancien cashback", asOf, 31), ...costReasons(t.fees, "Frais complets du changement", asOf, 31), ...costReasons(t.cashback, "Cashback reçu", asOf, 31), ...costReasons(t.cashbackClawback, "Récupération applicable du nouveau cashback à l’échéance comparée", asOf, 31));
  if (path.events.some(e => e.effectiveDate < asOf)) reasons.push("Un scénario contient une variation avant le début de comparaison.");
  const variableRates = [offer.product.startsWith("variable") ? offer.rate : null, p.rateType === "variable" ? p.currentRate : null].filter((r): r is number => r !== null);
  for (const initial of variableRates) { let r = initial; for (const event of path.events) { r += event.changePercentagePoints; if (!rate(r)) reasons.push("Variation hypothétique produisant un taux hors limites; aucun taux n’est plafonné artificiellement."); } }
  if (reasons.length) return unavailable(offer.id, asOf, path, reasons, p.maturityDate);
  const principal = p.principal!, remainingMonths = p.remainingMonths!, maturityDate = p.maturityDate!, currentRate = p.currentRate!;
  const base: LoanInput = { principal, annualRate: currentRate, remainingMonths, startDate: p.balanceAsOf!, endDate: asOf, nextPaymentDate: p.nextPaymentDate!, compounding: p.compounding!, paymentMode: p.paymentMode!, paymentAmount: p.paymentAmount };
  let initialPrincipal = principal, amortization = remainingMonths, nextPaymentDate = p.nextPaymentDate!;
  if (p.balanceAsOf !== asOf) {
    const projected = simulateLoan(base); initialPrincipal = projected.balance;
    const paidCount = projected.rows.filter(r => r.payment > 0).length;
    amortization -= paidCount; nextPaymentDate = addMonths(p.nextPaymentDate!, paidCount);
    warnings.push(`Solde projeté depuis le ${p.balanceAsOf} avec les versements contractuels connus; confirmer l’absence de paiement exceptionnel.`);
  }
  if (initialPrincipal <= 0 || amortization < 1) return unavailable(offer.id, asOf, path, ["Prêt remboursé avant la comparaison; actualiser le profil."], maturityDate);
  const charges = [p.penalty, p.currentCashbackClawback, t.fees];
  const financed = charges.filter(c => c.financed).reduce((sum, c) => sum + c.amount!, 0);
  const upfront = charges.filter(c => !c.financed).reduce((sum, c) => sum + c.amount!, 0);
  const cashback = t.cashback.amount! > 0 && t.cashbackPaidOn! <= maturityDate ? t.cashback.amount! : 0;
  const clawback = cashback > 0 ? t.cashbackClawback.amount! : 0;
  const rateEvents = (initial: number, variable: boolean) => {
    let current = initial;
    return variable ? path.events.filter(e => e.effectiveDate <= maturityDate).map(e => ({ effectiveDate: e.effectiveDate, annualRate: current += e.changePercentagePoints })) : [];
  };
  const common = { remainingMonths: amortization, startDate: asOf, endDate: maturityDate, nextPaymentDate };
  const current = simulateLoan({ ...common, principal: initialPrincipal, annualRate: currentRate, compounding: p.compounding!, paymentMode: p.paymentMode!, paymentAmount: p.paymentAmount, rateEvents: rateEvents(currentRate, p.rateType === "variable") });
  const replacementMode = offer.variant === "adjustable-payment" ? "adjustable-payment" : "fixed-payment";
  const comparablePayment = paymentFor(initialPrincipal + financed, offer.rate, amortization, t.compounding!);
  if (t.paymentAmount !== null && Math.abs(t.paymentAmount - comparablePayment) > .05) return unavailable(offer.id, asOf, path, ["Le versement proposé ne correspond pas au même capital et amortissement : confirmer les paramètres comparables."], maturityDate);
  const replacementPayment = t.paymentAmount ?? comparablePayment;
  const replacement = simulateLoan({ ...common, principal: initialPrincipal + financed, annualRate: offer.rate, compounding: t.compounding!, paymentMode: replacementMode, paymentAmount: replacementPayment, rateEvents: rateEvents(offer.rate, offer.product.startsWith("variable")) });
  const netGain = current.totalPayments - replacement.totalPayments + current.balance - replacement.balance - upfront + cashback - clawback;
  const gains = replacement.rows.map((row, index) => {
    const kept = current.rows.find(r => r.date === row.date) ?? current.rows[current.rows.length - 1];
    const earnedCashback = cashback > 0 && row.date >= t.cashbackPaidOn! ? cashback - clawback : 0;
    return { date: row.date, month: index + 1, gain: (kept?.cumulativePayments ?? 0) - row.cumulativePayments + (kept?.balance ?? 0) - row.balance - upfront + earnedCashback };
  });
  gains.unshift({ date: asOf, month: 0, gain: -financed - upfront + (cashback > 0 && t.cashbackPaidOn! <= asOf ? cashback - clawback : 0) });
  const breakEven = gains.find((value, index) => value.gain >= -.005 && gains.slice(index).every(later => later.gain >= -.005));
  warnings.push("Gain nominal, sans actualisation ni rendement présumé de la trésorerie.");
  warnings.push("Estimation mensuelle à capital et amortissement comparables; les périodes partielles sont calculées au prorata du mois calendaire. Le décompte du prêteur peut différer.");
  if (t.eligibility !== "confirmed") warnings.push("Admissibilité personnelle, transfert anticipé et accord du prêteur non confirmés.");
  if (t.offerStatus !== "confirmed") warnings.push("Offre indicative : le gain est conditionnel et ne constitue pas une approbation.");
  if (financed > 0) warnings.push("Les coûts financés augmentent le capital et produisent des intérêts; ils ne sont pas pris en charge gratuitement.");
  if (clawback > 0) warnings.push("Récupération du nouveau cashback déduite selon les conditions et l’hypothèse de sortie enregistrées.");
  if (t.cashback.amount! > 0 && cashback === 0) warnings.push("Cashback prévu après l’échéance comparée : aucun gain inclus sur cet horizon.");
  warnings.push(...current.warnings, ...replacement.warnings, ...p.notes, ...t.conditions, ...path.notes);
  const confirmed = t.offerStatus === "confirmed" && t.eligibility === "confirmed" && t.validUntil !== null && p.evidenceStatus === "documented" && current.warnings.length === 0 && replacement.warnings.length === 0;
  return { offerId: offer.id, status: "estimated", confirmed, startDate: asOf, endDate: maturityDate, netGain, breakEvenMonths: breakEven ? Math.round(days(asOf, breakEven.date) / 30.4375 * 10) / 10 : null, breakEvenDate: breakEven?.date ?? null, current, replacement,
    costs: { penalty: p.penalty.amount, fees: t.fees.amount, currentCashbackClawback: p.currentCashbackClawback.amount, financed, upfront, cashback, cashbackClawback: clawback }, monthlyPaymentChange: current.initialPayment - replacement.initialPayment,
    uncertainties: [...new Set(warnings)], nextAction: confirmed ? "Examiner le gain net, les restrictions et le décompte de remboursement avant toute décision." : "Faire confirmer les conditions, l’admissibilité et le décompte avant de décider.", scenario: path };
}
