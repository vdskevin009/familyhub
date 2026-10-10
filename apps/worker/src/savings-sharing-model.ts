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
  if (input.promotionEnd !== undefined) {
    const end = input.promotionEnd as Record<string, unknown>;
    if (!end || typeof end.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(end.date) || !Number.isFinite(Date.parse(end.date)) || new Date(end.date).toISOString().slice(0, 10) !== end.date || typeof end.source !== "string" || !end.source.trim() || end.source.length > 2000) return invalid();
    result.promotionEnd = { date: end.date, source: end.source.trim() };
  }
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
  if (input.billing !== undefined) {
    const b = input.billing as Record<string, unknown>;
    if (!b || (b.amount !== null && (typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount < 0 || b.amount > 1e9)) || typeof b.currency !== "string" || !/^[A-Z]{3}$/.test(b.currency) || !["days","weeks","months","years"].includes(String(b.unit)) || typeof b.count !== "number" || !Number.isFinite(b.count) || b.count <= 0 || b.count > 10000 || typeof b.asOf !== "string" || (b.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(b.asOf)) || typeof b.source !== "string" || b.source.length > 3000) return invalid();
    result.billing = { amount: b.amount as number | null, currency: b.currency, unit: b.unit as NonNullable<SavingsContract["billing"]>["unit"], count: b.count, asOf: b.asOf, source: b.source };
    if (b.taxesIncluded !== undefined) {
      if (b.taxesIncluded !== null && typeof b.taxesIncluded !== "boolean") return invalid();
      result.billing.taxesIncluded = b.taxesIncluded as boolean | null;
    }
  }
  if (input.services !== undefined) {
    if (!Array.isArray(input.services) || input.services.length > 30) return invalid();
    const ids = new Set<string>();
    result.services = input.services.map(s => {
      if (!s || typeof s.id !== "string" || !idPattern.test(s.id) || ids.has(s.id) || typeof s.name !== "string" || !s.name.trim() || s.name.length > 150 || !["shared","included","documented"].includes(s.pricing) || (s.monthlyAmount !== null && (typeof s.monthlyAmount !== "number" || !Number.isFinite(s.monthlyAmount) || s.monthlyAmount < 0 || s.monthlyAmount > 1e9)) || (s.pricing !== "documented" && s.monthlyAmount !== null) || (s.taxesIncluded !== null && typeof s.taxesIncluded !== "boolean") || typeof s.source !== "string" || s.source.length > 2000 || (s.pricing === "documented" && !s.source.trim())) return invalid();
      ids.add(s.id); return { id:s.id,name:s.name,pricing:s.pricing,monthlyAmount:s.monthlyAmount,taxesIncluded:s.taxesIncluded,source:s.source };
    });
  }
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
