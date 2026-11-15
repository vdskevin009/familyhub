import { SOURCE_INVENTORY_LIMITS, SourceInventoryError, validateFinanceSourceInventory, type FinanceSourceInventory } from "./finance-source-inventory-model.js";

/** Pure admission step over already-minimized evidence. Exclusions must come from an existing
 * attested private crosswalk, never account names, institution names, amounts or ordering.
 * No mapping is created or persisted; raw provider IDs must already have been hashed.
 */
export function prepareUnmappedFinanceSourceInventory(value: unknown, options: { attestedMappedSourceKeys: readonly string[]; expectedUnmappedAccountCount: number }, now = new Date()): FinanceSourceInventory {
  if (!options || !Array.isArray(options.attestedMappedSourceKeys) || options.attestedMappedSourceKeys.length > SOURCE_INVENTORY_LIMITS.accounts
    || options.attestedMappedSourceKeys.some(key => typeof key !== "string" || !/^fsi_[a-f0-9]{64}$/.test(key))
    || new Set(options.attestedMappedSourceKeys).size !== options.attestedMappedSourceKeys.length
    || !Number.isSafeInteger(options.expectedUnmappedAccountCount) || options.expectedUnmappedAccountCount < 0 || options.expectedUnmappedAccountCount > SOURCE_INVENTORY_LIMITS.accounts) throw new SourceInventoryError("Périmètre de comptes attesté requis. Aucun rapprochement déduit.");
  const snapshot = validateFinanceSourceInventory(value, now), excluded = new Set(options.attestedMappedSourceKeys);
  const actualKeys = new Set(snapshot.accounts.map(account => account.sourceKey));
  if ([...excluded].some(key => !actualKeys.has(key))) throw new SourceInventoryError("Un compte attesté manque à la collecte. Revérifiez le périmètre avant import.");
  snapshot.accounts = snapshot.accounts.filter(account => !excluded.has(account.sourceKey));
  if (snapshot.accounts.length !== options.expectedUnmappedAccountCount) throw new SourceInventoryError("Le nombre de comptes non rapprochés diffère du périmètre vérifié. Aucun import effectué.");
  snapshot.predictions = snapshot.predictions.map(prediction => prediction.accountSourceKey !== null && excluded.has(prediction.accountSourceKey) ? { ...prediction, accountSourceKey: null } : prediction);
  const scope = snapshot.availability.accounts;
  snapshot.availability.accounts = { ...scope, ...(excluded.size && scope.coverage === "complete" ? { status: "partial" as const, coverage: "partial" as const } : {}), observedCount: snapshot.accounts.length };
  return validateFinanceSourceInventory(snapshot, now);
}
