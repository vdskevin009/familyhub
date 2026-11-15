/** Source-native snapshots only. No canonical account mapping or ledger mutation. */
export const SOURCE_EXPENSES_CAPABILITY = "finance-source-expenses-v1" as const;
export const SOURCE_EXPENSES_LIMITS = { rows: 30000, accounts: 100, bytes: 16_000_000, historyBytes: 64_000_000, captures: 200, clockSkewMs: 300_000 } as const;
export class SourceExpensesError extends Error {}
const fail = (): never => { throw new SourceExpensesError("Dépenses source invalides. Les données conservées restent inchangées."); };
export type SourceExpenseAccount = { sourceKey: string; name: string };
export type SourceExpenseRow = { sourceKey: string; accountSourceKey: string; pendingSourceKey: string | null; date: string; description: string; outflowCents: number; currency: string; pending: boolean; category: { primary: string | null; detailed: string | null; confidence: string | null }; linkedTransfer: boolean | null };
export type SourceExpensesSnapshot = { schemaVersion: 1; source: "finances-plugin"; collectedAt: string; evidenceSha256: string; accounts: SourceExpenseAccount[]; query: { from: string; through: string; accountSourceKeys: string[]; includeTransfers: true }; coverage: { complete: boolean; hasMore: boolean | null; sourceAsOf: string | null; warningCodes: string[] }; rows: SourceExpenseRow[] };
export type SourceExpensesState = { revision: string; snapshots: SourceExpensesSnapshot[] };
export type SourceExpensesImportResult = { capability: typeof SOURCE_EXPENSES_CAPABILITY; applied: boolean; alreadyImported: boolean; expectedRevision: string; proposedRevision: string; snapshot: SourceExpensesSnapshot; state: SourceExpensesState | null };
function obj(v: unknown, keys: string[]): Record<string, any> { if(!v || typeof v !== "object" || Array.isArray(v) || ![Object.prototype,null].includes(Object.getPrototypeOf(v)) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) return fail(); return v; }
const label = (v: unknown): string => typeof v === "string" && !!v.trim() && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) ? v : fail();
const key = (v: unknown): string => typeof v === "string" && /^fsi_[a-f0-9]{64}$/.test(v) ? v : fail();
export const sourceExpensesDigest = (v: unknown): string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : fail();
export function sourceExpensesDay(v: unknown): string { if(typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v) return fail(); return v; }
function stamp(v: unknown): string { if(typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== (v.length === 20 ? v.replace("Z", ".000Z") : v)) return fail(); return new Date(v).toISOString(); }
const nullable = (v: unknown) => v === null ? null : label(v);
export function validateSourceExpenses(value: unknown, now = new Date()): SourceExpensesSnapshot {
  const v=obj(value,["schemaVersion","source","collectedAt","evidenceSha256","accounts","query","coverage","rows"]);
  if(v.schemaVersion!==1 || v.source!=="finances-plugin" || !Number.isFinite(now.getTime())) return fail();
  const collectedAt=stamp(v.collectedAt); if(Date.parse(collectedAt)>now.getTime()+SOURCE_EXPENSES_LIMITS.clockSkewMs) return fail();
  if(!Array.isArray(v.accounts)||!v.accounts.length||v.accounts.length>SOURCE_EXPENSES_LIMITS.accounts||!Array.isArray(v.rows)||v.rows.length>SOURCE_EXPENSES_LIMITS.rows) return fail();
  const accounts=v.accounts.map((a: unknown)=>{const r=obj(a,["sourceKey","name"]);return {sourceKey:key(r.sourceKey),name:label(r.name)};}).sort((a:SourceExpenseAccount,b:SourceExpenseAccount)=>a.sourceKey.localeCompare(b.sourceKey));
  const keys=new Set<string>(accounts.map((a: SourceExpenseAccount)=>a.sourceKey)); if(keys.size!==accounts.length) return fail();
  const q=obj(v.query,["from","through","accountSourceKeys","includeTransfers"]), from=sourceExpensesDay(q.from), through=sourceExpensesDay(q.through);
  if(from>through||through>collectedAt.slice(0,10)||q.includeTransfers!==true||!Array.isArray(q.accountSourceKeys)) return fail();
  const accountSourceKeys=q.accountSourceKeys.map(key).sort(); if(accountSourceKeys.length!==keys.size||new Set(accountSourceKeys).size!==keys.size||accountSourceKeys.some((k:string)=>!keys.has(k))) return fail();
  const c=obj(v.coverage,["complete","hasMore","sourceAsOf","warningCodes"]);
  if(typeof c.complete!=="boolean" || (c.hasMore!==null&&typeof c.hasMore!=="boolean") || !Array.isArray(c.warningCodes)||c.warningCodes.length>100) return fail();
  if(c.sourceAsOf!==null && typeof c.sourceAsOf!=="string") return fail();
  const warningCodes=c.warningCodes.map(label), sourceAsOf=c.sourceAsOf===null?null:c.sourceAsOf.length===10?sourceExpensesDay(c.sourceAsOf):stamp(c.sourceAsOf);
  if(sourceAsOf && Date.parse(sourceAsOf)>Date.parse(collectedAt)+SOURCE_EXPENSES_LIMITS.clockSkewMs || c.complete && (c.hasMore!==false||warningCodes.length)) return fail();
  const rows: SourceExpenseRow[]=v.rows.map((r:unknown)=>{
    const x=obj(r,["sourceKey","accountSourceKey","pendingSourceKey","date","description","outflowCents","currency","pending","category","linkedTransfer"]), category=obj(x.category,["primary","detailed","confidence"]);
    const date=sourceExpensesDay(x.date), accountSourceKey=key(x.accountSourceKey);
    if(!keys.has(accountSourceKey)||date<from||date>through||!Number.isSafeInteger(x.outflowCents)||Math.abs(x.outflowCents)>1_000_000_000||typeof x.currency!=="string"||!/^[A-Z]{3}$/.test(x.currency)||typeof x.pending!=="boolean"||(x.linkedTransfer!==null&&typeof x.linkedTransfer!=="boolean")) return fail();
    return {sourceKey:key(x.sourceKey),accountSourceKey,pendingSourceKey:x.pendingSourceKey===null?null:key(x.pendingSourceKey),date,description:label(x.description),outflowCents:x.outflowCents,currency:x.currency,pending:x.pending,category:{primary:nullable(category.primary),detailed:nullable(category.detailed),confidence:nullable(category.confidence)},linkedTransfer:x.linkedTransfer};
  }).sort((a:SourceExpenseRow,b:SourceExpenseRow)=>a.sourceKey.localeCompare(b.sourceKey));
  if(new Set(rows.map(r=>r.sourceKey)).size!==rows.length) return fail();
  const rowByKey=new Map(rows.map(r=>[r.sourceKey,r]));
  for(const r of rows) if(r.pendingSourceKey && (r.pending || r.pendingSourceKey===r.sourceKey || rowByKey.has(r.pendingSourceKey) && (!rowByKey.get(r.pendingSourceKey)!.pending || rowByKey.get(r.pendingSourceKey)!.accountSourceKey!==r.accountSourceKey || rowByKey.get(r.pendingSourceKey)!.currency!==r.currency))) return fail();
  const result:SourceExpensesSnapshot={schemaVersion:1,source:"finances-plugin",collectedAt,evidenceSha256:sourceExpensesDigest(v.evidenceSha256),accounts,query:{from,through,accountSourceKeys,includeTransfers:true},coverage:{complete:c.complete,hasMore:c.hasMore,sourceAsOf,warningCodes},rows};
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>SOURCE_EXPENSES_LIMITS.bytes) return fail(); return result;
}
export function validateSourceExpensesState(value:unknown,now=new Date()):SourceExpensesState {
  const v=obj(value,["revision","snapshots"]); if(!Array.isArray(v.snapshots)||v.snapshots.length>SOURCE_EXPENSES_LIMITS.captures) return fail();
  const snapshots=v.snapshots.map((s:unknown)=>validateSourceExpenses(s,now));
  if(snapshots.some((s:SourceExpensesSnapshot,i:number)=>i>0&&s.collectedAt<=snapshots[i-1].collectedAt)) return fail();
  if(!snapshots.length ? v.revision!=="empty" : typeof v.revision!=="string" || !/^[a-f0-9]{64}$/.test(v.revision)) return fail();
  return {revision:v.revision,snapshots};
}
export type SourceExpenseClass = "expense" | "refund" | "transfer" | "card-payment" | "investment" | "income" | "ambiguous";
const expenseCategories = new Set(["entertainment","dining_drinks","groceries","shopping","gifts_donations","pets","transportation","family_kids","services","education","housing","health_wellness","bills_utilities","travel"]);
/** Stored source semantics only. Never inspect merchant wording, similar amounts or dates. */
export function classifySourceExpense(row:SourceExpenseRow):SourceExpenseClass {
  const p=row.category.primary?.toLowerCase(), d=row.category.detailed?.toLowerCase(), confidence=row.category.confidence?.toUpperCase();
  const reliable=["VERY_HIGH","HIGH","MEDIUM"].includes(confidence??"");
  if(!reliable) return row.linkedTransfer===true ? "transfer" : "ambiguous";
  if(d && ["transfers_credit_card_payment"].includes(d)) return "card-payment";
  if(d && ["transfers_investment_retirement_transfer_out"].includes(d)) return "investment";
  if(d === "financial_bnpl_payments") return "ambiguous";
  // An exact financial fee/tax/insurance detail is stronger than generic linkage; these are real expenses per provider contract.
  const financialExpense=p==="financial" && !!d && ["financial_taxes","financial_insurance","financial_other_bank_fees","financial_atm_fees","financial_government_fees","financial_government_civic","financial_accounting_financial_planning"].includes(d);
  if(financialExpense) return row.outflowCents<0 ? "refund" : "expense";
  // A generic purchase category contradicting explicit cross-account linkage is not sufficient evidence.
  if(p && expenseCategories.has(p)) return row.linkedTransfer===true ? "ambiguous" : row.outflowCents<0 ? "refund" : "expense";
  if(p==="transfers"||row.linkedTransfer===true) return "transfer";
  if(p==="income"&&row.outflowCents<0) return "income";
  return "ambiguous";
}
export function summarizeSourceExpenses(snapshot:SourceExpensesSnapshot,filter:{from:string;through:string;currency:string;accountSourceKey?:string}) {
  const postedLinks=new Set(snapshot.rows.filter(r=>!r.pending&&r.pendingSourceKey).map(r=>r.pendingSourceKey));
  const rows=snapshot.rows.filter(r=>r.date>=filter.from&&r.date<=filter.through&&r.currency===filter.currency&&(!filter.accountSourceKey||r.accountSourceKey===filter.accountSourceKey)&&!postedLinks.has(r.sourceKey));
  const classified=rows.map(row=>({row,kind:classifySourceExpense(row)})), posted=classified.filter(r=>!r.row.pending);
  const included=posted.filter(r=>r.kind==="expense"||r.kind==="refund");
  const grossCents=included.filter(r=>r.kind==="expense").reduce((s,r)=>s+r.row.outflowCents,0), refundCents=-included.filter(r=>r.kind==="refund").reduce((s,r)=>s+r.row.outflowCents,0);
  const complete=snapshot.coverage.complete&&filter.from>=snapshot.query.from&&filter.through<=snapshot.query.through;
  return {rows:classified,grossCents,refundCents,netCents:grossCents-refundCents,complete,hasIncluded:included.length>0,ambiguousCount:posted.filter(r=>r.kind==="ambiguous").length,pendingCount:classified.filter(r=>r.row.pending).length,excludedCount:posted.filter(r=>!["expense","refund","ambiguous"].includes(r.kind)).length};
}
