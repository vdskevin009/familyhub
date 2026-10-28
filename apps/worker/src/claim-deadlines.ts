import { readFile } from "node:fs/promises";
import type { ClaimDeadline } from "./household-alerts.js";
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const text = (s: unknown, max = 1000) => typeof s === "string" && !!s.trim() && s.length <= max;
/** Optional operator-reviewed evidence only. Never derive a deadline from an invoice/service date or generic policy guess. */
export async function readClaimDeadlines(path: string): Promise<ClaimDeadline[]> {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data?.schema !== 1 || !Array.isArray(data.records) || data.records.length > 500) throw new Error("Invalid claim deadline evidence");
    for (const r of data.records) if (!r || !text(r.expenseId, 200) || !["desjardins", "blue-cross"].includes(r.insurer) || !validDate(r.date) || !text(r.sourceDocumentId, 200) || !validDate(r.sourceDate) || r.sourceDate > r.date || !text(r.sourceNote) || !text(r.confirmedAt, 40) || !Number.isFinite(Date.parse(r.confirmedAt))) throw new Error("Invalid claim deadline evidence");
    if (new Set(data.records.map((r: ClaimDeadline) => r.expenseId + ":" + r.insurer)).size !== data.records.length) throw new Error("Conflicting claim deadlines");
    return data.records;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}

