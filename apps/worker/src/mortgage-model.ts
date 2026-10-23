import { validateContact, validateCashback, type MortgageContact, type MortgageCashback } from "./mortgage-contacts.js";
/** Public observations and private indicative quotes are deliberately different records. */
export const mortgageBaseline = "2026-10-20";
export const mortgageZone = "America/Vancouver";
export const productKeys = ["fixed-3", "fixed-5", "variable-3", "variable-5"] as const;
export type ProductKey = typeof productKeys[number];
export type Filters = { purpose: "renewing"; balance: number; amortizationMonths: number; location: "Vancouver BC"; occupancy: "owner"; payment: "monthly"; cmhc: "no"; ltv: "unavailable" };
export type Observation = { product: ProductKey; status: "observed" | "unavailable"; rate: number | null; lender: string | null; reason: string | null; eligibility: string[] };
export type Snapshot = { schema: 1; id: string; collectedAt: string; localDate: string; source: { url: string; title: string; method: string; publishedAt: string | null; controlsVerified: boolean }; filters: Filters; status: "complete" | "partial" | "failed"; observations: Observation[]; error: string | null };
export type Quote = { id: string; receivedDate: string; source: string; lender: string; product: ProductKey; variant: "fixed" | "adjustable-payment" | "fixed-payment" | "unconfirmed-payment"; rate: number; limitations: string[]; contactId?: string; cashback?: MortgageCashback | null; status?: "indicative" | "historical"; supersedes?: string | null };
export type MortgageAssumptions = { id: string; recordedAt: string; principal: number; currentRate: number; remainingMonths: number; source: string; principalBasis: "assumption"; amortizationBasis: "assumption"; currentRateBasis: "user-reported"; currentMaturity: null };
export type MortgageState = { schema: 1; baselineDate: typeof mortgageBaseline; baselineSnapshotId: string | null; snapshots: Snapshot[]; quotes: Quote[]; assumptions: MortgageAssumptions[]; contacts?: MortgageContact[]; offers?: Quote[] };
export const emptyMortgage = (): MortgageState => ({ schema: 1, baselineDate: mortgageBaseline, baselineSnapshotId: null, snapshots: [], quotes: [], assumptions: [], contacts: [], offers: [] });
export function localDate(at: string | Date): string {
  const d = new Date(at); if (!Number.isFinite(d.getTime())) throw new Error("Invalid timestamp");
  return new Intl.DateTimeFormat("en-CA", { timeZone: mortgageZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function date(v: unknown): v is string { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "T12:00:00Z")) && new Date(v + "T12:00:00Z").toISOString().slice(0,10) === v; }
function text(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= 2000; }
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every(text); }
function rate(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 30; }
function fail(): never { throw new Error("Invalid mortgage evidence; no records changed"); }
export function validateSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  if (!s || s.schema !== 1 || !text(s.id) || !date(s.localDate) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s.collectedAt) || localDate(s.collectedAt) !== s.localDate) fail();
  if (!s.source || !text(s.source.title) || !text(s.source.method) || !/^https:\/\/(www\.)?ratehub\.ca\//.test(s.source.url) || typeof s.source.controlsVerified !== "boolean" || !(s.source.publishedAt === null || text(s.source.publishedAt))) fail();
  const f = s.filters;
  if (!f || f.purpose !== "renewing" || !Number.isFinite(f.balance) || f.balance <= 0 || !Number.isInteger(f.amortizationMonths) || f.amortizationMonths < 1 || f.location !== "Vancouver BC" || f.occupancy !== "owner" || f.payment !== "monthly" || f.cmhc !== "no" || f.ltv !== "unavailable") fail();
  if (!Array.isArray(s.observations) || s.observations.length !== 4 || new Set(s.observations.map(o => o.product)).size !== 4) fail();
  for (const o of s.observations) {
    if (!productKeys.includes(o.product) || !strings(o.eligibility)) fail();
    if (o.status === "observed") { if (!rate(o.rate) || !text(o.lender) || o.reason !== null) fail(); }
    else if (o.status !== "unavailable" || o.rate !== null || o.lender !== null || !text(o.reason)) fail();
  }
  const n = s.observations.filter(o => o.status === "observed").length;
  if (n > 0 && !s.source.controlsVerified) fail();
  if (s.status !== (n === 4 ? "complete" : n === 0 ? "failed" : "partial") || (n === 0 ? !text(s.error) : s.error !== null)) fail();
  return JSON.parse(JSON.stringify(s));
}
export function validateQuote(value: unknown): Quote {
  const q = value as Quote;
  if (!q || !text(q.id) || !date(q.receivedDate) || !text(q.source) || !text(q.lender) || !productKeys.includes(q.product) || !rate(q.rate) || !strings(q.limitations)) fail();
  if (q.product.startsWith("fixed") ? q.variant !== "fixed" : !["adjustable-payment", "fixed-payment", "unconfirmed-payment"].includes(q.variant)) fail();
  if (q.contactId !== undefined && !text(q.contactId) || q.status !== undefined && !["indicative", "historical"].includes(q.status) || q.supersedes !== undefined && q.supersedes !== null && (!text(q.supersedes) || q.supersedes === q.id)) fail();
  if (q.cashback !== undefined && q.cashback !== null) validateCashback(q.cashback);
  return JSON.parse(JSON.stringify(q));
}
export function validateAssumptions(value: unknown): MortgageAssumptions {
  const a = value as MortgageAssumptions;
  if(!a || !text(a.id) || !text(a.source) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(a.recordedAt) || !Number.isFinite(Date.parse(a.recordedAt)) || !Number.isFinite(a.principal) || a.principal <= 0 || !rate(a.currentRate) || !Number.isInteger(a.remainingMonths) || a.remainingMonths < 60 || a.remainingMonths > 480 || a.principalBasis !== "assumption" || a.amortizationBasis !== "assumption" || a.currentRateBasis !== "user-reported" || a.currentMaturity !== null) fail();
  return JSON.parse(JSON.stringify(a));
}
export function currentAssumptions(state: MortgageState): MortgageAssumptions | undefined { return [...state.assumptions].sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt) || b.id.localeCompare(a.id))[0]; }
export function validateState(value: unknown): MortgageState {
  const s = value as MortgageState;
  if (!s || s.schema !== 1 || s.baselineDate !== mortgageBaseline || !Array.isArray(s.snapshots) || !Array.isArray(s.quotes)) fail();
  s.snapshots.forEach(validateSnapshot); s.quotes.forEach(validateQuote);
  if(s.offers === undefined) s.offers=[];
  if(!Array.isArray(s.offers)) fail();
  s.offers.forEach(validateQuote);
  const allOffers=[...s.quotes,...s.offers];
  if(new Set(allOffers.map(q=>q.id)).size !== allOffers.length) fail();
  if(s.contacts === undefined) s.contacts=[];
  if(!Array.isArray(s.contacts)) fail();
  s.contacts.forEach(validateContact);
  if(new Set(s.contacts.map(c=>c.id)).size !== s.contacts.length) fail();
  for(const q of allOffers){ if(q.contactId && !s.contacts.some(c=>c.contactId === q.contactId)) fail(); if(q.supersedes && !allOffers.some(old=>old.id === q.supersedes && old.product === q.product && old.variant === q.variant && old.lender === q.lender)) fail(); const seen=new Set<string>();let cursor:Quote|undefined=q;while(cursor){if(seen.has(cursor.id)) fail();seen.add(cursor.id);cursor=allOffers.find(other=>other.id === cursor!.supersedes);} }
  if(s.assumptions === undefined) s.assumptions=[];
  if(!Array.isArray(s.assumptions)) fail();
  s.assumptions.forEach(validateAssumptions);
  if(new Set(s.assumptions.map(a=>a.id)).size !== s.assumptions.length) fail();
  if (new Set(s.snapshots.map(s => s.id)).size !== s.snapshots.length || new Set(s.quotes.map(q => q.id)).size !== s.quotes.length) fail();
  if (s.baselineSnapshotId !== null && !s.snapshots.some(x=>x.id === s.baselineSnapshotId && x.localDate === mortgageBaseline && x.status === "complete")) fail();
  return s;
}
export function referenceDates(today: string): { label: string; date: string }[] {
  if (!date(today)) fail();
  const days = (n: number) => new Date(Date.parse(today + "T12:00:00Z") - n * 86400000).toISOString().slice(0,10);
  const months = (n: number) => { const d = new Date(today + "T12:00:00Z"), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()-n); const end = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate(); d.setUTCDate(Math.min(day,end)); return d.toISOString().slice(0,10); };
  return [{label:"Référence",date:mortgageBaseline},{label:"7 jours",date:days(7)},{label:"2 semaines",date:days(14)},{label:"1 mois",date:months(1)},{label:"3 mois",date:months(3)},{label:"6 mois",date:months(6)}];
}
export function snapshotOn(state: MortgageState, day: string): Snapshot | undefined { return state.snapshots.filter(s => s.localDate === day).sort((a,b) => Date.parse(b.collectedAt)-Date.parse(a.collectedAt) || b.id.localeCompare(a.id))[0]; }
export function baselineSnapshot(state: MortgageState): Snapshot | undefined { return state.snapshots.find(s=>s.id === state.baselineSnapshotId); }
export function observationOn(state: MortgageState, day: string, product: ProductKey) { return snapshotOn(state,day)?.observations.find(o => o.product === product); }
function sameFilters(a: Filters, b: Filters): boolean { return (["purpose","balance","amortizationMonths","location","occupancy","payment","cmhc","ltv"] as const).every(key=>a[key]===b[key]); }
export function change(state: MortgageState, today: string, reference: string, product: ProductKey): number | null {
  const a = snapshotOn(state,today), b = reference === mortgageBaseline ? baselineSnapshot(state) : snapshotOn(state,reference);
  if (!a || !b || !sameFilters(a.filters,b.filters)) return null;
  const x = a.observations.find(o=>o.product===product), y = b.observations.find(o=>o.product===product);
  return x?.status === "observed" && y?.status === "observed" ? Math.round((x.rate!-y.rate!)*10000)/10000 : null;
}
/** Constant-rate illustration: nominal Canadian fixed rate compounded semi-annually; variable convention must be explicit. */
export function mortgageScenario(principal: number, annualRate: number, months: number, horizon: number, compounding: "semiannual" | "monthly" = "semiannual") {
  if (!Number.isFinite(principal) || principal <= 0 || !rate(annualRate) || !Number.isInteger(months) || months < 1 || !Number.isInteger(horizon) || horizon < 1 || horizon > months) fail();
  const r = compounding === "semiannual" ? Math.expm1(Math.log1p(annualRate/200)/6) : annualRate/1200;
  const payment = r === 0 ? principal/months : principal*r/-Math.expm1(-months*Math.log1p(r));
  let balance = principal, interest = 0;
  for(let i=0;i<horizon;i++) { const charge=balance*r; interest+=charge; balance=Math.max(0,balance+charge-payment); }
  return { payment, interest, balance };
}
export function negotiatedEstimate(state: MortgageState, today: string, quote: Quote) {
  const b = baselineSnapshot(state), c = snapshotOn(state,today);
  const baseline = b?.observations.find(o=>o.product===quote.product), current = observationOn(state,today,quote.product);
  if (baseline?.status !== "observed" || current?.status !== "observed" || !b || !c || !sameFilters(b.filters,c.filters)) return null;
  const spread = quote.rate-baseline.rate!, estimate=current.rate!+spread;
  return estimate >= 0 && estimate <= 30 ? { spread, rate: estimate } : null;
}
