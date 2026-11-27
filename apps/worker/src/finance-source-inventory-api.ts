import { SOURCE_INVENTORY_CAPABILITY, SourceInventoryError, type SourceInventoryImportResult } from "./finance-source-inventory-model.js";
import type { FinanceSourceInventoryStore } from "./finance-source-inventory-store.js";

/** Used only behind the existing pairing/origin boundary. Preview never writes any file. */
export async function importFinanceSourceInventory(store: FinanceSourceInventoryStore, value: unknown, now = new Date()): Promise<SourceInventoryImportResult> {
  const body = value as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "apply,capability,expectedRevision,snapshot"
    || body.capability !== SOURCE_INVENTORY_CAPABILITY || typeof body.apply !== "boolean" || typeof body.expectedRevision !== "string"
    || !(body.expectedRevision === "empty" || /^[a-f0-9]{64}$/.test(body.expectedRevision))) throw new SourceInventoryError("Explicit capability, preview and revision are required for the source inventory.");
  const preview = await store.preview(body.snapshot, body.expectedRevision, now);
  const state = body.apply ? await store.save(preview.snapshot, body.expectedRevision, now) : null;
  if (state && state.revision !== preview.proposedRevision) throw new SourceInventoryError("The inventory save was not confirmed. Reload before trying again.");
  return { capability: SOURCE_INVENTORY_CAPABILITY, applied: body.apply, expectedRevision: body.expectedRevision, ...preview, state };
}
