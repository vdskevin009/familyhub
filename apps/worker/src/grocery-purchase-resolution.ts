import { GroceryError, type GroceryRecord, type GroceryUnit } from "./grocery-model.js";
import { purchaseLineKey } from "./grocery-purchase-evidence.js";
import { normalizedSize, publicSourceUrl } from "./grocery-planning.js";
import { validatePurchaseScenarios, validateScenarioHints, validateReferenceLeads, type PurchaseScenario, type PurchaseScenarioHint, type PurchaseReferenceLead } from "./grocery-purchase-scenario-model.js";

/** Public catalogue evidence is a proposal, never evidence of the historical purchase. */
export type PurchaseCandidate = {
  id: string; recordId: string; lineIndex: number; lineKey: string;
  product: string; brand: string; productId: string; itemId: string | null;
  size: number | null; unit: GroceryUnit | null; formatLabel: string;
  formatBasis: "public-source" | "household-assumption";
  sourceUrl: string; observedAt: string; note: string;
  reusedFrom?: string;
};
export type PurchaseResolution = {
  schema: 1; revision: string; candidates: PurchaseCandidate[];
  decisions: Record<string, { state: "confirmed" | "unconfirmed"; at: string; evidence?: { at: string; source: string } }>;
  scenarioHints?: PurchaseScenarioHint[];
  scenarios?: PurchaseScenario[];
  referenceLeads?: PurchaseReferenceLead[];
};
export const emptyPurchaseResolution = (): PurchaseResolution => ({ schema: 1, revision: "empty", candidates: [], decisions: {} });
const stamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const identifier = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
export function validatePurchaseCandidate(value: unknown): PurchaseCandidate {
  if (!value || typeof value !== "object") throw new GroceryError("Candidat de comparaison invalide.");
  const v = value as Record<string, unknown>;
  const text = (key: string, limit: number, blank = false) => { const s = v[key]; if (typeof s !== "string" || s.length > limit || !blank && !s.trim()) throw new GroceryError("Source du candidat incomplète."); return s.trim(); };
  if (!identifier(v.id) || !identifier(v.recordId) || !identifier(v.productId) || v.itemId !== null && !identifier(v.itemId) || v.reusedFrom !== undefined && !identifier(v.reusedFrom)
    || !Number.isInteger(v.lineIndex) || Number(v.lineIndex) < 0 || Number(v.lineIndex) > 199 || !stamp(v.observedAt)) throw new GroceryError("Identité du candidat invalide.");
  if (!["public-source", "household-assumption"].includes(String(v.formatBasis)) || !(v.size === null && v.unit === null) && !(typeof v.size === "number" && Number.isFinite(v.size) && v.size > 0 && v.size <= 100000 && ["g", "kg", "ml", "l", "each"].includes(String(v.unit)))) throw new GroceryError("Format candidat invalide.");
  const sourceUrl = publicSourceUrl(text("sourceUrl", 2000));
  if (!sourceUrl || !sourceUrl.startsWith("https://")) throw new GroceryError("Une source publique HTTPS est requise.");
  return { id: v.id, recordId: v.recordId, lineIndex: Number(v.lineIndex), lineKey: text("lineKey", 6000), product: text("product", 200), brand: text("brand", 100, true), productId: v.productId, itemId: v.itemId as string | null,
    size: v.size as number | null, unit: v.unit as GroceryUnit | null, formatLabel: text("formatLabel", 150), formatBasis: v.formatBasis as PurchaseCandidate["formatBasis"], sourceUrl, observedAt: v.observedAt, note: text("note", 1000), ...(v.reusedFrom ? { reusedFrom: v.reusedFrom as string } : {}) };
}
export function validatePurchaseResolution(value: unknown): PurchaseResolution {
  const v = value as PurchaseResolution;
  if (!v || v.schema !== 1 || typeof v.revision !== "string" || !v.revision || v.revision.length > 80 || !Array.isArray(v.candidates) || v.candidates.length > 500 || !v.decisions || typeof v.decisions !== "object" || Array.isArray(v.decisions) || Object.keys(v.decisions).length > 500) throw new GroceryError("Les confirmations de comparaison sont illisibles. Le fichier est conservé.");
  const candidates = v.candidates.map(validatePurchaseCandidate);
  if (new Set(candidates.map(c => c.id)).size !== candidates.length) throw new GroceryError("Candidat dupliqué.");
  for (const [id, d] of Object.entries(v.decisions)) if (!candidates.some(c => c.id === id) || !d || !["confirmed", "unconfirmed"].includes(d.state) || !stamp(d.at)
    || d.evidence !== undefined && (!stamp(d.evidence.at) || typeof d.evidence.source !== "string" || !d.evidence.source.trim() || d.evidence.source.length > 1000)) throw new GroceryError("Décision de comparaison invalide.");
  return { schema: 1, revision: v.revision, candidates, decisions: { ...v.decisions }, ...(v.scenarioHints === undefined ? {} : { scenarioHints: validateScenarioHints(v.scenarioHints) }), ...(v.scenarios === undefined ? {} : { scenarios: validatePurchaseScenarios(v.scenarios) }), ...(v.referenceLeads === undefined ? {} : { referenceLeads: validateReferenceLeads(v.referenceLeads) }) };
}
export function purchaseCandidateReason(candidate: PurchaseCandidate, record: GroceryRecord, now = Date.now()) {
  const line = record.receipt.items[candidate.lineIndex];
  if (record.id !== candidate.recordId || record.status !== "saved" || record.duplicateOf || !line || candidate.lineKey !== purchaseLineKey(line)) return "La ligne source a changé : candidat à revoir.";
  if (line.productReference && (line.productReference.provider !== "pcexpress" || line.productReference.id !== candidate.productId)) return "La référence produit source diffère du candidat.";
  if (Date.parse(candidate.observedAt) > now) return "La date de la source est future : candidat à revoir.";
  if (line.size !== null && line.unit && candidate.size !== null && candidate.unit) {
    const a = normalizedSize(line.size, line.unit), b = normalizedSize(candidate.size, candidate.unit);
    if (a.unit !== b.unit || Math.abs(a.size - b.size) > 1e-9 * Math.max(1, a.size, b.size)) return "Le format candidat contredit le format source.";
  }
  return "";
}
export function purchaseCandidatesForLine(state: PurchaseResolution | undefined, record: GroceryRecord, index: number) {
  return state?.candidates.filter(c => c.recordId === record.id && c.lineIndex === index) ?? [];
}
export function confirmedPurchaseFormat(state: PurchaseResolution | undefined, record: GroceryRecord, index: number) {
  const rows = purchaseCandidatesForLine(state, record, index).filter(c => state?.decisions[c.id]?.state === "confirmed" && !purchaseCandidateReason(c, record) && c.size !== null && c.unit !== null);
  return rows.length === 1 ? rows[0] : null;
}
