import { normalizeProduct, receiptSourceType, type GroceryItem, type GroceryRecord } from "../../worker/src/grocery-model";
import { normalizedSize, type GroceryPlan, type GroceryPrice, type GroceryRetailer } from "../../worker/src/grocery-planning";
import { datedPrice, storeName } from "./grocery-comparison";
import { grocerySourceLink } from "./grocery-source-link";
import { targetProductConflict } from "./grocery-target-observations";
import { estimatedSourceLine, purchaseEvidenceReason, type PurchaseComparisonEvidence } from "../../worker/src/grocery-purchase-evidence";
import { confirmedPurchaseFormat, purchaseCandidatesForLine, type PurchaseCandidate, type PurchaseResolution } from "../../worker/src/grocery-purchase-resolution";

export function purchaseStatus(record: GroceryRecord) {
  // Old saved records have no evidence of final payment. Never infer it from `saved`.
  const confirmation = receiptSourceType(record) === "confirmation";
  return confirmation ? "Confirmation originale · paiement final inconnu" : record.status === "saved" && record.reviewedAt && record.receipt.sourceType === "final-receipt" ? "Reçu final · payé" : "Montant source · paiement à vérifier";
}
export const purchaseDate = (record: GroceryRecord) => record.receipt.fulfillment?.date || record.receipt.date;
export const purchaseAmountLabel = (record: GroceryRecord) => receiptSourceType(record) === "confirmation" ? "Total estimé" : record.status === "saved" && record.reviewedAt && record.receipt.sourceType === "final-receipt" ? "Total payé" : "Montant source";
export const purchaseLocalDate = (instant = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
export function recentPcExpressPurchases(records: GroceryRecord[], today = purchaseLocalDate()) {
  const cutoff = new Date(today + "T12:00:00Z"); cutoff.setUTCDate(cutoff.getUTCDate() - 29);
  return records.filter(r => {
    const date = purchaseDate(r);
    return r.status === "saved" && !r.duplicateOf && !!date && date <= today && date >= cutoff.toISOString().slice(0, 10)
      && /\bpc\s*(?:express|x)\b|pcexpress\.ca/i.test([r.receipt.store, r.receipt.reference, ...r.sources.map(s => s.name)].join(" "))
      && (!!r.receipt.fulfillment || r.receipt.sourceType === "final-receipt" && !!r.reviewedAt);
  }).sort((a, b) => purchaseDate(b)!.localeCompare(purchaseDate(a)!));
}
export function receiptItemId(plan: GroceryPlan, record: GroceryRecord, line: GroceryItem) {
  const explicit = [...line.evidence.matchAll(/Article rapproché\s*:\s*([a-zA-Z0-9_-]+)(?=[.\s]|$)/g)].map(m => m[1]);
  const linked = plan.prices.filter(p => p.kind === "receipt" && normalizeProduct(p.product) === normalizeProduct(line.product) && p.evidence.title.split(/[^a-zA-Z0-9_-]+/).includes(record.id)).map(p => p.itemId);
  const exact = plan.items.filter(i => normalizeProduct(i.name) === normalizeProduct(line.product || line.name)).map(i => i.id);
  const ids = [...new Set(explicit.length ? explicit : linked.length ? linked : exact)];
  return ids.length === 1 ? ids[0] : null;
}
function matchReason(plan: GroceryPlan, record: GroceryRecord, line: GroceryItem, retailer: GroceryRetailer, p: GroceryPrice, now: string) {
  const item = plan.items.find(i => i.id === p.itemId);
  if (line.uncertain || !line.evidence.trim()) return "Ligne du ticket à vérifier";
  if (!item || !p.approved || !p.matchNote?.trim()) return "Correspondance marque / qualité à vérifier";
  const conflict = targetProductConflict(item, { ...p, product: line.product || line.name }, p);
  if (conflict) return conflict;
  if (p.substitution && !item.substitutions) return "Alternative non autorisée";
  if (!p.substitution && normalizeProduct(p.product) !== normalizeProduct(line.product || line.name)) return "Produit différent : équivalence à confirmer";
  if (p.currency !== record.receipt.currency) return "Devise différente";
  if (p.available === "no") return "Indisponible selon la source";
  if (p.available !== "yes") return "Disponibilité à confirmer";
  if (!datedPrice(p, now) || Date.parse(now) - Date.parse(p.evidence.date) > 7 * 86400000) return "Prix historique ou à actualiser";
  if (!grocerySourceLink(p.evidence.url)) return "Source publique manquante";
  if (!p.localityConfirmed || !retailer.areaConfirmed || !p.locality || !retailer.locality || p.locality !== retailer.locality || /catalogue par défaut/i.test(retailer.name)) return "Magasin local à confirmer";
  if (!p.mode || p.mode === "unknown" || p.mode !== retailer.mode || retailer.enabled === false) return "Mode d'achat à confirmer";
  if (retailer.membershipStatus === "proposal" || /^costco\b/i.test(retailer.name) && retailer.membershipStatus !== "existing") return "Adhésion requise à confirmer";
  if (/format (?:non confirmé|à confirmer)|prix (?:de barquette )?estimé|loyal|membre|coupon|remise|BASE.*avant/i.test(p.matchNote)) return "Format, prix ou conditions à confirmer";
  return "";
}
export function purchaseSourceSummary(plan: GroceryPlan, record: GroceryRecord) {
  const known = record.receipt.items.map((_, index) => estimatedSourceLine(plan.sourceEstimates, record, index)).filter(e => e !== null);
  const subtotal = known.length ? Math.round(known.reduce((n, e) => n + e.amount, 0) * 100) / 100 : null;
  return { covered: known.length, count: record.receipt.items.length, subtotal, difference: subtotal !== null && record.receipt.total !== null && known.length === record.receipt.items.length ? Math.round((record.receipt.total - subtotal) * 100) / 100 : null };
}
export type PurchaseLineComparison = { line: GroceryItem; price: GroceryPrice | null; reason: string; normalized: number | null; outlay: number | null; packs: number | null; ratio: number | null; calculated: boolean; comparisonEvidence?: PurchaseComparisonEvidence; sourceEstimate?: number | null; formatEvidence?: PurchaseCandidate };
export function purchaseComparison(plan: GroceryPlan, record: GroceryRecord, now = purchaseLocalDate(), resolution?: PurchaseResolution) {
  const names = ["Walmart", "Superstore", "Costco", "Save-On-Foods", "Fresh St. Market"];
  const retailers: (GroceryRetailer | { id: string; name: string })[] = [...plan.retailers];
  const canonicalStore = (name: string) => /^save[\s-]*on[\s-]*foods\b/i.test(name) ? "Save-On-Foods" : /^real canadian superstore\b/i.test(name) ? "Superstore" : storeName(name);
  for (const name of names) if (!retailers.some(r => canonicalStore(r.name) === name)) retailers.push({ id: "missing-" + name, name });
  return retailers.map(retailer => {
    const lines: PurchaseLineComparison[] = record.receipt.items.map((rawLine, lineIndex) => {
      const formatEvidence = confirmedPurchaseFormat(resolution, record, lineIndex);
      // Projection for this comparison only. The original record and its evidence keys stay intact.
      const line = formatEvidence ? { ...rawLine, product: formatEvidence.product, size: formatEvidence.size, unit: formatEvidence.unit, uncertain: false } : rawLine;
      const base = { line: rawLine, price: null, normalized: null, outlay: null, packs: null, ratio: null, calculated: false, ...(formatEvidence ? { formatEvidence } : {}) };
      const reviewed = (plan.purchaseComparisons ?? []).filter(e => e.recordId === record.id && e.lineIndex === lineIndex && plan.prices.some(p => p.id === e.priceId && p.retailerId === retailer.id));
      if (reviewed.length) {
        const usable = reviewed.filter(e => !purchaseEvidenceReason(e, record, plan) && plan.prices.some(p => p.id === e.priceId && datedPrice(p, now) && Date.parse(now) - Date.parse(p.evidence.date) <= 7 * 86400000 && Date.parse(p.evidence.date) <= Date.parse(now) && grocerySourceLink(p.evidence.url)));
        if (usable.length !== 1) return { ...base, reason: usable.length ? "Plusieurs équivalences : choix à revoir" : "Preuve de comparaison modifiée ou ancienne" };
        const e = usable[0], price = plan.prices.find(p => p.id === e.priceId)!, normalized = Math.round(e.quantity * price.price * 100) / 100;
        if (!Number.isFinite(normalized) || normalized > 1_000_000) return { ...base, reason: "Montant non calculable" };
        return { line, price, reason: "", normalized, outlay: normalized, packs: e.quantity, ratio: e.quantity, calculated: false, comparisonEvidence: e, sourceEstimate: estimatedSourceLine(plan.sourceEstimates, record, lineIndex)?.amount ?? e.sourceEstimate };
      }
      const id = formatEvidence?.itemId ?? receiptItemId(plan, record, line);
      if (!id) return { ...base, reason: "Article non rapproché du catalogue" };
      const candidates = plan.prices.filter(p => p.itemId === id && p.retailerId === retailer.id);
      const good = candidates.filter(p => !matchReason(plan, record, line, retailer as GroceryRetailer, p, now));
      // Multiple plausible references are a review choice, not an automatic cheapest-product substitution.
      if (good.length !== 1) return { ...base, price: candidates.length === 1 ? candidates[0] : null, reason: good.length > 1 ? "Plusieurs produits comparables : choix à revoir" : candidates.length ? matchReason(plan, record, line, retailer as GroceryRetailer, candidates[0], now) : "Aucun prix local sourcé" };
      const price = good[0];
      if (line.quantity === null || line.size === null || !line.unit || line.quantity <= 0 || line.size <= 0) return { ...base, price, reason: "Quantité ou format acheté inconnu" };
      const target = normalizedSize(line.quantity * line.size, line.unit), pack = normalizedSize(price.size, price.unit);
      if (target.unit !== pack.unit) return { ...base, price, reason: "Unités incompatibles (aucune conversion supposée)" };
      const ratio = target.size / pack.size, packs = price.weighed ? ratio : Math.ceil(ratio - 1e-10);
      const normalized = ratio * price.price, outlay = packs * price.price;
      if (![ratio, packs, normalized, outlay].every(Number.isFinite) || packs <= 0 || outlay > 1_000_000) return { ...base, price, reason: "Montant non calculable" };
      return { line: rawLine, price, ratio, packs, normalized, outlay, ...(formatEvidence ? { formatEvidence } : {}), calculated: Math.abs(ratio - Math.round(ratio)) > 1e-10, reason: "" };
    });
    const covered = lines.filter(l => l.normalized !== null), complete = lines.length > 0 && covered.length === lines.length;
    // Repeated physical rows can share one buyable pack; round after grouping the same reference.
    const grouped = new Map<string, { price: GroceryPrice; ratio: number }>();
    for (const line of covered) { const p = line.price!; const previous = grouped.get(p.id); grouped.set(p.id, { price: p, ratio: (previous?.ratio ?? 0) + line.ratio! }); }
    const estimated = covered.length > 0 && covered.every(l => l.sourceEstimate !== null && l.sourceEstimate !== undefined);
    return { retailer, lines, covered: covered.length, count: lines.length, complete,
      sourceEstimate: estimated ? Math.round(covered.reduce((n, l) => n + l.sourceEstimate!, 0) * 100) / 100 : null,
      comparisonOnly: covered.some(l => l.comparisonEvidence), observationDates: [...new Set(covered.map(l => l.price!.evidence.date))],
      normalized: covered.length ? covered.reduce((n, l) => n + l.normalized!, 0) : null,
      outlay: covered.length ? [...grouped.values()].reduce((n, g) => n + (g.price.weighed ? g.ratio : Math.ceil(g.ratio - 1e-10)) * g.price.price, 0) : null };
  });
}
/** Choose one evidenced locality/mode per retailer; never assemble a basket across branches. */
export function purchaseStoreComparisons(plan: GroceryPlan, record: GroceryRecord, now?: string, resolution?: PurchaseResolution) {
  const comparisons = purchaseComparison(plan, record, now, resolution);
  return ["Walmart", "Costco"].map(name => {
    const candidates = comparisons.filter(c => storeName(c.retailer.name) === name);
    const chosen = candidates.sort((a, b) => b.covered - a.covered || Number(/catalogue par défaut/i.test(a.retailer.name)) - Number(/catalogue par défaut/i.test(b.retailer.name)) || a.retailer.id.localeCompare(b.retailer.id))[0];
    return { ...chosen, name };
  });
}

/** Explain missing coverage without treating a proposed association as a usable price. */
export function purchaseLineBlockers(plan: GroceryPlan, record: GroceryRecord, index: number, resolution?: PurchaseResolution, now = purchaseLocalDate()) {
  const raw = record.receipt.items[index], confirmed = confirmedPurchaseFormat(resolution, record, index), candidates = purchaseCandidatesForLine(resolution, record, index);
  const result: string[] = [];
  if (raw.quantity === null) result.push("Quantité d'achat inconnue");
  if (!confirmed && (raw.size === null || !raw.unit)) result.push("Format d'achat inconnu");
  if (!confirmed && candidates.length) result.push("Correspondance candidate à confirmer");
  if (!confirmed && !candidates.length && raw.uncertain) result.push("Correspondance produit à vérifier");
  const ids = [...new Set([confirmed?.itemId, receiptItemId(plan, record, raw), ...candidates.map(c => c.itemId)].filter((v): v is string => !!v))];
  for (const name of ["Walmart", "Costco"]) {
    const retailers = plan.retailers.filter(r => storeName(r.name) === name);
    const references = plan.prices.filter(p => ids.includes(p.itemId) && retailers.some(r => r.id === p.retailerId));
    if (!references.length) { result.push(`${name} : prix concurrent absent`); continue; }
    if (references.every(p => !datedPrice(p, now) || Date.parse(now) - Date.parse(p.evidence.date) > 7 * 86400000)) result.push(`${name} : prix concurrent périmé`);
    if (references.every(p => { const r = retailers.find(r => r.id === p.retailerId)!; return !p.localityConfirmed || !r.areaConfirmed || !p.locality || p.locality !== r.locality || /catalogue par défaut/i.test(r.name); })) result.push(`${name} : prix non local ou magasin à confirmer`);
    if (references.every(p => !p.approved || p.available !== "yes" || !p.matchNote?.trim())) result.push(`${name} : prix ou équivalence à valider`);
  }
  return result;
}
