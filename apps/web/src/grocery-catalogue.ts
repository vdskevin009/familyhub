import { normalizeProduct, type GroceryRecord, type GroceryUnit } from "../../worker/src/grocery-model";
import { validatePlan, type GroceryPlan, type ShoppingItem } from "../../worker/src/grocery-planning";
import { receiptProducts } from "./grocery-receipt-products";
import { shortProduct, storeGroups, storeName } from "./grocery-comparison";
import { articleUnitComparison, type RankedOffer } from "./grocery-unit-comparison";

/** Forward-compatible read-only catalogue, without changing the worker's save limit.
 * Reuse every existing field validator in bounded chunks; check cross-chunk identity too.
 */
export function validateCataloguePlan(value: unknown): GroceryPlan {
  const p = value as GroceryPlan;
  if (!p || !Array.isArray(p.items) || p.items.length > 300 || !Array.isArray(p.prices) || p.prices.length > 300) throw new Error("Catalogue PC invalide ou trop volumineux.");
  if (p.items.length <= 60) return validatePlan(value);
  if (p.prices.some(price => !price || !p.items.some(item => item && item.id === price.itemId))) throw new Error("Le prix référence un article absent du catalogue.");
  const parts: GroceryPlan[] = [];
  for (let index = 0; index < p.items.length; index += 60) {
    const items = p.items.slice(index, index + 60);
    parts.push(validatePlan({ ...p, items, prices: p.prices.filter(price => items.some(item => item && item.id === price.itemId)) }));
  }
  const items = parts.flatMap(part => part.items), prices = parts.flatMap(part => part.prices);
  if (new Set(items.map(i => i.id)).size !== items.length || new Set(prices.map(i => i.id)).size !== prices.length) throw new Error("Identifiants du catalogue dupliqués.");
  return { ...parts[0], items, prices };
}

/** Separate read-only snapshot. Never derived from active, weekly quantities or stock. */
export type PCExpressCartSnapshot = {
  schema: 1; source: "pcexpress"; capturedAt: string; complete: boolean;
  items: { itemId: string | null; product: string; brand: string | null; size: number | null; unit: GroceryUnit | null; quantity: number | null }[];
};
export function parseCartSnapshot(value: unknown): PCExpressCartSnapshot {
  const v = value as PCExpressCartSnapshot;
  if (!v || v.schema !== 1 || v.source !== "pcexpress" || typeof v.complete !== "boolean" || !Array.isArray(v.items) || v.items.length > 300
    || typeof v.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v.capturedAt) || !Number.isFinite(Date.parse(v.capturedAt))) throw new Error("Snapshot PCExpress invalide.");
  const number = (n: unknown) => n === null || typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 100000;
  const text = (s: unknown, max: number) => typeof s === "string" && !!s.trim() && s.length <= max;
  for (const i of v.items) if (!i || !text(i.product, 200) || i.itemId !== null && (!text(i.itemId, 80) || !/^[a-zA-Z0-9_-]+$/.test(i.itemId))
    || i.brand !== null && !text(i.brand, 100) || !number(i.size) || !number(i.quantity) || i.unit !== null && !["g", "kg", "ml", "l", "each"].includes(i.unit)) throw new Error("Ligne PCExpress invalide.");
  return { schema: 1, source: "pcexpress", capturedAt: v.capturedAt, complete: v.complete, items: v.items.map(i => ({ itemId: i.itemId, product: i.product.trim(), brand: i.brand?.trim() ?? null, size: i.size, unit: i.unit, quantity: i.quantity })) };
}
export function currentCart(snapshot: PCExpressCartSnapshot | null, now = Date.now()) {
  const age = snapshot ? now - Date.parse(snapshot.capturedAt) : Infinity;
  return Boolean(snapshot?.complete && age >= 0 && age <= 24 * 60 * 60 * 1000);
}
export type ProductIdentity = { product: string; brand: string | null; size: number | null; unit: GroceryUnit | null; source: string; date: string | null };
export type CatalogueArticle = { item: ShoppingItem; identities: ProductIdentity[]; inCart: boolean };
export function literalBrand(product: string) {
  const short = shortProduct(product);
  return short !== product && /^[\s,.:;—–-]/u.test(product.slice(short.length)) ? product.slice(0, short.length) : null;
}
const unknownItem = (id: string, name: string): ShoppingItem => ({ id, name, quantity: null, size: null, unit: null, preference: "", substitutions: false, active: false, origin: "", cadence: "unknown" });
/** Additive display only. Every saved article remains, even when inactive or unpriced. */
export function householdCatalogue(plan: GroceryPlan, records: GroceryRecord[], snapshot: PCExpressCartSnapshot | null): CatalogueArticle[] {
  const rows: CatalogueArticle[] = plan.items.map(item => ({ item, identities: [], inCart: false }));
  const standalone = new Map<string, CatalogueArticle>();
  const find = (product: string, id: string | null, fallbackId: string, name: string, allowExact = true) => {
    const explicit = id ? rows.find(r => r.item.id === id) : undefined;
    const exact = rows.filter(r => normalizeProduct(r.item.name) === normalizeProduct(product));
    if (explicit || !id && allowExact && exact.length === 1) return explicit ?? exact[0];
    const key = normalizeProduct(product);
    let row = standalone.get(key);
    if (!row) { row = { item: unknownItem(fallbackId, name), identities: [], inCart: false }; standalone.set(key, row); rows.push(row); }
    return row;
  };
  for (const record of records) {
    if (record.status !== "saved" || !record.reviewedAt || record.duplicateOf || record.extraction === "running") continue;
    const linked = receiptProducts(plan, [record]);
    record.receipt.items.forEach((line, index) => {
      if (line.uncertain || !line.product.trim() || !line.evidence.trim()) return;
      const association = linked.find(p => p.recordId === record.id && normalizeProduct(p.product) === normalizeProduct(line.product));
      const unresolvedExplicit = !association && /Article rapproché\s*:/i.test(line.evidence);
      const row = find(line.product, association?.itemId ?? null, `receipt_${record.id}_${index}`, line.name || line.product, !unresolvedExplicit);
      row.identities.push({ product: line.product, brand: literalBrand(line.product), size: line.size, unit: line.unit, source: `Ticket ${record.receipt.store}`, date: record.receipt.date });
    });
  }
  snapshot?.items.forEach((line, index) => {
    const row = find(line.product, line.itemId, `pcexpress_${index}`, line.product);
    row.inCart = true;
    row.identities.unshift({ product: line.product, brand: line.brand, size: line.size, unit: line.unit, source: "Panier PCExpress", date: snapshot.capturedAt.slice(0, 10) });
  });
  for (const row of rows) row.identities = row.identities.filter((p, i, all) => all.findIndex(other => other.product === p.product && other.size === p.size && other.unit === p.unit && other.source === p.source) === i);
  return rows;
}
export function filterCatalogue(rows: CatalogueArticle[], scope: "all" | "cart", search: string, snapshot: PCExpressCartSnapshot | null, now = Date.now()) {
  const query = normalizeProduct(search);
  return rows.filter(r => (scope === "all" || currentCart(snapshot, now) && r.inCart) && (!query || normalizeProduct([r.item.name, ...r.identities.map(p => `${p.product} ${p.brand ?? ""}`)].join(" ")).includes(query)));
}
export type TargetSaving = { item: ShoppingItem; alternative: RankedOffer; baseline: RankedOffer; percent: number; difference: number };
/** Recommendations require reviewed quality/locality, current evidence and a real Superstore reference.
 * Match same modes, currency and dimension; substitutions must be explicitly accepted.
 * A seven-day observation window bounds unknown expiry. Fees never become product savings.
 */
export function targetSavings(plan: GroceryPlan, items: ShoppingItem[], now = new Date().toISOString().slice(0, 10)) {
  const groups = storeGroups(plan), result: TargetSaving[] = [], excluded: ShoppingItem[] = [];
  for (const item of items) {
    const offers = articleUnitComparison(plan, item, groups, now).rows.flatMap(r => r.offers);
    const valid = offers.filter(o => {
      const age = (Date.parse(now) - Date.parse(o.p.evidence.date)) / 86400000;
      return !o.reason && o.rate && o.p.approved && o.p.available === "yes" && o.p.localityConfirmed && o.r.areaConfirmed && plan.areaConfirmed
        && normalizeProduct(o.p.locality ?? "") === normalizeProduct(o.r.locality ?? "") && !!o.p.locality?.trim()
        && age >= 0 && age <= 7 && (o.p.substitution ? item.substitutions && !!o.p.matchNote?.trim() : true);
    });
    const references = valid.filter(o => storeName(o.r.name) === "Superstore" && !o.p.substitution && o.rate!.amount > 0);
    let found = false;
    for (const group of groups.filter(g => g.name !== "Superstore")) {
      const savings: TargetSaving[] = [];
      for (const alternative of valid.filter(o => group.retailers.some(r => r.id === o.r.id))) {
        const baseline = references.filter(o => o.rate!.basis === alternative.rate!.basis && o.p.mode === alternative.p.mode
          && (normalizeProduct(o.p.product) === normalizeProduct(alternative.p.product) || alternative.p.substitution))
          .sort((a, b) => a.rate!.amount - b.rate!.amount)[0];
        if (!baseline || alternative.rate!.amount >= baseline.rate!.amount) continue;
        const difference = baseline.rate!.amount - alternative.rate!.amount;
        const percent = difference / baseline.rate!.amount * 100;
        if (Number.isFinite(percent) && percent > 0) savings.push({ item, alternative, baseline, percent, difference });
      }
      savings.sort((a, b) => b.percent - a.percent);
      if (savings[0]) { result.push(savings[0]); found = true; }
    }
    if (!found) excluded.push(item);
  }
  return { result, excluded };
}
export const savingLabel = (percent: number) => percent < .1 ? "<0,1 %" : `${new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1 }).format(percent)} %`;
