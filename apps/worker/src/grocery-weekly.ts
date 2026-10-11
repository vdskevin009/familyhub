import { compareBaskets, emptyEvidence, type GroceryPlan, type GroceryRetailer, type ShoppingItem } from "./grocery-planning.js";

export const suggestedRetailers = ["Walmart", "Superstore", "Costco", "Fresh St. Market", "Save-On-Foods"] as const;
export function retailerTemplate(id: string, name: string): GroceryRetailer {
  return { id, name, mode: "unknown", locality: "", slots: "unknown", enabled: true, delivery: null, service: null, servicePercent: null, feesTaxPercent: null, minimum: null, freeDeliveryAbove: null, areaConfirmed: false, otherFeesReviewed: false, membershipWeekly: null, membershipStatus: "unknown", membershipNote: "", evidence: emptyEvidence() };
}

export function cadenceLabel(i: ShoppingItem) {
  const n = i.every ?? 1;
  return i.cadence === "week" ? (n === 1 ? "par semaine" : `toutes les ${n} semaines`) : i.cadence === "month" ? (n === 1 ? "par mois" : `tous les ${n} mois`) : i.cadence === "other" ? i.cadenceNote || "occasionnel" : "fréquence à préciser";
}
export function needLabel(i: ShoppingItem, basket = false) {
  const q = basket && i.basketQuantity !== undefined ? i.basketQuantity : i.quantity;
  if (q === null) return "Quantité à préciser";
  if (i.measure === "pack") return `${q} format(s)${i.size && i.unit ? ` de ${i.size} ${i.unit}` : " — taille inconnue"}`;
  if (i.measure === "uses") return `${q} ${i.countUnit || "utilisations"} — dose/format à confirmer`;
  return i.size === null || !i.unit ? `${q} — format à préciser` : i.unit === "each" && i.size === 1 ? `${q} ${i.countUnit || "unité(s)"}` : `${q} x ${i.size} ${i.unit}`;
}

/** Proposed even distribution only. No stock, shelf life, waste reduction or service slots inferred. */
export function deliveryScenarios(plan: GroceryPlan, now = new Date().toISOString().slice(0, 10)) {
  const weekly = plan.items.filter(i => i.active && i.cadence === "week" && (i.every ?? 1) === 1);
  return plan.retailers.filter(r => r.enabled !== false && r.mode === "delivery").map(r => {
    const basePlan = { ...plan, items: weekly, retailers: [r], prices: plan.prices.filter(p => p.retailerId === r.id) };
    const base = compareBaskets(basePlan, now).whole[0];
    const scenarios = [1, 2, 7].map(deliveries => {
      const divided = { ...basePlan, items: weekly.map(i => ({ ...i, basketQuantity: (i.basketQuantity !== undefined ? i.basketQuantity : i.quantity) === null ? null : (i.basketQuantity ?? i.quantity)! / deliveries })) };
      const part = compareBaskets(divided, now).whole[0];
      const knownProducts = part ? part.subtotal * deliveries : 0;
      const membership = part?.orders[0]?.membership;
      const estimate = part?.total !== null && part?.total !== undefined && membership !== null && membership !== undefined ? (part.total - membership) * deliveries + membership : null;
      const minimumProducts = r.minimum === null ? null : Math.round(r.minimum * 100) * deliveries;
      return { deliveries, coverage: part?.coverage ?? 0, count: weekly.length, knownProducts, minimumProducts, requiredExtra: minimumProducts === null ? null : Math.max(0, minimumProducts - knownProducts), extraPackCost: base ? Math.max(0, knownProducts - base.subtotal) : null, estimate, eligible: false as const, conditional: !part?.eligible, missing: part?.missing ?? ["Aucun besoin hebdomadaire chiffrable"], localTopup: deliveries === 1, localTopupTotal: null, wasteEstimate: null, slotsConfirmed: r.slots === "yes" };
    });
    return { retailerId: r.id, name: r.name, locality: r.locality || "Localité non confirmée", scenarios };
  });
}
