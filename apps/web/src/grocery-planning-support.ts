import { groceryExpandedListCapability, legacyGroceryItemLimit, type GroceryPlan } from "../../worker/src/grocery-planning";

/** Check before POST; an older PC must never receive an unsupported full-plan replacement. */
export function assertGrocerySaveSupported(plan: GroceryPlan, capabilities: string[] | undefined) {
  if (!capabilities?.includes("grocery-weekly-v1")) throw new Error("Mettez à jour le worker pour les listes Courses. Votre brouillon reste sur cet appareil.");
  if (plan.items.length > legacyGroceryItemLimit && !capabilities.includes(groceryExpandedListCapability)) throw new Error(`Mettez à jour le worker PC pour enregistrer plus de ${legacyGroceryItemLimit} articles. Votre brouillon complet reste sur cet appareil.`);
}
