/** Private contact evidence; records are immutable revisions, never inferred from public lenders. */
export type MortgageContact = {
  id: string; contactId: string; recordedAt: string; name: string; organization: string;
  status: "active" | "appointment" | "awaiting-response" | "email-sent" | "paused";
  source: string; notes: string[];
  appointment: { startsAt: string; endsAt: string | null; source: string } | null;
};
export type MortgageCashback = { amount: number; basis: "cashback" | "total-incentive"; conditions: string[] };
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 2000;
const timestamp = (v: unknown): v is string => text(v) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,19) === v.slice(0,19);
const invalid = (): never => { throw new Error("Invalid mortgage contact or offer metadata; existing evidence preserved"); };
export function validateContact(input: unknown): MortgageContact {
  const c = input as MortgageContact;
  if (!c || !text(c.id) || !text(c.contactId) || !timestamp(c.recordedAt) || !text(c.name) || !text(c.organization) || !text(c.source) || !["active", "appointment", "awaiting-response", "email-sent", "paused"].includes(c.status) || !Array.isArray(c.notes) || c.notes.length > 20 || !c.notes.every(text)) invalid();
  if (c.appointment !== null && (!c.appointment || !timestamp(c.appointment.startsAt) || !(c.appointment.endsAt === null || timestamp(c.appointment.endsAt) && Date.parse(c.appointment.endsAt) > Date.parse(c.appointment.startsAt)) || !text(c.appointment.source))) invalid();
  if (c.status === "appointment" && c.appointment === null) invalid();
  return JSON.parse(JSON.stringify(c));
}
export function validateCashback(input: unknown): MortgageCashback {
  const c = input as MortgageCashback;
  if (!c || !Number.isFinite(c.amount) || c.amount < 0 || c.amount > 1e6 || Math.abs(c.amount * 100 - Math.round(c.amount * 100)) > .0001 || !["cashback", "total-incentive"].includes(c.basis) || !Array.isArray(c.conditions) || !c.conditions.length || c.conditions.length > 20 || !c.conditions.every(text)) invalid();
  return JSON.parse(JSON.stringify(c));
}
export function currentContacts(records: MortgageContact[]): MortgageContact[] {
  const latest = new Map<string, MortgageContact>();
  for (const record of [...records].sort((a,b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))) latest.set(record.contactId, record);
  return [...latest.values()];
}
