import { GroceryError, type GroceryUnit } from "./grocery-model.js";

export type ShoppingItem = { id: string; name: string; quantity: number | null; size: number | null; unit: GroceryUnit | null; preference: string; substitutions: boolean; active: boolean; origin: string; cadence?: "week" | "month" | "other" | "unknown"; every?: number; cadenceNote?: string; bucket?: "food" | "household"; measure?: "physical" | "pack" | "uses"; countUnit?: string; provisional?: boolean; freshness?: "fresh" | "frozen" | "pantry" | "household" | "unknown"; basketQuantity?: number | null };
export type PurchaseMode = "unknown" | "delivery" | "pickup" | "store";
export const modeLabels: Record<PurchaseMode, string> = { unknown: "Mode inconnu", delivery: "Livraison", pickup: "Retrait", store: "En magasin / entrepôt" };
export type Evidence = { title: string; url: string; date: string; until: string | null };
export type GroceryRetailer = { id: string; name: string; delivery: number | null; service: number | null; servicePercent: number | null; feesTaxPercent: number | null; minimum: number | null; freeDeliveryAbove: number | null; areaConfirmed: boolean; otherFeesReviewed: boolean; evidence: Evidence; mode?: PurchaseMode; locality?: string; slots?: "unknown" | "yes" | "no"; enabled?: boolean; membershipWeekly?: number | null; membershipStatus?: "unknown" | "none" | "existing" | "proposal"; membershipNote?: string };
export type GroceryPrice = { id: string; itemId: string; retailerId: string; product: string; price: number; size: number; unit: GroceryUnit; weighed: boolean; taxPercent: number | null; currency: string; available: "unknown" | "yes" | "no"; substitution: boolean; approved: boolean; kind: "public" | "manual" | "receipt"; evidence: Evidence; mode?: PurchaseMode; locality?: string; localityConfirmed?: boolean; depositPerPack?: number | null; usesPerPack?: number | null; matchNote?: string };
export type GroceryPlan = { schema: 1; revision: string; area: string; areaConfirmed: boolean; currency: string; tipPerOrder: number; items: ShoppingItem[]; retailers: GroceryRetailer[]; prices: GroceryPrice[] };
export const emptyPlan = (): GroceryPlan => ({ schema: 1, revision: "", area: "", areaConfirmed: false, currency: "CAD", tipPerOrder: 0, items: [], retailers: [], prices: [] });
export const emptyEvidence = (): Evidence => ({ title: "", url: "", date: "", until: null });
const units = ["g", "kg", "ml", "l", "each"];
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new GroceryError("Données de liste invalides."); return v as Record<string, unknown>; };
const text = (v: unknown, max = 200) => { if (typeof v !== "string" || v.length > max) throw new GroceryError("Texte de liste invalide."); return v.trim(); };
const id = (v: unknown) => { const s = text(v, 80); if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new GroceryError("Identifiant de liste invalide."); return s; };
const flag = (v: unknown) => { if (typeof v !== "boolean") throw new GroceryError("Confirmation invalide."); return v; };
const number = (v: unknown, nullable = true, max = 1_000_000, positive = false) => { if (nullable && v === null) return null; if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max || positive && v < .000001) throw new GroceryError("Quantité, prix ou frais invalide (minimum de quantité/format : 0,000001)."); return v; };
const money = (v: unknown, nullable = true) => { const n = number(v, nullable); if (n !== null && Math.abs(n * 100 - Math.round(n * 100)) > .0001) throw new GroceryError("Utilisez deux décimales pour les montants."); return n; };
const date = (v: unknown, blank = false) => { const s = text(v, 10); if (blank && !s) return s; if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new GroceryError("Date de source invalide."); return s; };
export function publicSourceUrl(v: unknown) {
  const s = text(v, 2000); if (!s) return s;
  let u: URL; try { u = new URL(s); } catch { throw new GroceryError("Lien source invalide."); }
  // Never fetch these URLs on the worker. Reject credentials and local targets even for UI links.
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname) || /\.(?:local|localhost|internal)$/i.test(u.hostname)) throw new GroceryError("Utilisez un lien HTTPS public sans identifiants.");
  return u.href;
}
const evidence = (v: unknown): Evidence => { const e = object(v); const d = date(e.date, true), until = e.until === null ? null : date(e.until); if (until && (!d || until < d)) throw new GroceryError("Validité de source incohérente."); return { title: text(e.title, 500), url: publicSourceUrl(e.url), date: d, until }; };
const currency = (v: unknown) => { const s = text(v, 3); if (!/^[A-Z]{3}$/.test(s)) throw new GroceryError("Devise invalide."); return s; };
const enumValue = <const T extends string>(v: unknown, values: readonly T[]): T => { if (!values.includes(v as T)) throw new GroceryError("Choix Courses invalide."); return v as T; };
const modeValues = ["unknown", "delivery", "pickup", "store"] as const;
function itemDetails(i: Record<string, unknown>) {
  const out: Partial<ShoppingItem> = {};
  if (i.cadence !== undefined) out.cadence = enumValue(i.cadence, ["week", "month", "other", "unknown"]);
  if (i.every !== undefined) out.every = number(i.every, false, 120, true)!;
  if (i.cadenceNote !== undefined) out.cadenceNote = text(i.cadenceNote, 500);
  if (i.bucket !== undefined) out.bucket = enumValue(i.bucket, ["food", "household"]);
  if (i.measure !== undefined) out.measure = enumValue(i.measure, ["physical", "pack", "uses"]);
  if (i.countUnit !== undefined) out.countUnit = text(i.countUnit, 40);
  if (i.provisional !== undefined) out.provisional = flag(i.provisional);
  if (i.freshness !== undefined) out.freshness = enumValue(i.freshness, ["fresh", "frozen", "pantry", "household", "unknown"]);
  if (i.basketQuantity !== undefined) out.basketQuantity = number(i.basketQuantity, true, 10000, true);
  return out;
}
function retailerDetails(r: Record<string, unknown>) {
  const out: Partial<GroceryRetailer> = {};
  if (r.mode !== undefined) out.mode = enumValue(r.mode, modeValues);
  if (r.locality !== undefined) out.locality = text(r.locality, 200);
  if (r.slots !== undefined) out.slots = enumValue(r.slots, ["unknown", "yes", "no"]);
  if (r.enabled !== undefined) out.enabled = flag(r.enabled);
  if (r.membershipWeekly !== undefined) out.membershipWeekly = money(r.membershipWeekly);
  if (r.membershipStatus !== undefined) out.membershipStatus = enumValue(r.membershipStatus, ["unknown", "none", "existing", "proposal"]);
  if (r.membershipNote !== undefined) out.membershipNote = text(r.membershipNote, 500);
  if (out.membershipStatus === "none" && out.membershipWeekly !== 0) throw new GroceryError("Sans abonnement : confirmez une allocation à 0.");
  return out;
}
function priceDetails(o: Record<string, unknown>) {
  const out: Partial<GroceryPrice> = {};
  if (o.mode !== undefined) out.mode = enumValue(o.mode, modeValues);
  if (o.locality !== undefined) out.locality = text(o.locality, 200);
  if (o.localityConfirmed !== undefined) out.localityConfirmed = flag(o.localityConfirmed);
  if (o.depositPerPack !== undefined) out.depositPerPack = money(o.depositPerPack);
  if (o.usesPerPack !== undefined) out.usesPerPack = number(o.usesPerPack, true, 100000, true);
  if (o.matchNote !== undefined) out.matchNote = text(o.matchNote, 500);
  return out;
}
export function validatePlan(v: unknown): GroceryPlan {
  const p = object(v);
  if (p.schema !== 1 || !Array.isArray(p.items) || p.items.length > 60 || !Array.isArray(p.retailers) || p.retailers.length > 16 || !Array.isArray(p.prices) || p.prices.length > 300) throw new GroceryError("Limite de liste atteinte (60 produits, 16 magasins/modes, 300 prix).");
  const items = p.items.map(v => { const i = object(v); if (i.unit !== null && !units.includes(String(i.unit))) throw new GroceryError("Unité invalide."); const name = text(i.name); if (!name) throw new GroceryError("Nommez chaque produit."); return { id: id(i.id), name, quantity: number(i.quantity, true, 10000, true), size: number(i.size, true, 100000, true), unit: i.unit as GroceryUnit | null, preference: text(i.preference, 500), substitutions: flag(i.substitutions), active: flag(i.active), origin: text(i.origin, 80), ...itemDetails(i) }; });
  const retailers = p.retailers.map(v => { const r = object(v); const name = text(r.name); if (!name) throw new GroceryError("Nommez chaque magasin."); return { id: id(r.id), name, delivery: money(r.delivery), service: money(r.service), servicePercent: number(r.servicePercent, true, 100), feesTaxPercent: number(r.feesTaxPercent, true, 100), minimum: money(r.minimum), freeDeliveryAbove: money(r.freeDeliveryAbove), areaConfirmed: flag(r.areaConfirmed), otherFeesReviewed: flag(r.otherFeesReviewed), evidence: evidence(r.evidence), ...retailerDetails(r) }; });
  const prices = p.prices.map(v => { const o = object(v); if (!units.includes(String(o.unit)) || !["unknown", "yes", "no"].includes(String(o.available)) || !["public", "manual", "receipt"].includes(String(o.kind))) throw new GroceryError("Offre invalide."); const e = evidence(o.evidence); if (!e.title || !e.date || o.kind === "public" && !e.url) throw new GroceryError("Chaque prix nécessite une source et sa date ; une offre publique nécessite son lien."); return { id: id(o.id), itemId: id(o.itemId), retailerId: id(o.retailerId), product: text(o.product), price: money(o.price, false)!, size: number(o.size, false, 100000, true)!, unit: o.unit as GroceryUnit, weighed: flag(o.weighed), taxPercent: number(o.taxPercent, true, 100), currency: currency(o.currency), available: o.available as GroceryPrice["available"], substitution: flag(o.substitution), approved: flag(o.approved), kind: o.kind as GroceryPrice["kind"], evidence: e, ...priceDetails(o) }; });
  for (const rows of [items, retailers, prices]) if (new Set(rows.map(i => i.id)).size !== rows.length) throw new GroceryError("Identifiants dupliqués.");
  if (prices.some(o => !items.some(i => i.id === o.itemId) || !retailers.some(r => r.id === o.retailerId))) throw new GroceryError("Le prix référence un produit ou magasin absent.");
  const area = text(p.area, 100), areaConfirmed = flag(p.areaConfirmed); if (areaConfirmed && !area) throw new GroceryError("Confirmez votre ville ou préfixe postal de domicile.");
  return { schema: 1, revision: text(p.revision, 80), area, areaConfirmed, currency: currency(p.currency), tipPerOrder: money(p.tipPerOrder, false)!, items, retailers, prices };
}
const cents = (n: number) => Math.round(n * 100);
export function normalizedSize(size: number, unit: GroceryUnit) { return { size: size * (unit === "g" || unit === "ml" ? .001 : 1), unit: unit === "g" || unit === "kg" ? "kg" : unit === "l" || unit === "ml" ? "l" : "each" }; }
export function offerQuantity(item: ShoppingItem, offer: GroceryPrice): number | null {
  const requested = item.basketQuantity !== undefined ? item.basketQuantity : item.quantity;
  if (requested === null || !Number.isFinite(requested) || requested <= 0) return null;
  if (item.measure === "pack" || item.measure === "uses") {
    const ratio = item.measure === "pack" ? requested : offer.usesPerPack ? requested / offer.usesPerPack : NaN;
    const count = Math.ceil(ratio - Number.EPSILON * Math.max(1, ratio) * 4);
    return Number.isFinite(count) && count > 0 && count <= 1_000_000 && count * offer.price <= 1_000_000 ? count : null;
  }
  if (item.size === null || !item.unit) return null;
  const target = normalizedSize(requested * item.size, item.unit), pack = normalizedSize(offer.size, offer.unit);
  if (target.unit !== pack.unit || offer.weighed && pack.unit === "each") return null;
  const ratio = target.size / pack.size;
  const quantity = offer.weighed ? ratio : Math.max(1, Math.ceil(ratio - Number.EPSILON * Math.max(1, ratio) * 4));
  // Refuse overflow/unsupported baskets rather than turning nonfinite costs into JSON null/zero.
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !Number.isFinite(quantity * offer.price) || quantity * offer.price > 1_000_000) return null;
  return quantity;
}
export type Basket = { key: string; name: string; split: boolean; coverage: number; count: number; subtotal: number; foodSubtotal: number; householdSubtotal: number; total: number | null; eligible: boolean; missing: string[]; lines: { itemId: string; priceId: string; retailerId: string; quantity: number; cost: number }[]; orders: { retailerId: string; subtotal: number; tax: number | null; delivery: number | null; service: number | null; feesTax: number | null; deposit: number | null; membership: number | null; tip: number; total: number | null }[] };
function basket(plan: GroceryPlan, prices: GroceryPrice[], now: string, name: string, split: boolean): Basket {
  const missing: string[] = [], items = plan.items.filter(i => i.active);
  // Legacy calculations remain readable. Once weekly metadata is used, all selected
  // observations need an explicit mode/locality and modeled new mandatory costs.
  const weekly = plan.items.some(i => i.cadence !== undefined || i.measure !== undefined || i.basketQuantity !== undefined) || plan.retailers.some(r => r.mode !== undefined);
  const lines = prices.map(o => ({ itemId: o.itemId, priceId: o.id, retailerId: o.retailerId, quantity: offerQuantity(items.find(i => i.id === o.itemId)!, o)!, cost: cents(o.price * offerQuantity(items.find(i => i.id === o.itemId)!, o)!) }));
  let eligible = plan.areaConfirmed;
  if (!plan.areaConfirmed) missing.push("Zone de domicile à confirmer");
  for (const item of items) if (!lines.some(l => l.itemId === item.id)) missing.push(`${item.name} : prix, quantité, format ou substitution à préciser`);
  for (const item of items) if (item.provisional) { missing.push(`${item.name} : besoin provisoire à confirmer`); eligible = false; }
  for (const o of prices) {
    if (o.mode === "unknown" || weekly && !o.mode) { missing.push(`${o.product || o.itemId} : mode du prix inconnu`); eligible = false; }
    if (o.localityConfirmed === false || weekly && (o.localityConfirmed !== true || !o.locality?.trim())) { missing.push(`${o.product || o.itemId} : prix local à confirmer`); eligible = false; }
    if (o.available !== "yes") { missing.push(`${o.product || o.itemId} : disponibilité inconnue`); eligible = false; }
    if (o.kind === "receipt" || !o.evidence.until || o.evidence.until < now || o.evidence.date > now) { missing.push(`${o.product || o.itemId} : prix historique ou validité à vérifier`); eligible = false; }
  }
  const orders = [...new Set(lines.map(l => l.retailerId))].map(retailerId => {
    const r = plan.retailers.find(r => r.id === retailerId)!, selected = lines.filter(l => l.retailerId === retailerId), subtotal = selected.reduce((s, l) => s + l.cost, 0);
    if (r.mode === "unknown" || weekly && !r.mode) { missing.push(`${r.name} : mode d'achat inconnu`); eligible = false; }
    if (weekly && !r.locality?.trim()) { missing.push(`${r.name} : localité à confirmer`); eligible = false; }
    if (r.mode === "delivery" && r.slots !== "yes") { missing.push(`${r.name} : créneaux de livraison non confirmés`); eligible = false; }
    if (r.membershipStatus === "unknown" || r.membershipStatus === "proposal" || weekly && !r.membershipStatus) { missing.push(`${r.name} : abonnement ${r.membershipStatus === "proposal" ? "proposé, non souscrit" : "à vérifier"}`); eligible = false; }
    if (!r.areaConfirmed) { missing.push(`${r.name} : desserte non confirmée`); eligible = false; }
    if (!r.evidence.title || !r.evidence.date || r.evidence.date > now || !r.evidence.until || r.evidence.until < now) { missing.push(`${r.name} : conditions non datées ou validité à vérifier`); eligible = false; }
    const tax = selected.some(l => prices.find(o => o.id === l.priceId)!.taxPercent === null) ? null : selected.reduce((s, l) => s + Math.round(l.cost * prices.find(o => o.id === l.priceId)!.taxPercent! / 100), 0);
    const delivery = r.freeDeliveryAbove !== null && subtotal >= cents(r.freeDeliveryAbove) ? 0 : r.delivery === null ? null : cents(r.delivery);
    const service = r.service === null || r.servicePercent === null ? null : cents(r.service) + Math.round(subtotal * r.servicePercent / 100);
    const feesTax = r.feesTaxPercent === null || delivery === null || service === null ? null : Math.round((delivery + service) * r.feesTaxPercent / 100);
    const deposit = selected.some(l => { const d = prices.find(o => o.id === l.priceId)!.depositPerPack; return d === null || weekly && d === undefined; }) ? null : selected.reduce((s, l) => s + cents((prices.find(o => o.id === l.priceId)!.depositPerPack ?? 0) * l.quantity), 0);
    const membership = r.membershipWeekly === null || weekly && r.membershipWeekly === undefined ? null : cents(r.membershipWeekly ?? 0);
    if (r.minimum === null) missing.push(`${r.name} : minimum de commande inconnu`);
    else if (subtotal < cents(r.minimum)) { missing.push(`${r.name} : minimum de commande non atteint`); eligible = false; }
    if (!r.otherFeesReviewed) missing.push(`${r.name} : autres frais obligatoires à vérifier`);
    if (tax === null) missing.push(`${r.name} : taxes produits inconnues`);
    if (deposit === null) missing.push(`${r.name} : consignes / frais par format inconnus`);
    if (membership === null) missing.push(`${r.name} : allocation d'abonnement hebdomadaire inconnue`);
    if (delivery === null || service === null || feesTax === null) missing.push(`${r.name} : livraison, service ou taxes sur frais inconnus`);
    const tip = cents(plan.tipPerOrder);
    const total = tax === null || delivery === null || service === null || feesTax === null || deposit === null || membership === null || r.minimum === null || !r.otherFeesReviewed ? null : subtotal + tax + delivery + service + feesTax + deposit + membership + tip;
    return { retailerId, subtotal, tax, delivery, service, feesTax, deposit, membership, tip, total };
  });
  const complete = items.length > 0 && lines.length === items.length;
  const total = !complete || orders.some(o => o.total === null) ? null : orders.reduce((s, o) => s + o.total!, 0);
  const foodSubtotal = lines.filter(l => items.find(i => i.id === l.itemId)?.bucket !== "household").reduce((s, l) => s + l.cost, 0), householdSubtotal = lines.reduce((s, l) => s + l.cost, 0) - foodSubtotal;
  return { key: prices.map(o => o.id).sort().join("|"), name, split, coverage: lines.length, count: items.length, subtotal: foodSubtotal + householdSubtotal, foodSubtotal, householdSubtotal, total, eligible: eligible && total !== null, missing: [...new Set(missing)], lines, orders };
}
export function compatibleOffers(plan: GroceryPlan, item: ShoppingItem) {
  return plan.prices.filter(o => { const r = plan.retailers.find(r => r.id === o.retailerId); return r && r.enabled !== false && (o.mode ?? "unknown") === (r.mode ?? "unknown") && o.itemId === item.id && o.approved && o.currency === plan.currency && o.available !== "no" && (!o.substitution || item.substitutions) && offerQuantity(item, o) !== null; });
}
/** Exhaustive within the stated cap, retaining pack alternatives and nonlinear delivery thresholds. */
export function compareBaskets(plan: GroceryPlan, now = new Date().toISOString().slice(0, 10)) {
  const items = plan.items.filter(i => i.active), options = items.map(i => compatibleOffers(plan, i));
  const whole: Basket[] = [], split: Basket[] = []; let examined = 0, truncated = false;
  const limit = 5_000;
  // Each partial whole-store basket remains visible. Complete variants are all considered.
  function enumerate(choices: GroceryPrice[][], done: (p: GroceryPrice[]) => void, partial = false) {
    const visit = (index: number, chosen: GroceryPrice[]) => { if (examined >= limit) { truncated = true; return; } if (index === choices.length) { examined++; done(chosen); return; } if (!choices[index].length) { if (partial) visit(index + 1, chosen); return; } for (const o of choices[index]) { visit(index + 1, [...chosen, o]); if (truncated) break; } };
    if (items.length) visit(0, []);
  }
  for (const r of plan.retailers.filter(r => r.enabled !== false)) { let best: Basket | null = null; enumerate(options.map(rows => rows.filter(o => o.retailerId === r.id)), p => { const candidate = basket(plan, p, now, r.name + (r.mode ? ` — ${modeLabels[r.mode]}` : ""), false); if (!best || sortBaskets(candidate, best) < 0) best = candidate; }, true); if (best) whole.push(best); }
  if (items.length && options.some(rows => rows.length)) enumerate(options, p => { const stores = [...new Set(p.map(o => o.retailerId))]; if (stores.length > 1 && stores.length <= 3) { split.push(basket(plan, p, now, stores.map(id => { const r = plan.retailers.find(r => r.id === id)!; return r.name + (r.mode ? ` (${modeLabels[r.mode]})` : ""); }).join(" + "), true)); split.sort(sortBaskets); if (split.length > 3) split.pop(); } }, true);
  split.sort(sortBaskets); whole.sort(sortBaskets);
  const alternatives = [...whole, ...split].sort(sortBaskets);
  return { whole, split: split.slice(0, 3), examined, truncated, best: truncated ? null : alternatives.find(b => b.eligible) ?? null, coverage: options.filter(o => o.length).length, count: items.length };
}
function sortBaskets(a: Basket, b: Basket) { return Number(b.eligible) - Number(a.eligible) || Number(b.total !== null) - Number(a.total !== null) || (a.total ?? Infinity) - (b.total ?? Infinity) || b.coverage - a.coverage || a.key.localeCompare(b.key); }
