/** Purchases are source-backed observations, never measurements of consumption. */
export class GroceryError extends Error {}
export type GroceryUnit = "g" | "kg" | "ml" | "l" | "each";
export type GroceryItem = { name: string; product: string; amount: number | null; quantity: number | null;
  size: number | null; unit: GroceryUnit | null; evidence: string; uncertain: boolean;
  productReference?: { provider: "pcexpress"; id: string } };
export type GroceryReceipt = { sourceType?: "unknown" | "confirmation" | "final-receipt"; fulfillment?: { date: string; evidence: string }; store: string; date: string | null; currency: string | null; reference: string;
  total: number | null; delivery: number | null; service: number | null; tip: number | null; tax: number | null;
  discount: number | null; items: GroceryItem[]; warnings: string[] };
export type GrocerySource = { hash: string; name: string; type: string; size: number };
export type GroceryRecord = { id: string; revision: string; status: "draft" | "saved"; createdAt: string;
  sources: GrocerySource[]; receipt: GroceryReceipt; extraction: "pending" | "running" | "complete" | "failed";
  reviewedAt: string | null; duplicateOf: string | null;
  automaticImport?: { kind: "pc-express-gmail"; importedAt: string; orderId: string; sourceMessageIds: string[] } };
export type GroceryLibrary = { records: GroceryRecord[] };
export function receiptSourceType(record: GroceryRecord): NonNullable<GroceryReceipt["sourceType"]> {
  // An explicitly reviewed final receipt can coexist with its original confirmation sources.
  if (record.receipt.sourceType === "final-receipt") return "final-receipt";
  if (record.receipt.sourceType === "confirmation" || /confirmation|order placed|commande confirm/i.test([record.receipt.reference, ...record.receipt.warnings, ...(record.sources ?? []).map(s => s.name)].join(" "))) return "confirmation";
  return record.receipt.sourceType ?? "unknown";
}
export const emptyReceipt = (): GroceryReceipt => ({ store: "", date: null, currency: null, reference: "", total: null,
  delivery: null, service: null, tip: null, tax: null, discount: null, items: [], warnings: [] });
export const blankItem = (): GroceryItem => ({ name: "", product: "", amount: null, quantity: null, size: null, unit: null, evidence: "", uncertain: true });
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new GroceryError("Invalid receipt."); return v as Record<string, unknown>; };
const text = (v: unknown, max = 200): string => { if (typeof v !== "string" || v.length > max) throw new GroceryError("Invalid receipt text."); return v.trim(); };
const money = (v: unknown): number | null => { if (v === null) return null; if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000 || Math.abs(v * 100 - Math.round(v * 100)) > 0.0001) throw new GroceryError("Invalid amount (up to two decimal places)."); return v; };
const positive = (v: unknown): number | null => { if (v === null) return null; if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1_000_000) throw new GroceryError("Invalid quantity or pack size."); return v; };
export function validateReceipt(value: unknown): GroceryReceipt {
  const r = obj(value), date = r.date;
  let fulfillment: GroceryReceipt["fulfillment"];
  if (r.fulfillment !== undefined && r.fulfillment !== null) {
    const f = obj(r.fulfillment), evidence = text(f.evidence, 1000);
    if (typeof f.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !Number.isFinite(Date.parse(f.date + "T00:00:00Z")) || new Date(f.date + "T00:00:00Z").toISOString().slice(0, 10) !== f.date || !evidence) throw new GroceryError("Dated delivery evidence is required.");
    fulfillment = { date: f.date, evidence };
  }
  if (r.sourceType !== undefined && !["unknown", "confirmation", "final-receipt"].includes(String(r.sourceType))) throw new GroceryError("Invalid source type.");
  if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)) throw new GroceryError("Invalid date.");
  if (r.currency !== null && (typeof r.currency !== "string" || !/^[A-Z]{3}$/.test(r.currency))) throw new GroceryError("Invalid currency.");
  if (!Array.isArray(r.items) || r.items.length > 200 || !Array.isArray(r.warnings) || r.warnings.length > 30) throw new GroceryError("Invalid receipt line items.");
  const items = r.items.map(v => { const i = obj(v); if (typeof i.uncertain !== "boolean" || i.unit !== null && !["g", "kg", "ml", "l", "each"].includes(String(i.unit))) throw new GroceryError("Invalid unit or uncertain-item flag.");
    let productReference: GroceryItem["productReference"];
    if (i.productReference !== undefined) { const ref = obj(i.productReference); if (ref.provider !== "pcexpress" || typeof ref.id !== "string" || !/^\d{6,14}_(?:EA|KG)$/.test(ref.id)) throw new GroceryError("Invalid source product reference."); productReference = { provider: "pcexpress", id: ref.id }; }
    return { name: text(i.name), product: text(i.product), amount: money(i.amount), quantity: positive(i.quantity), size: positive(i.size), unit: i.unit as GroceryUnit | null, evidence: text(i.evidence, 1000), uncertain: i.uncertain, ...(productReference ? { productReference } : {}) }; });
  return { ...(r.sourceType === undefined ? {} : { sourceType: r.sourceType as GroceryReceipt["sourceType"] }), ...(fulfillment ? { fulfillment } : {}), store: text(r.store), date: date as string | null, currency: r.currency as string | null, reference: text(r.reference),
    total: money(r.total), delivery: money(r.delivery), service: money(r.service), tip: money(r.tip), tax: money(r.tax), discount: money(r.discount), items, warnings: r.warnings.map(v => text(v, 1000)) };
}
export const normalizeProduct = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
export function unitPrice(item: GroceryItem): { price: number; unit: string } | null {
  if (item.amount === null || item.quantity === null || item.size === null || !item.unit) return null;
  const factor = item.unit === "g" || item.unit === "ml" ? .001 : 1;
  const denominator = item.quantity * item.size * factor, price = item.amount / denominator;
  if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(price)) return null;
  return { price, unit: item.unit === "g" || item.unit === "kg" ? "kg" : item.unit === "ml" || item.unit === "l" ? "l" : "unité" };
}
export function receiptWarnings(r: GroceryReceipt): string[] {
  const warnings = [...r.warnings];
  if (!r.store || !r.date || !r.currency || r.total === null) warnings.push("The store, date, currency or total is missing. The analysis will be incomplete.");
  if (!r.items.length || r.items.some(i => !i.name || i.amount === null || i.uncertain)) warnings.push("Some items or prices are uncertain. Check the sources and correct the line items.");
  if (r.items.length && r.items.every(i => i.amount !== null) && r.total !== null) {
    const sum = r.items.reduce((s, i) => s + i.amount!, 0) + (r.delivery ?? 0) + (r.service ?? 0) + (r.tip ?? 0) + (r.tax ?? 0) - (r.discount ?? 0);
    if (Math.abs(sum - r.total) > .02) warnings.push("Items, fees, taxes and discounts do not add up to the total. Check for overlapping photos or missing line items.");
  }
  return [...new Set(warnings)];
}
export function possibleDuplicates(record: GroceryRecord, records: GroceryRecord[]): GroceryRecord[] {
  const r = record.receipt;
  if (!r.store || !r.date || !r.currency || r.total === null) return [];
  return records.filter(other => other.id !== record.id && other.status === "saved" && normalizeProduct(other.receipt.store) === normalizeProduct(r.store)
    && other.receipt.date === r.date && other.receipt.currency === r.currency && other.receipt.total === r.total);
}
export function monthlySummary(records: GroceryRecord[], month: string) {
  const selected = records.filter(r => r.status === "saved" && !r.duplicateOf && receiptSourceType(r) !== "confirmation" && r.receipt.date?.startsWith(month));
  const currencies = [...new Set(selected.map(r => r.receipt.currency).filter((c): c is string => Boolean(c)))];
  return { incomplete: records.filter(r => r.status === "saved" && (!r.receipt.date || !r.receipt.currency || r.receipt.total === null)).length,
    currencies: currencies.map(currency => {
      const rows = selected.filter(r => r.receipt.currency === currency);
      const products = new Map<string, { name: string; receipts: Set<string>; spent: number; observations: { price: number; unit: string; date: string; store: string; receiptId: string }[] }>();
      for (const record of rows) for (const item of record.receipt.items) {
        const key = normalizeProduct(item.product || item.name); if (!key) continue;
        const product = products.get(key) ?? { name: item.product || item.name, receipts: new Set<string>(), spent: 0, observations: [] };
        product.receipts.add(record.id); product.spent += item.amount ?? 0;
        const price = unitPrice(item);
        if (price && !item.uncertain) product.observations.push({ ...price, date: record.receipt.date!, store: record.receipt.store, receiptId: record.id });
        products.set(key, product);
      }
      // A month's frequent products can be compared with earlier observed receipts.
      for (const record of records.filter(r => r.status === "saved" && !r.duplicateOf && receiptSourceType(r) !== "confirmation" && r.receipt.currency === currency && r.receipt.date && !r.receipt.date.startsWith(month))) {
        for (const item of record.receipt.items) {
          const product = products.get(normalizeProduct(item.product || item.name)), price = unitPrice(item);
          if (product && price && !item.uncertain) product.observations.push({ ...price, date: record.receipt.date!, store: record.receipt.store, receiptId: record.id });
        }
      }
      return { currency, count: rows.length, total: rows.reduce((s, r) => s + (r.receipt.total ?? 0), 0),
        fees: rows.reduce((s, r) => s + (r.receipt.delivery ?? 0) + (r.receipt.service ?? 0) + (r.receipt.tip ?? 0), 0),
        products: [...products.values()].map(p => ({ ...p, count: p.receipts.size, receipts: undefined })).sort((a, b) => b.count - a.count || b.spent - a.spent) };
    }) };
}
