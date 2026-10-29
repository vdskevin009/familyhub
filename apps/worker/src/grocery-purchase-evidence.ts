import { GroceryError, receiptSourceType, type GroceryItem, type GroceryRecord, type GroceryUnit } from "./grocery-model.js";
import type { GroceryPlan, GroceryPrice } from "./grocery-planning.js";

/** A reviewed, product-only comparison. Never a SKU identity or permission to buy a substitute. */
export type PurchaseComparisonEvidence = {
  id: string; recordId: string; lineIndex: number; lineKey: string; priceId: string; priceKey: string;
  purpose: "comparison-only"; relation: "equivalent-same-format";
  quantity: number; size: number; unit: GroceryUnit; formatLabel: string; referenceFormatLabel: string;
  sourceEstimate: number | null; sourceEstimateEvidence: string; provenance: string; reviewedAt: string;
};
export type SourceEstimateEvidence = { id: string; recordId: string; lineIndex: number; lineKey: string; quantity: number; unitPrice: number; currency: string; basis: "estimated-per-source-unit"; sourceEvidence: string; reviewedAt: string };
export function validateSourceEstimates(value: unknown): SourceEstimateEvidence[] {
  if (!Array.isArray(value) || value.length > 500) throw new GroceryError("Prix unitaires source invalides.");
  const rows = value.map(v => {
    if (!v || typeof v !== "object") throw new GroceryError("Preuve de prix source invalide.");
    const e = v as Record<string, unknown>, text = (key: string, max: number) => { const s = e[key]; if (typeof s !== "string" || !s.trim() || s.length > max) throw new GroceryError("Provenance du prix source requise."); return s.trim(); };
    const id = (key: string) => { const s = text(key, 80); if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new GroceryError("Identifiant du prix source invalide."); return s; };
    const quantity = e.quantity, unitPrice = e.unitPrice, reviewedAt = text("reviewedAt", 40), currency = text("currency", 3);
    if (e.basis !== "estimated-per-source-unit" || !Number.isInteger(e.lineIndex) || Number(e.lineIndex) < 0 || Number(e.lineIndex) > 199 || typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000 || typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000 || Math.abs(unitPrice * 100 - Math.round(unitPrice * 100)) > .0001 || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(Date.parse(reviewedAt)) || new Date(reviewedAt).toISOString() !== reviewedAt) throw new GroceryError("Estimation unitaire source invalide.");
    return { id: id("id"), recordId: id("recordId"), lineIndex: Number(e.lineIndex), lineKey: text("lineKey", 6000), quantity, unitPrice, currency, basis: "estimated-per-source-unit" as const, sourceEvidence: text("sourceEvidence", 1000), reviewedAt };
  });
  if (new Set(rows.map(e => e.id)).size !== rows.length) throw new GroceryError("Prix source dupliqué."); return rows;
}
export function sourceEstimateReason(e: SourceEstimateEvidence, record: GroceryRecord): string {
  const line = record.receipt.items[e.lineIndex];
  if (e.recordId !== record.id || record.status !== "saved" || record.duplicateOf || receiptSourceType(record) !== "confirmation" || !line || purchaseLineKey(line) !== e.lineKey) return "Confirmation source modifiée : prix à revoir";
  if (line.quantity === null || line.quantity !== e.quantity || record.receipt.currency !== e.currency || e.unitPrice * e.quantity > 1000000) return "Quantité ou devise source incompatible";
  return "";
}
export function estimatedSourceLine(entries: SourceEstimateEvidence[] | undefined, record: GroceryRecord, lineIndex: number) {
  const candidates = (entries ?? []).filter(e => e.recordId === record.id && e.lineIndex === lineIndex && !sourceEstimateReason(e, record));
  if (candidates.length !== 1) return null;
  const e = candidates[0]; return { ...e, amount: Math.round(e.quantity * e.unitPrice * 100) / 100 };
}
export const purchaseLineKey = (line: GroceryItem) => JSON.stringify([line.name, line.product, line.amount, line.quantity, line.size, line.unit, line.evidence, line.uncertain, ...(line.productReference ? [[line.productReference.provider, line.productReference.id]] : [])]);
export const purchasePriceKey = (p: GroceryPrice) => JSON.stringify([p.id, p.itemId, p.retailerId, p.product, p.price, p.size, p.unit, p.weighed, p.currency, p.available, p.kind, p.evidence, p.mode, p.locality, p.localityConfirmed, p.substitution, p.approved, p.matchNote]);
const physical = (size: number, unit: GroceryUnit) => ({ amount: size * (unit === "g" || unit === "ml" ? .001 : 1), unit: unit === "g" ? "kg" : unit === "ml" ? "l" : unit });
const sameFormat = (a: { size: number; unit: GroceryUnit }, b: { size: number; unit: GroceryUnit }) => {
  const x = physical(a.size, a.unit), y = physical(b.size, b.unit);
  return x.unit === y.unit && Math.abs(x.amount - y.amount) <= 1e-9 * Math.max(1, x.amount, y.amount);
};
export function validatePurchaseEvidence(value: unknown): PurchaseComparisonEvidence[] {
  if (!Array.isArray(value) || value.length > 200) throw new GroceryError("Rapprochements de comparaison invalides.");
  const rows = value.map(v => {
    if (!v || typeof v !== "object") throw new GroceryError("Rapprochement invalide.");
    const e = v as Record<string, unknown>;
    const text = (key: string, max: number) => { const t = e[key]; if (typeof t !== "string" || !t.trim() || t.length > max) throw new GroceryError("Preuve de comparaison requise."); return t.trim(); };
    const id = (key: string) => { const t = text(key, 80); if (!/^[a-zA-Z0-9_-]+$/.test(t)) throw new GroceryError("Identifiant de rapprochement invalide."); return t; };
    const positive = (key: string) => { const n = e[key]; if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 100000) throw new GroceryError("Format de comparaison invalide."); return n; };
    if (e.purpose !== "comparison-only" || e.relation !== "equivalent-same-format" || !Number.isInteger(e.lineIndex) || Number(e.lineIndex) < 0 || Number(e.lineIndex) > 199 || !["g", "kg", "ml", "l", "each"].includes(String(e.unit))) throw new GroceryError("Comparaison équivalente explicite requise.");
    const reviewedAt = text("reviewedAt", 40); if (!Number.isFinite(Date.parse(reviewedAt)) || new Date(reviewedAt).toISOString() !== reviewedAt) throw new GroceryError("Date de revue invalide.");
    const amount = e.sourceEstimate; if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > .0001)) throw new GroceryError("Estimation source invalide.");
    const quantity = positive("quantity"); if (!Number.isInteger(quantity)) throw new GroceryError("Nombre entier de formats requis pour cette équivalence.");
    return { id: id("id"), recordId: id("recordId"), lineIndex: Number(e.lineIndex), lineKey: text("lineKey", 6000), priceId: id("priceId"), priceKey: text("priceKey", 8000), purpose: "comparison-only" as const, relation: "equivalent-same-format" as const, quantity, size: positive("size"), unit: e.unit as GroceryUnit, formatLabel: text("formatLabel", 100), referenceFormatLabel: text("referenceFormatLabel", 100), sourceEstimate: amount as number | null, sourceEstimateEvidence: text("sourceEstimateEvidence", 1000), provenance: text("provenance", 1000), reviewedAt };
  });
  if (new Set(rows.map(e => e.id)).size !== rows.length) throw new GroceryError("Rapprochement dupliqué.");
  return rows;
}
export function purchaseEvidenceReason(e: PurchaseComparisonEvidence, record: GroceryRecord, plan: GroceryPlan): string {
  const line = record.receipt.items[e.lineIndex], price = plan.prices.find(p => p.id === e.priceId), retailer = price && plan.retailers.find(r => r.id === price.retailerId);
  if (record.id !== e.recordId || record.status !== "saved" || record.duplicateOf || !line || purchaseLineKey(line) !== e.lineKey) return "Source modifiée : rapprochement à revoir";
  if (!price || !retailer || purchasePriceKey(price) !== e.priceKey) return "Référence modifiée : rapprochement à revoir";
  if (line.quantity !== null && line.quantity !== e.quantity || line.size !== null && line.unit && !sameFormat({ size: line.size, unit: line.unit }, e)) return "Format dérivé incompatible avec la source";
  if (!sameFormat(e, price) || price.weighed || price.currency !== record.receipt.currency) return "Formats ou devises incompatibles";
  const source = estimatedSourceLine(plan.sourceEstimates, record, e.lineIndex);
  if (source && e.sourceEstimate !== null && Math.abs(source.amount - e.sourceEstimate) > .001) return "Estimations source contradictoires";
  if (price.kind !== "public" || !price.evidence.url || !price.evidence.date || price.available !== "yes" || !price.localityConfirmed || !price.locality || price.locality !== retailer.locality || retailer.enabled === false || /catalogue par défaut/i.test(retailer.name)) return "Observation locale de produit à confirmer";
  return "";
}
