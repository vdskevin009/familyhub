import type { GroceryPlan, ShoppingItem } from "../../worker/src/grocery-planning";
import { normalizeProduct, type GroceryRecord } from "../../worker/src/grocery-model";
export type ReceiptProduct = { itemId: string; product: string; recordId: string; store: string; date: string | null };
/** Exact reviewed product labels, never brand guesses from abbreviations or private preferences. */
export function receiptProducts(plan: GroceryPlan, records: GroceryRecord[]): ReceiptProduct[] {
  const result: ReceiptProduct[] = [], seen = new Set<string>();
  for (const record of records) {
    if (record.status !== "saved" || record.extraction === "running" || !record.reviewedAt || record.duplicateOf) continue;
    for (const line of record.receipt.items) {
      const product = line.product.trim();
      if (line.uncertain || !product || !line.evidence.trim()) continue;
      const explicit = [...line.evidence.matchAll(/Article rapproché\s*:\s*([a-zA-Z0-9_-]+)(?=[.\s]|$)/g)].map(m => m[1]);
      const linked = plan.prices.filter(p => p.kind === "receipt" && normalizeProduct(p.product) === normalizeProduct(product)
        && p.evidence.title.split(/[^a-zA-Z0-9_-]+/).includes(record.id)).map(p => p.itemId);
      const exact = plan.items.filter(i => normalizeProduct(i.name) === normalizeProduct(line.name) || normalizeProduct(i.name) === normalizeProduct(product)).map(i => i.id);
      const ids = [...new Set(explicit.length ? explicit : linked.length ? linked : exact)];
      if (ids.length !== 1 || !plan.items.some(i => i.id === ids[0])) continue;
      const key = ids[0] + ":" + normalizeProduct(product);
      if (seen.has(key)) continue; seen.add(key);
      result.push({ itemId: ids[0], product, recordId: record.id, store: record.receipt.store, date: record.receipt.date });
    }
  }
  return result;
}
export function receiptPreference(item: ShoppingItem, product: string): string | null {
  if (!product.trim() || normalizeProduct(item.preference).includes(normalizeProduct(product))) return null;
  const value = [item.preference.trim(), "Produit observé sur ticket : " + product.trim()].filter(Boolean).join(" · ");
  return value.length <= 500 ? value : null;
}
/** The only body sent to public research: no receipt, identity, preference or evidence. */
export function publicProductResearch(product: string, area: string, confirmed: boolean) {
  if (!product.trim() || product.length > 80) throw new Error("Précisez un produit public de 80 caractères maximum, avec sa marque si souhaité.");
  return { product: product.trim(), area, confirmed };
}
