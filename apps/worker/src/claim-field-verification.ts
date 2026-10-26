export type ApprovedField = { key: string; label: string; kind: string | null; type: string; value: string; optionLabel?: string; format?: "decimal-comma" };
export type ObservedField = { value: string; signatureMatches: boolean; selectedLabel?: string };
export type CheckedField = ApprovedField & { actual: string | null; status: "match" | "mismatch" | "unreadable" | "not-filled" };
function amount(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const n = Number(value); return Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) : null;
}
export function checkedField(approved: ApprovedField, observed: ObservedField | null, filled: boolean): CheckedField {
  if (!filled) return { ...approved, actual: observed?.value ?? null, status: "not-filled" };
  if (!observed || !observed.signatureMatches) return { ...approved, actual: null, status: "unreadable" };
  const monetary = ["originalAmount", "otherInsurancePaid"].includes(approved.kind || "");
  const decimal = (s:string) => approved.format === "decimal-comma" && /^\d+(?:,\d{1,2})?$/.test(s) ? s.replace(",", ".") : s;
  const equal = monetary ? amount(decimal(approved.value)) != null && amount(decimal(approved.value)) === amount(decimal(observed.value)) : approved.value === observed.value;
  const selectedEqual = !["select", "provider", "radio"].includes(approved.type) || !!approved.optionLabel && approved.optionLabel === observed.selectedLabel;
  return { ...approved, actual: observed.value, status: equal && selectedEqual ? "match" : "mismatch" };
}
export function uploadEvidence(name: string, statuses: string[], alerts: string[]): "verified" | "unverified" | "failed" {
  if (alerts.some(text => text.includes(name) && /fail|error|reject|unable/i.test(text))) return "failed";
  const matches = statuses.filter(text => text.includes(name) && /uploaded successfully|successfully uploaded|upload complete/i.test(text));
  return matches.length === 1 ? "verified" : "unverified";
}
