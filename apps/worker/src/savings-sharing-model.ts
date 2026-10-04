import { categories, newContract, type SavingsContract } from "./savings-model.js";

export type SharedContract = { contract: SavingsContract; revision: string };
export type SharedDocument = { id: string; type: string; data: string };
export type SharedLibrary = { records: SharedContract[]; conflicts?: string[] };
const mimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
const idPattern = /^[a-zA-Z0-9:_-]{1,100}$/;
export const documentIdPattern = /^[a-f0-9-]{36}$/;
function invalid(): never { throw new Error("Invalid Savings contract or document. No shared records were replaced."); }

/** Canonical whitelist: unknown values remain null; unrelated fields never enter the shared library. */
export function validateContract(value: unknown): SavingsContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !idPattern.test(input.id) || typeof input.category !== "string" || !Object.hasOwn(categories, input.category)) return invalid();
  const result = newContract(input.category as SavingsContract["category"], input.id);
  for (const key of ["name", "provider", "province", "renewal", "commitmentEnd", "needs", "discounts", "notes", "updatedAt"] as const) {
    if (typeof input[key] !== "string" || input[key].length > (key === "needs" || key === "discounts" || key === "notes" ? 3000 : 300)) return invalid();
    result[key] = input[key];
  }
  if (!result.name.trim() || !Number.isFinite(Date.parse(result.updatedAt))) return invalid();
  for (const key of ["renewal", "commitmentEnd"] as const) if (result[key] && !/^\d{4}-\d{2}-\d{2}$/.test(result[key])) return invalid();
  for (const key of ["price", "cancellationFee", "annualLostDiscounts", "priceAfterPromo", "liabilityLimit", "collisionDeductible", "comprehensiveDeductible", "dataGb", "downloadMbps", "mortgageBalance", "mortgageRate", "amortizationYears", "termMonths"] as const) {
    const number = input[key];
    if (number !== null && (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1e9)) return invalid();
    result[key] = number as number | null;
  }
  for (const key of ["currentPromoMonths", "lines"] as const) {
    const number = input[key];
    if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > 120 || (key === "lines" && number < 1)) return invalid();
    result[key] = number;
  }
  if (!["monthly", "annual", "weekly"].includes(String(input.cycle)) || !["fixed", "variable"].includes(String(input.rateType)) || (input.taxesIncluded !== null && typeof input.taxesIncluded !== "boolean")) return invalid();
  result.cycle = input.cycle as SavingsContract["cycle"]; result.rateType = input.rateType as SavingsContract["rateType"]; result.taxesIncluded = input.taxesIncluded as boolean | null;
  if (input.sourceSubscriptionId !== undefined) {
    if (typeof input.sourceSubscriptionId !== "string" || !idPattern.test(input.sourceSubscriptionId)) return invalid();
    result.sourceSubscriptionId = input.sourceSubscriptionId;
  }
  if (!Array.isArray(input.documents) || input.documents.length > 20) return invalid();
  const ids = new Set<string>();
  result.documents = input.documents.map(document => {
    if (!document || typeof document !== "object" || typeof document.id !== "string" || !documentIdPattern.test(document.id) || ids.has(document.id) || typeof document.name !== "string" || document.name.length > 255 || !mimeTypes.has(document.type) || !Number.isInteger(document.size) || document.size < 1 || document.size > 5 * 1024 * 1024 || typeof document.addedAt !== "string" || !Number.isFinite(Date.parse(document.addedAt))) return invalid();
    ids.add(document.id);
    return { id: document.id, name: document.name, type: document.type, size: document.size, addedAt: document.addedAt };
  });
  return result;
}
export function contractSignature(contract: SavingsContract): string { return JSON.stringify(validateContract(contract)); }

export function mergeSharedContracts(local: SavingsContract[], records: SharedContract[], known: Record<string, string>) {
  const contracts = [...local], signatures = { ...known }, conflicts: string[] = [];
  for (const record of records) {
    const contract = validateContract(record.contract), signature = contractSignature(contract);
    const index = contracts.findIndex(item => item.id === contract.id);
    if (index < 0) contracts.push(contract);
    else if (contractSignature(contracts[index]) === signature || contractSignature(contracts[index]) === known[contract.id]) contracts[index] = contract;
    else { conflicts.push(contract.id); continue; }
    signatures[contract.id] = signature;
  }
  return { contracts, signatures, conflicts };
}
