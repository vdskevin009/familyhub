import { GroceryError, type GroceryUnit } from "./grocery-model.js";
import { publicSourceUrl } from "./grocery-planning.js";

export type PurchaseScenarioHint = {
  id: string; purpose: "source-format" | "reference-pack"; product: string; productId: string;
  priceId: string; priceKey: string; size: number; unit: GroceryUnit; packagePrice: number | null;
  sourceUrl: string; observedAt: string; note: string;
};
export type PurchaseScenario = {
  recordId: string; lineIndex: number; lineKey: string; priceId: string; priceKey: string;
  family: string; relation: "estimated-match" | "estimated-substitution";
  quantity: number; size: number; unit: GroceryUnit; referenceSize: number; referenceUnit: GroceryUnit;
  referencePrice: number; packSize: number | null; packPrice: number | null; packEstimated: boolean;
  normalized: number; outlay: number | null; packs: number | null; ratio: number;
  assumptions: string[]; limits: string[]; formula: string; ageDays: number;
  formatSources: { title: string; url: string; date: string }[]; sourceReceiptId: string | null;
};
const unit = (v: unknown): v is GroceryUnit => ["g", "kg", "ml", "l", "each"].includes(String(v));
const text = (v: unknown, max: number, blank = false) => { if (typeof v !== "string" || v.length > max || !blank && !v.trim()) throw new GroceryError("Preuve de scénario invalide."); return v.trim(); };
const positive = (v: unknown) => { if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1_000_000) throw new GroceryError("Quantité de scénario invalide."); return v; };
const amount = (v: unknown) => { if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000) throw new GroceryError("Montant de scénario invalide."); return v; };
export function validateScenarioHints(value: unknown): PurchaseScenarioHint[] {
  if (!Array.isArray(value) || value.length > 100) throw new GroceryError("Trop de références de format estimatif.");
  const rows = value.map(v => {
    if (!v || typeof v !== "object" || !["source-format", "reference-pack"].includes(v.purpose) || !unit(v.unit)) throw new GroceryError("Référence de scénario invalide.");
    const id = text(v.id, 80), observedAt = text(v.observedAt, 40), sourceUrl = publicSourceUrl(v.sourceUrl);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !sourceUrl || !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) throw new GroceryError("Source datée du scénario requise.");
    return { id, purpose: v.purpose, product: text(v.product, 200), productId: text(v.productId, 80, true), priceId: text(v.priceId, 80, true), priceKey: text(v.priceKey, 8000, v.purpose === "source-format"), size: positive(v.size), unit: v.unit, packagePrice: v.packagePrice === null ? null : amount(v.packagePrice), sourceUrl, observedAt, note: text(v.note, 1000) } as PurchaseScenarioHint;
  });
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new GroceryError("Référence de scénario dupliquée."); return rows;
}
export function validatePurchaseScenarios(value: unknown): PurchaseScenario[] {
  if (!Array.isArray(value) || value.length > 500) throw new GroceryError("Trop de scénarios de comparaison.");
  return value.map(v => {
    if (!v || typeof v !== "object" || !Number.isInteger(v.lineIndex) || v.lineIndex < 0 || v.lineIndex > 199 || !unit(v.unit) || !unit(v.referenceUnit) || typeof v.packEstimated !== "boolean" || !["estimated-match", "estimated-substitution"].includes(v.relation)) throw new GroceryError("Scénario de comparaison invalide.");
    const strings = (list: unknown, limit: number) => { if (!Array.isArray(list) || list.length > limit) throw new GroceryError("Limites du scénario invalides."); return list.map(s => text(s, 1500)); };
    if (!Array.isArray(v.formatSources) || v.formatSources.length > 5) throw new GroceryError("Sources de format invalides.");
    return { recordId: text(v.recordId, 80), lineIndex: v.lineIndex, lineKey: text(v.lineKey, 6000), priceId: text(v.priceId, 80), priceKey: text(v.priceKey, 8000), family: text(v.family, 80), relation: v.relation,
      quantity: positive(v.quantity), size: positive(v.size), unit: v.unit, referenceSize: positive(v.referenceSize), referenceUnit: v.referenceUnit, referencePrice: amount(v.referencePrice), packSize: v.packSize === null ? null : positive(v.packSize), packPrice: v.packPrice === null ? null : amount(v.packPrice), packEstimated: v.packEstimated,
      normalized: amount(v.normalized), outlay: v.outlay === null ? null : amount(v.outlay), packs: v.packs === null ? null : positive(v.packs), ratio: positive(v.ratio), assumptions: strings(v.assumptions, 12), limits: strings(v.limits, 12), formula: text(v.formula, 1500), ageDays: amount(v.ageDays),
      formatSources: v.formatSources.map((s: Record<string, unknown>) => ({ title: text(s.title, 500), url: s.url ? publicSourceUrl(s.url) : "", date: text(s.date, 40) })), sourceReceiptId: v.sourceReceiptId === null ? null : text(v.sourceReceiptId, 80) } as PurchaseScenario;
  });
}
