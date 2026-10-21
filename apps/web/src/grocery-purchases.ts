import { normalizeProduct, receiptSourceType, type GroceryItem, type GroceryRecord } from "../../worker/src/grocery-model";
import { normalizedSize, type GroceryPlan, type GroceryPrice, type GroceryRetailer } from "../../worker/src/grocery-planning";
import { datedPrice, storeName } from "./grocery-comparison";
import { grocerySourceLink } from "./grocery-source-link";
import { targetProductConflict } from "./grocery-target-observations";

export function purchaseStatus(record: GroceryRecord) {
  // Old saved records have no evidence of final payment. Never infer it from `saved`.
  const confirmation = receiptSourceType(record) === "confirmation";
  return confirmation ? "Confirmation originale · paiement final inconnu" : record.status === "saved" && record.reviewedAt && record.receipt.sourceType === "final-receipt" ? "Reçu final · payé" : "Montant source · paiement à vérifier";
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
export type PurchaseLineComparison = { line: GroceryItem; price: GroceryPrice | null; reason: string; normalized: number | null; outlay: number | null; packs: number | null; ratio: number | null; calculated: boolean };
export function purchaseComparison(plan: GroceryPlan, record: GroceryRecord, now = new Date().toISOString().slice(0, 10)) {
  const names = ["Superstore", "Costco", "Save-On-Foods", "Fresh St. Market"];
  const retailers: (GroceryRetailer | { id: string; name: string })[] = [...plan.retailers];
  const canonicalStore = (name: string) => /^save[\s-]*on[\s-]*foods\b/i.test(name) ? "Save-On-Foods" : /^real canadian superstore\b/i.test(name) ? "Superstore" : storeName(name);
  for (const name of names) if (!retailers.some(r => canonicalStore(r.name) === name)) retailers.push({ id: "missing-" + name, name });
  return retailers.map(retailer => {
    const lines: PurchaseLineComparison[] = record.receipt.items.map(line => {
      const base = { line, price: null, normalized: null, outlay: null, packs: null, ratio: null, calculated: false };
      const id = receiptItemId(plan, record, line);
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
      const purchasedPack = normalizedSize(line.size, line.unit);
      return { line, price, ratio, packs, normalized, outlay, calculated: Math.abs(purchasedPack.size - pack.size) > 1e-10, reason: "" };
    });
    const covered = lines.filter(l => l.normalized !== null), complete = lines.length > 0 && covered.length === lines.length;
    // Repeated physical rows can share one buyable pack; round after grouping the same reference.
    const grouped = new Map<string, { price: GroceryPrice; ratio: number }>();
    for (const line of covered) { const p = line.price!; const previous = grouped.get(p.id); grouped.set(p.id, { price: p, ratio: (previous?.ratio ?? 0) + line.ratio! }); }
    return { retailer, lines, covered: covered.length, count: lines.length, complete,
      normalized: covered.length ? covered.reduce((n, l) => n + l.normalized!, 0) : null,
      outlay: covered.length ? [...grouped.values()].reduce((n, g) => n + (g.price.weighed ? g.ratio : Math.ceil(g.ratio - 1e-10)) * g.price.price, 0) : null };
  });
}
