import { SOURCE_EXPENSES_CAPABILITY, SourceExpensesError, type SourceExpensesImportResult } from "./finance-source-expenses-model.js";
import type { FinanceSourceExpensesStore } from "./finance-source-expenses-store.js";

/** Used only behind the existing pairing/origin boundary. Preview never writes any file. */
export async function importFinanceSourceExpenses(store: FinanceSourceExpensesStore, value: unknown, now = new Date()): Promise<SourceExpensesImportResult> {
  const body = value as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "apply,capability,expectedRevision,snapshot"
    || body.capability !== SOURCE_EXPENSES_CAPABILITY || typeof body.apply !== "boolean" || typeof body.expectedRevision !== "string"
    || !(body.expectedRevision === "empty" || /^[a-f0-9]{64}$/.test(body.expectedRevision))) throw new SourceExpensesError("Capacité, aperçu et révision explicites requis pour les dépenses source.");
  const preview = await store.preview(body.snapshot, body.expectedRevision, now);
  const state = body.apply ? await store.save(preview.snapshot, body.expectedRevision, now) : null;
  if (state && state.revision !== preview.proposedRevision) throw new SourceExpensesError("Enregistrement des dépenses source non confirmé. Relisez avant de réessayer.");
  return { capability: SOURCE_EXPENSES_CAPABILITY, applied: body.apply, expectedRevision: body.expectedRevision, ...preview, state };
}
