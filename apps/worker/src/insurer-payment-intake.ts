import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "./private-store.js";
import { calendarDate } from "./healthcare-evidence.js";
import { hasManualAuthority } from "./ingestion-policy.js";
import type { Invoice } from "./invoice-model.js";

/** Local operator opt-in. An absent policy preserves the original preview-only behavior. */
export async function automaticInsurerPaymentsEnabled(): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(dataDirectory, "insurer-collection-policy.json"), "utf8"));
    if (value.version !== 1 || typeof value.autoImportNewPayments !== "boolean") throw new Error();
    return value.autoImportNewPayments;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("Insurer collection policy is unreadable. Automatic payment intake was not started.");
  }
}

type Collection = { complete: boolean; warnings: string[] };
type Plan = { ambiguous: number; duplicates: number; items: Invoice[] };
/** Additive only: planners retain identity/deduplication authority; existing records are never replaced here. */
export function validatedNewInsurerPayments(existing: Invoice[], collection: Collection, plan: Plan): Invoice[] {
  if (!collection.complete || collection.warnings.length || plan.ambiguous || plan.duplicates) return [];
  const ids = new Set(existing.map(item => item.Id));
  return plan.items.filter(item => !ids.has(item.Id) && !hasManualAuthority(item) && !item.NeedsReview
    && item.DocumentRole === "insurer-statement" && ["blue-cross-portal", "desjardins-portal"].includes(item.StructuredSource || "")
    && ["Kevin", "Jasmine", "Nathan"].includes(item.Member) && !!item.ServiceDate && calendarDate(item.ServiceDate) === item.ServiceDate
    && !!item.ClaimedService?.trim() && item.PortalClaimStatus !== "pended"
    && typeof item.BilledAmount === "number" && Number.isFinite(item.BilledAmount) && item.BilledAmount > 0
    && typeof item.ReimbursedAmount === "number" && Number.isFinite(item.ReimbursedAmount) && item.ReimbursedAmount > 0
    && item.ReimbursedAmount <= item.BilledAmount);
}

export async function automaticInsurerCollectionRequested(apply: boolean, flag: unknown): Promise<boolean> {
  if (flag != null && typeof flag !== "boolean") throw new Error("Provide a boolean automatic payment flag.");
  return !apply && flag !== false && await automaticInsurerPaymentsEnabled();
}
