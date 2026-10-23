import { baselineSnapshot, localDate, snapshotOn, productKeys, type MortgageState, type ProductKey } from "./mortgage-model.js";
import { mortgageIndicatorFresh, validateMortgageIndicator, unavailableMortgageContext, validateMortgageContext, type MortgageContextSource, type MortgageIndicator } from "./mortgage-sources.js";

export type MortgageAlertSettings = { id: string; recordedAt: string; minimumNetGain: number; materialNetGainChange: number; rateImprovementPoints: number; expiringWithinDays: number; maximumQuoteAgeDays: number };
export function defaultMortgageAlertSettings(recordedAt = new Date().toISOString()): MortgageAlertSettings { return { id: "mortgage-defaults-v1", recordedAt, minimumNetGain: 1000, materialNetGainChange: 500, rateImprovementPoints: .10, expiringWithinDays: 7, maximumQuoteAgeDays: 14 }; }
export const mortgageThresholdExplanations = {
  minimumNetGain: "1 000 $ nets à l’échéance actuelle : ordre de grandeur proposé pour justifier la démarche; aucune garantie de gain.",
  materialNetGainChange: "500 $ de changement net : évite de répéter le même signal pour quelques dollars.",
  rateImprovementPoints: "0,10 point de baisse : déclenche une revue seulement pour le même produit, prêteur, profil et conditions observées.",
  expiringWithinDays: "7 jours : laisse le temps de vérifier une proposition intéressante avant sa date d’expiration documentée.",
  maximumQuoteAgeDays: "14 jours sans date de validité confirmée : le devis doit être reconfirmé avant de chiffrer une décision actuelle.",
} as const;
export type MortgageComparisonSummary = { offerId: string; status: "estimated" | "unavailable"; confirmed: boolean; netGain: number | null; breakEvenMonths: number | null; uncertainties: string[]; nextAction: string; validUntil?: string | null; endDate?: string | null; monthlyPaymentChange?: number | null };
export type MortgageSignal = { id: string; kind: "net-gain" | "rate-improvement" | "offer-expiry" | "missing-data"; title: string; changed: string; potentialGain: number | null; uncertainties: string[]; nextAction: string; offerId?: string; evidenceFingerprint: string; notify: boolean; confirmation: "opportunity" | "confirmed-offer" };
export type MortgageDailyReport = {
  schema: 1; id: string; inputFingerprint?: string; localDate: string; generatedAt: string; status: "opportunity" | "blocked" | "watch";
  summary: string; netGain: number | null; nextAction: string; uncertainties: string[]; missing: string[]; snapshotId: string | null;
  freshness: { rates: "current" | "partial" | "failed" | "missing"; lastRateAttemptAt: string | null; sourceFailures: string[] };
  comparisons: MortgageComparisonSummary[]; indicators: MortgageIndicator[]; contextSources: MortgageContextSource[]; signals: MortgageSignal[];
  facts: string[]; forecasts: string[]; assumptions: string[]; diagnosisTriggers: string[]; settings: MortgageAlertSettings;
};
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "T12:00:00Z")) && new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const text = (v: unknown, max = 2000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(s => text(s));
const nullableNumber = (v: unknown): v is number | null => v === null || typeof v === "number" && Number.isFinite(v);
const days = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86_400_000);
const unique = (values: string[]) => [...new Set(values)].sort();
function canonical(value: unknown): string { return value && typeof value === "object" ? Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" : "{" + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}" : JSON.stringify(value); }
/** Deterministic identity, not a security boundary. Immutable store still compares complete record content. */
export function mortgageEvidenceFingerprint(value: unknown): string { let hash = 14695981039346656037n; for (const char of canonical(value)) { hash ^= BigInt(char.codePointAt(0)!); hash = BigInt.asUintN(64, hash * 1099511628211n); } return hash.toString(16).padStart(16, "0"); }
export function validateMortgageAlertSettings(value: unknown): MortgageAlertSettings {
  const s = value as MortgageAlertSettings;
  if (!s || !text(s.id, 200) || !timestamp(s.recordedAt) || !Number.isFinite(s.minimumNetGain) || s.minimumNetGain < 0 || s.minimumNetGain > 1000000 || !Number.isFinite(s.materialNetGainChange) || s.materialNetGainChange < 1 || s.materialNetGainChange > 1000000 || !Number.isFinite(s.rateImprovementPoints) || s.rateImprovementPoints <= 0 || s.rateImprovementPoints > 5 || !Number.isInteger(s.expiringWithinDays) || s.expiringWithinDays < 1 || s.expiringWithinDays > 90 || !Number.isInteger(s.maximumQuoteAgeDays) || s.maximumQuoteAgeDays < 1 || s.maximumQuoteAgeDays > 90) throw new Error("Invalid mortgage alert thresholds; prior settings preserved");
  return structuredClone(s);
}
export function validateMortgageDailyReport(value: unknown): MortgageDailyReport {
  const r = value as MortgageDailyReport, fail = () => { throw new Error("Invalid mortgage daily report; prior reports preserved"); };
  if (!r || r.schema !== 1 || !text(r.id, 200) || !date(r.localDate) || !timestamp(r.generatedAt) || localDate(r.generatedAt) !== r.localDate || !["opportunity", "blocked", "watch"].includes(r.status) || !text(r.summary) || !text(r.nextAction) || !nullableNumber(r.netGain) || !(r.snapshotId === null || text(r.snapshotId)) || !strings(r.uncertainties) || !strings(r.missing) || !strings(r.facts) || !strings(r.forecasts) || !strings(r.assumptions) || !strings(r.diagnosisTriggers)) fail();
  if (r.inputFingerprint !== undefined && !/^[a-f0-9]{16}$/.test(r.inputFingerprint)) fail();
  validateMortgageAlertSettings(r.settings);
  if (!r.freshness || !["current", "partial", "failed", "missing"].includes(r.freshness.rates) || !(r.freshness.lastRateAttemptAt === null || timestamp(r.freshness.lastRateAttemptAt)) || !strings(r.freshness.sourceFailures) || !Array.isArray(r.indicators) || r.indicators.length > 100 || !Array.isArray(r.comparisons) || r.comparisons.length > 100 || !Array.isArray(r.signals) || r.signals.length > 100) fail();
  r.indicators.forEach(validateMortgageIndicator); if (!Array.isArray(r.contextSources) || r.contextSources.length > 20) fail(); r.contextSources.forEach(validateMortgageContext);
  for (const c of r.comparisons) if (!text(c.offerId, 200) || !["estimated", "unavailable"].includes(c.status) || typeof c.confirmed !== "boolean" || !nullableNumber(c.netGain) || !nullableNumber(c.breakEvenMonths) || c.breakEvenMonths !== null && c.breakEvenMonths < 0 || !strings(c.uncertainties) || !text(c.nextAction) || c.status === "unavailable" && c.netGain !== null || c.validUntil !== undefined && c.validUntil !== null && !date(c.validUntil) || c.endDate !== undefined && c.endDate !== null && !date(c.endDate)) fail();
  for (const s of r.signals) if (!text(s.id, 200) || !["net-gain", "rate-improvement", "offer-expiry", "missing-data"].includes(s.kind) || !text(s.title) || !text(s.changed) || !nullableNumber(s.potentialGain) || !strings(s.uncertainties) || !text(s.nextAction) || !/^[a-f0-9]{16}$/.test(s.evidenceFingerprint) || typeof s.notify !== "boolean" || !["opportunity", "confirmed-offer"].includes(s.confirmation)) fail();
  return structuredClone(r);
}
export function buildMortgageDailyReport(input: { state: MortgageState; now?: Date; inputFingerprint?: string; previous?: MortgageDailyReport[]; settings?: MortgageAlertSettings; indicators?: MortgageIndicator[]; contextSources?: MortgageContextSource[]; comparisons?: MortgageComparisonSummary[] }): MortgageDailyReport {
  const now = input.now ?? new Date(), today = localDate(now), generatedAt = now.toISOString(), state = input.state;
  const settings = validateMortgageAlertSettings(input.settings ?? defaultMortgageAlertSettings(generatedAt));
  const history = (input.previous ?? []).filter(r => Date.parse(r.generatedAt) <= now.getTime());
  const current = snapshotOn({ ...state, snapshots: state.snapshots.filter(s => Date.parse(s.collectedAt) <= now.getTime()) }, today), latest = state.snapshots.filter(s => Date.parse(s.collectedAt) <= now.getTime()).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
  const contextSources = (input.contextSources ?? unavailableMortgageContext()).map(validateMortgageContext);
  const indicators = (input.indicators ?? []).map(validateMortgageIndicator), comparisons = structuredClone(input.comparisons ?? []);
  const allOffers = [...state.quotes, ...(state.offers ?? [])], superseded = new Set(allOffers.map(q => q.supersedes).filter(Boolean));
  const offers = allOffers.filter(q => q.status !== "historical" && !superseded.has(q.id) && q.receivedDate <= today);
  const missing: string[] = [], uncertainties: string[] = [], facts: string[] = [];
  const sourceFailures = indicators.filter(i => !mortgageIndicatorFresh(i, now, i.key === "prime-benchmark" ? 10 : i.key === "cpi-yearly" ? 75 : 7)).map(i => i.label);
  sourceFailures.push(...contextSources.filter(s => s.status !== "observed").map(s => s.label));
  if (!contextSources.some(s => s.key === "policy-calendar" && s.status === "observed")) missing.push("Prochaine décision de politique monétaire non vérifiée.");
  if (!current) missing.push("Observation des quatre produits pour aujourd’hui absente.");
  else if (current.status !== "complete") missing.push(current.status === "failed" ? "Dernière collecte des taux échouée; les valeurs antérieures restent datées." : "Collecte des taux partielle; les produits manquants restent inconnus.");
  if (current) facts.push(`Dernière collecte de taux : ${current.localDate}, ${current.observations.filter(o => o.status === "observed").length} produit(s) observé(s).`);
  if (baselineSnapshot(state)) facts.push(`Référence figée du ${state.baselineDate} conservée.`);
  if (!offers.length) missing.push("Aucune proposition personnelle actuelle enregistrée.");
  const eligible = comparisons.filter(c => {
    const offer = offers.find(q => q.id === c.offerId);
    if (!offer) return false;
    const expired = c.validUntil ? c.validUntil < today : days(today, offer.receivedDate) > settings.maximumQuoteAgeDays;
    if (expired) { missing.push(`Validité du devis ${offer.lender} à reconfirmer.`); return false; }
    if (c.status !== "estimated" || c.netGain === null) { missing.push(...c.uncertainties); return false; }
    return true;
  });
  if (offers.length && comparisons.length === 0) missing.push("Contrat, échéance actuelle, pénalité et frais source-datés requis pour calculer le gain net.");
  const best = [...eligible].sort((a, b) => b.netGain! - a.netGain!)[0];
  if (best) uncertainties.push(...best.uncertainties);
  uncertainties.push("Un taux public ne constitue pas une offre approuvée pour votre dossier.");
  const variableOffers = offers.filter(offer => offer.product.startsWith("variable"));
  for (const offer of variableOffers) {
    // A public TD prime never confirms another lender or the contractual discount of a private offer.
    const terms = (state.terms ?? []).filter(t => t.offerId === offer.id && Date.parse(t.recordedAt) <= now.getTime()).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0];
    const prime = terms?.prime, label = `${offer.lender} (${offer.product === "variable-3" ? "variable 3 ans" : "variable 5 ans"})`;
    if (!prime?.lender?.trim()) missing.push(`${label} : identité du prêteur portant le prime contractuel à confirmer.`);
    if (!prime || prime.rate === null || prime.discountPoints === null) missing.push(`${label} : prime et rabais du devis à documenter; un taux public ne les remplace pas.`);
    else if (prime.asOf > today || days(today, prime.asOf) > settings.maximumQuoteAgeDays) missing.push(`${label} : preuve datée du prime et du rabais à actualiser.`);
  }
  if (!variableOffers.length && !indicators.some(i => i.key.startsWith("lender-prime:") && mortgageIndicatorFresh(i, now, 10))) missing.push("Prime propre à chaque prêteur et rabais contractuel à confirmer.");
  if (!indicators.some(i => i.key === "cpi-yearly" && mortgageIndicatorFresh(i, now, 75))) missing.push("Dernière publication d’inflation non collectée.");
  if (!contextSources.some(s => s.key === "employment" && s.status === "observed" && s.date && days(today, s.date) <= 45)) missing.push("Dernière publication d’emploi non collectée.");
  if (!indicators.length) missing.push("Indicateurs officiels non collectés pour ce rapport.");
  const signals: MortgageSignal[] = [];
  const add = (s: Omit<MortgageSignal, "evidenceFingerprint" | "notify">, material: unknown) => {
    let evidenceFingerprint = mortgageEvidenceFingerprint(material);
    if (s.kind === "net-gain" && s.potentialGain !== null) {
      const priorSignals = history.slice().sort((a, b) => a.generatedAt.localeCompare(b.generatedAt)).flatMap(r => r.signals).filter(p => p.id === s.id);
      const latestSignal = priorSignals.at(-1), anchor = latestSignal && priorSignals.find(p => p.evidenceFingerprint === latestSignal.evidenceFingerprint);
      if (anchor && anchor.potentialGain !== null && anchor.confirmation === s.confirmation && anchor.changed === s.changed && anchor.nextAction === s.nextAction && canonical(unique(anchor.uncertainties)) === canonical(unique(s.uncertainties)) && Math.abs(s.potentialGain - anchor.potentialGain) < settings.materialNetGainChange) evidenceFingerprint = anchor.evidenceFingerprint;
    }
    const already = history.some(r => r.signals.some(p => p.id === s.id && p.evidenceFingerprint === evidenceFingerprint));
    signals.push({ ...s, evidenceFingerprint, notify: history.length > 0 && !already });
  };
  for (const c of eligible) {
    if (c.netGain! < settings.minimumNetGain) continue;
    const offer = offers.find(q => q.id === c.offerId)!;
    const gainBucket = Math.round(c.netGain!);
    add({ id: `gain:${c.offerId}`, kind: "net-gain", title: c.confirmed ? "Offre confirmée à examiner" : "Opportunité à examiner", changed: `Le gain net estimé dépasse votre seuil de ${settings.minimumNetGain} $ jusqu’à l’échéance actuelle.`, potentialGain: c.netGain, uncertainties: c.uncertainties, nextAction: c.nextAction, offerId: c.offerId, confirmation: c.confirmed ? "confirmed-offer" : "opportunity" }, { offerId: c.offerId, gainBucket, confirmed: c.confirmed, uncertainties: unique(c.uncertainties), endDate: c.endDate });
    if (c.validUntil && days(c.validUntil, today) >= 0 && days(c.validUntil, today) <= settings.expiringWithinDays) add({ id: `expiry:${c.offerId}`, kind: "offer-expiry", title: "Proposition intéressante proche de son échéance", changed: `Validité documentée jusqu’au ${c.validUntil}.`, potentialGain: c.netGain, uncertainties: c.uncertainties, nextAction: `Vérifier les conditions et décider avant le ${c.validUntil}.`, offerId: c.offerId, confirmation: c.confirmed ? "confirmed-offer" : "opportunity" }, { offerId: offer.id, expires: c.validUntil, urgency: days(c.validUntil, today) <= 1 ? "one-day" : "within-window" });
  }
  const previousSnapshot = current ? state.snapshots.filter(s => s.localDate < today && s.status === "complete" && canonical(s.filters) === canonical(current.filters)).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0] : undefined;
  if (current && previousSnapshot) for (const product of productKeys) {
    const a = previousSnapshot.observations.find(o => o.product === product), b = current.observations.find(o => o.product === product);
    if (a?.status !== "observed" || b?.status !== "observed" || a.lender !== b.lender || canonical(a.eligibility) !== canonical(b.eligibility) || a.rate! - b.rate! + 1e-9 < settings.rateImprovementPoints) continue;
    add({ id: `public:${product}`, kind: "rate-improvement", title: "Taux public comparable en baisse", changed: `${product} : baisse de ${(a.rate! - b.rate!).toFixed(2)} point depuis le ${previousSnapshot.localDate}.`, potentialGain: null, uncertainties: b.eligibility, nextAction: "Faire confirmer l’admissibilité et les coûts avant de comparer un changement de prêt.", confirmation: "opportunity" }, { product, rate: b.rate, lender: b.lender, filters: current.filters, eligibility: b.eligibility });
  }
  const financialMissing = unique(comparisons.filter(c => c.status === "unavailable" && offers.some(q => q.id === c.offerId)).flatMap(c => c.uncertainties));
  const actionReasons = financialMissing.length ? financialMissing : missing;
  const actionFields = ([
    [/solde restant|date du solde|solde daté|profil contractuel privé absent|prêt actuel variable/i, "le solde daté"],
    [/versement contractuel actuel|prochain versement|profil contractuel privé absent/i, "le versement exact"],
    [/pénalité|profil contractuel privé absent/i, "la pénalité actuelle"],
    [/échéance actuelle|contrat renouvelé/i, "l’échéance exacte du prêt"],
    [/amortissement restant/i, "l’amortissement restant"],
    [/offre expirée|devis historique|validité du devis/i, "la validité actuelle du devis"],
    [/frais complets|conditions financières de cette offre absentes/i, "les frais complets du changement"],
    [/cashback/i, "les conditions et dates du cashback"],
    [/capitalisation/i, "la capitalisation du prêt et de l’offre"],
    [/structure de paiement|versement contractuel fixe de l’offre/i, "le versement et la structure de l’offre variable"],
  ] as [RegExp, string][]).filter(([pattern]) => actionReasons.some(reason => pattern.test(reason))).map(([, label]) => label).slice(0, 3);
  const blockedAction = actionFields.length ? `Confirmer ${actionFields.length === 1 ? actionFields[0] : actionFields.slice(0, -1).join(", ") + " et " + actionFields.at(-1)}.` : !offers.length ? "Enregistrer une offre personnelle datée et ses conditions." : comparisons.find(c => c.status === "unavailable")?.nextAction ?? "Confirmer le solde daté, le versement exact et la pénalité actuelle.";
  if (offers.length && eligible.length === 0) add({ id: "missing:decision", kind: "missing-data", title: "Données nécessaires à la décision", changed: "Des devis existent, mais aucun gain net fiable ne peut encore être calculé.", potentialGain: null, uncertainties: financialMissing.length ? financialMissing : ["Validité du devis, échéance, pénalité et frais à confirmer."], nextAction: blockedAction, confirmation: "opportunity" }, { missing: financialMissing.length ? financialMissing : ["validity-profile-costs"], offers: offers.map(q => [q.id, q.variant]).sort() });
  const useful = signals.find(s => s.kind === "net-gain") ?? signals.find(s => s.kind !== "missing-data"), blocked = !best;
  const report: MortgageDailyReport = {
    schema: 1, id: "pending", ...(input.inputFingerprint ? { inputFingerprint: input.inputFingerprint } : {}), localDate: today, generatedAt, status: useful ? "opportunity" : blocked ? "blocked" : "watch",
    summary: useful ? useful.title : blocked ? "Gain net à confirmer avant toute décision" : "Aucune nouvelle opportunité au-dessus des seuils",
    netGain: best?.netGain ?? null, nextAction: useful?.nextAction ?? (blocked ? blockedAction : "Conserver le suivi quotidien; aucune démarche nécessaire aujourd’hui."),
    uncertainties: unique(uncertainties), missing: unique(missing), snapshotId: current?.id ?? null,
    freshness: { rates: !current ? "missing" : current.status === "complete" ? "current" : current.status, lastRateAttemptAt: latest?.collectedAt ?? null, sourceFailures },
    comparisons, indicators, contextSources, signals, facts,
    forecasts: [...contextSources.filter(s => s.key === "economic-forecast" && s.status === "observed").map(s => s.detail), ...indicators.filter(i => i.reliability === "external-forecast" && i.status === "observed").map(i => `${i.label} : ${i.value} % (${i.observationDate}), ${i.sourceTitle}. Prévision externe, sans probabilité attribuée.`)],
    assumptions: ["Les scénarios de stabilité, baisse et hausse sont des simulations datées, pas des prévisions.", "La pénalité financée augmente le capital et les intérêts; une mensualité réduite ne prouve pas une économie.", "Le gain estimé compare les deux soldes et tous les flux jusqu’à la même échéance actuelle."],
    diagnosisTriggers: ["Une proposition personnelle actualisée avec admissibilité et validité confirmées.", "Un montant de remboursement anticipé ou de frais confirmé par le prêteur.", "Une variation effective du prime contractuel, distincte du taux directeur.", "Des rendements obligataires, une publication d’inflation ou d’emploi qui modifient le contexte, sans prédire mécaniquement les offres."], settings,
  };
  report.id = `daily:${today}:${mortgageEvidenceFingerprint({ inputFingerprint: input.inputFingerprint, contextSources, snapshot: current?.id ?? null, comparisons, indicators: indicators.map(i => [i.key, i.status, i.observationDate, i.value, i.lastSuccessAt]), settings: { ...settings, id: undefined, recordedAt: undefined } })}`;
  return validateMortgageDailyReport(report);
}
