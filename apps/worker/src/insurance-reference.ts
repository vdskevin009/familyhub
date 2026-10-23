/** Private insurance evidence attached to existing Savings contracts, never a public research input. */
export type InsuranceSource = { id: string; kind: "gmail" | "library" | "document" | "user" | "public"; reference: string; title: string; date: string | null; scope: "original" | "capture" | "historical" | "payment" | "statement" | "quote" | "advertisement"; verification: "parent-verified" | "locally-read" | "unverified" };
export type InsuranceFact = { code: string; label: string; value: string | number | boolean | null; unit: string | null; certainty: "documented" | "reported" | "unknown" | "conflict"; sourceIds: string[]; notes: string };
export type InsuranceRecord = { id: string; kind: "policy" | "strata-certificate" | "membership" | "quote-request" | "quote"; title: string; provider: string; status: "documented" | "historical" | "unknown" | "preparing" | "sent" | "awaiting_quote" | "received" | "expired"; effectiveFrom: string | null; effectiveTo: string | null; requestedOn: string | null; receivedOn: string | null; validUntil: string | null; quotedAnnualPremium: number | null; comparison: "unassessed" | "partial" | "reviewed-comparable"; assumptions: string[]; differences: string[]; limitations: string[]; sourceIds: string[]; facts: InsuranceFact[]; supersedes: string | null };
export type InsuranceReference = { schema: 1; updatedAt: string; sources: InsuranceSource[]; records: InsuranceRecord[] };
const invalid = (): never => { throw new Error("Invalid private insurance reference; existing evidence preserved."); };
const object = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? invalid() : v as Record<string, unknown>;
const text = (v: unknown, max = 1000) => typeof v !== "string" || !v.trim() || v.length > max ? invalid() : v.trim();
const id = (v: unknown) => { const s = text(v, 100); return /^[a-zA-Z0-9_.:-]+$/.test(s) ? s : invalid(); };
const choice = <T extends string>(v: unknown, choices: readonly T[]): T => choices.includes(v as T) ? v as T : invalid();
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid();
const strings = (v: unknown) => list(v, 30).map(s => text(s, 1000));
const date = (v: unknown) => { if (v === null) return null; const s = text(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : invalid(); };
const money = (v: unknown) => v === null ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9 && Math.abs(v * 100 - Math.round(v * 100)) < .0001 ? v : invalid();
export function validateInsuranceReference(value: unknown): InsuranceReference {
  const v = object(value), updatedAt = text(v.updatedAt, 40);
  if (v.schema !== 1 || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) invalid();
  const sources = list(v.sources, 60).map(raw => { const s = object(raw); return { id: id(s.id), kind: choice(s.kind, ["gmail", "library", "document", "user", "public"] as const), reference: text(s.reference, 2000), title: text(s.title, 500), date: date(s.date), scope: choice(s.scope, ["original", "capture", "historical", "payment", "statement", "quote", "advertisement"] as const), verification: choice(s.verification, ["parent-verified", "locally-read", "unverified"] as const) }; });
  if (new Set(sources.map(s => s.id)).size !== sources.length) invalid();
  const sourceIds = (raw: unknown) => { const ids = list(raw, 60).map(id); if (!ids.length || new Set(ids).size !== ids.length || ids.some(i => !sources.some(s => s.id === i))) invalid(); return ids; };
  const records = list(v.records, 40).map(raw => {
    const r = object(raw), facts = list(r.facts, 150).map(raw => {
      const f = object(raw), certainty = choice(f.certainty, ["documented", "reported", "unknown", "conflict"] as const), value = f.value;
      if (!(value === null || typeof value === "boolean" || typeof value === "string" && value.length <= 2000 || typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12) || certainty === "unknown" && value !== null || typeof f.notes !== "string" || f.notes.length > 2000) invalid();
      return { code: id(f.code), label: text(f.label, 200), value: value as InsuranceFact["value"], unit: f.unit === null ? null : text(f.unit, 60), certainty, sourceIds: sourceIds(f.sourceIds), notes: f.notes as string };
    });
    if (new Set(facts.map(f => f.code)).size !== facts.length) invalid();
    const record: InsuranceRecord = { id: id(r.id), kind: choice(r.kind, ["policy", "strata-certificate", "membership", "quote-request", "quote"] as const), title: text(r.title, 300), provider: text(r.provider, 200), status: choice(r.status, ["documented", "historical", "unknown", "preparing", "sent", "awaiting_quote", "received", "expired"] as const), effectiveFrom: date(r.effectiveFrom), effectiveTo: date(r.effectiveTo), requestedOn: date(r.requestedOn), receivedOn: date(r.receivedOn), validUntil: date(r.validUntil), quotedAnnualPremium: money(r.quotedAnnualPremium), comparison: choice(r.comparison, ["unassessed", "partial", "reviewed-comparable"] as const), assumptions: strings(r.assumptions), differences: strings(r.differences), limitations: strings(r.limitations), sourceIds: sourceIds(r.sourceIds), facts, supersedes: r.supersedes === null ? null : id(r.supersedes) };
    if (record.effectiveFrom && record.effectiveTo && record.effectiveTo < record.effectiveFrom || record.receivedOn && record.validUntil && record.validUntil < record.receivedOn) invalid();
    if (record.kind === "quote-request" && (!["preparing", "sent", "awaiting_quote"].includes(record.status) || record.receivedOn !== null || record.validUntil !== null || record.quotedAnnualPremium !== null || record.status === "preparing" && record.requestedOn !== null || ["sent", "awaiting_quote"].includes(record.status) && record.requestedOn === null)) invalid();
    if (record.kind === "quote" && (!["received", "expired"].includes(record.status) || !record.receivedOn || !record.sourceIds.some(i => sources.some(s => s.id === i && s.scope === "quote" && s.kind !== "public" && s.verification !== "unverified")))) invalid();
    if (!["quote", "quote-request"].includes(record.kind) && (["preparing", "sent", "awaiting_quote", "received"].includes(record.status) || record.quotedAnnualPremium !== null)) invalid();
    if (record.comparison === "reviewed-comparable" && (record.kind !== "quote" || record.status !== "received" || record.quotedAnnualPremium === null || record.validUntil === null || record.differences.length || facts.some(f => f.value === null || f.certainty === "unknown" || f.certainty === "conflict"))) invalid();
    return record;
  });
  if (new Set(records.map(r => r.id)).size !== records.length || records.some(r => r.supersedes && (r.supersedes === r.id || !records.some(old => old.id === r.supersedes && old.kind === r.kind && old.provider === r.provider)))) invalid();
  for (const r of records) { const seen = new Set<string>(); let current: InsuranceRecord | undefined = r; while (current) { if (seen.has(current.id)) invalid(); seen.add(current.id); current = records.find(other => other.id === current!.supersedes); } }
  return { schema: 1, updatedAt, sources, records };
}
/** Evidence is append-only; older clients cannot erase it by omitting the optional field. */
export function preserveInsuranceReference(previous: InsuranceReference | undefined, incoming: InsuranceReference | undefined): InsuranceReference | undefined {
  if (!previous) return incoming;
  if (!incoming) return previous;
  for (const key of ["sources", "records"] as const) for (const old of previous[key]) {
    const next = incoming[key].find(item => item.id === old.id);
    if (!next || JSON.stringify(next) !== JSON.stringify(old)) throw new Error("Preserve insurance evidence history; add a separately identified correction instead.");
  }
  return incoming;
}
export function insuranceExport(contract: { id: string; category: string; insuranceReference?: InsuranceReference }, at = new Date().toISOString()) {
  if (!contract.insuranceReference) invalid();
  return { schema: 1, kind: "private-insurance-reference", exportedAt: at, contractId: contract.id, category: contract.category, reference: validateInsuranceReference(contract.insuranceReference) };
}
