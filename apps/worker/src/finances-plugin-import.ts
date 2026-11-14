import { createHash } from 'node:crypto';
import type { FinanceState, FinanceTransaction } from './finance-model.js';
import { parseFinancePreparation } from './finance-import.js';
type Obj = Record<string, any>;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const pluginAccountKey = (item: string, account: string) => JSON.stringify([item, account]);
export const pluginTransactionKey = (row: Obj) => hash(['finances', row.item_id, row.account_id, row.transaction_id]);
export type PluginImportPlan = {
  expectedRevision: string; from: string; through: string; retrievedAt: string;
  accounts: Record<string, string>;
  excludedTransactionKeys?: string[];
  resolutions: Record<string, {kind: 'existing'; ledgerId: string} | {kind: 'new'}>;
};
export type PluginPage = {requestCursor: string | null; result: Obj};
const fail = () => { throw new Error('Finances evidence or private mapping requires review.'); };
function day(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + 'T12:00:00Z')) || new Date(v+'T12:00:00Z').toISOString().slice(0,10) !== v) return fail();
  return v;
}
function required(v: unknown): string { if(typeof v !== 'string' || !v.trim()) return fail(); return v; }
function cents(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail();
  const n = Math.round(v*100);
  if(!Number.isSafeInteger(n) || Math.abs(v*100-n)>0.000001) return fail();
  return n;
}
/** Pure adapter. Raw evidence stays in the private preparation archive. Never writes or collects. */
export function prepareFinancesPluginImport(pages: PluginPage[], plan: PluginImportPlan, state: FinanceState) {
  if(!state.data || state.revision !== plan.expectedRevision || !pages.length) return fail();
  const from=day(plan.from), through=day(plan.through);
  if(from>through || !Number.isFinite(Date.parse(plan.retrievedAt))) return fail();
  const collectedOn=day(plan.retrievedAt.slice(0,10));
  if(through>collectedOn) return fail();
  const rows: Obj[]=[]; const cursors=new Set<string>(); let cursor: string|null=null;
  for(let i=0;i<pages.length;i++) {
    const page=pages[i], r=page.result, c=r?.coverage;
    if(page.requestCursor!==cursor || !Array.isArray(r?.items) || r.items.length>30000 || c?.dataset!=='transactions' || c?.availability!=='ready' || c?.is_complete_for_query!==true || c?.state!=='full_history' || !Array.isArray(c.warning_codes) || c.warning_codes.length) return fail();
    rows.push(...r.items);
    if(rows.length>30000 || typeof r.has_more!=='boolean') return fail();
    if(r.has_more) { cursor=required(r.next_cursor); if(cursors.has(cursor)||i===pages.length-1) return fail(); cursors.add(cursor); }
    else { if(r.next_cursor!=null || i!==pages.length-1) return fail(); cursor=null; }
  }
  const rawHash=hash(pages), seen=new Set<string>(), usedLedgerIds=new Set<string>();
  const pending: Obj[]=[]; const unassigned: Obj[]=[]; const bankActivities: Obj[]=[];
  const ledgerById=new Map(state.data.transactions.map(r=>[r.id,r]));
  for(let index=0; index<rows.length; index++) {
    const r=rows[index]; required(r.item_id); required(r.account_id); required(r.transaction_id);
    const key=pluginTransactionKey(r); if(seen.has(key)) return fail(); seen.add(key);
    const accountId=plan.accounts[pluginAccountKey(r.item_id,r.account_id)];
    const account=state.data.accounts.find(a=>a.id===accountId); if(!account) return fail();
    const date=day(r.date), amount=cents(r.amount);
    if(date<from||date>through||r.iso_currency_code!==account.currency||typeof r.pending!=='boolean') return fail();
    if(r.normalized_amount!=null && cents(r.normalized_amount)!==-amount) return fail();
    if(r.pending) { pending.push(r); continue; }
    if((plan.excludedTransactionKeys ?? []).includes(key)) { unassigned.push(r); continue; }
    const description=required(r.merchant_name || r.name), resolution=plan.resolutions[key];
    if(!resolution) return fail();
    let old: FinanceTransaction|undefined;
    if(resolution.kind==='existing') {
      old=ledgerById.get(resolution.ledgerId);
      if(!old||usedLedgerIds.has(old.id)||old.accountId!==accountId||old.date!==date||old.currency!==r.iso_currency_code||old.outflowCents!==amount||old.status!=='posted') return fail();
      usedLedgerIds.add(old.id);
    } else if(resolution.kind==='new') {
      old=ledgerById.get('finances:'+key);
      if(old) {
        if(old.accountId!==accountId||old.date!==date||old.currency!==r.iso_currency_code||old.outflowCents!==amount||old.description!==description||old.status!=='posted'||usedLedgerIds.has(old.id)) return fail();
        usedLedgerIds.add(old.id);
      } else {
        // Without a reviewed existing binding, same account/date/amount is ambiguous across providers.
        if(state.data.transactions.some(t=>t.accountId===accountId&&t.date===date&&t.currency===r.iso_currency_code&&t.outflowCents===amount)) return fail();
      }
    } else return fail();
    bankActivities.push({id:old?.id ?? 'finances:'+key, accountId, transactionDate:date,
      descriptionOriginal:old?.description ?? description, currency:r.iso_currency_code,
      debitCents:Math.max(0,amount),creditCents:Math.max(0,-amount),signedOutflowCents:amount,status:'posted',
      occurrence:old?.occurrence ?? 1, matchingFingerprint:old?.fingerprint ?? key, reviewHints:old?.hints ?? [],
      source:{file:'finances-plugin-evidence.json',sha256:rawHash,record:index+1}});
  }
  const ids=new Set(Object.values(plan.accounts));
  const accounts=state.data.accounts.filter(a=>ids.has(a.id)).map(a=>({accountId:a.id,identityFingerprint:a.identity,alias:a.name,type:a.type,currency:a.currency,observedBalanceCents:a.balanceCents,observedOn:a.asOf,identityEvidence:a.source.detail ?? {file:a.source.name,...(a.source.sha256?{sha256:a.source.sha256}:{}),...(a.source.record!=null?{record:a.source.record}:{}),...(a.source.page!=null?{page:a.source.page}:{})}}));
  if(accounts.length!==ids.size) return fail();
  const {expectedRevision: _revisionGuard, ...privateMapping} = plan;
  const bundle={schema:'familyhub.td.preparation.v1',collectedOn,scope:{from,to:through},accounts,bankActivities,brokerageActivities:[],holdingsSnapshots:[],pendingActivities:pending,
    coverage:accounts.map(a=>({accountId:a.accountId,earliest:from,latest:through,coverageWarning:'Filtered-query evidence only; complete account/contribution history and source freshness are not established.'})),
    limits:['Filtered selection is not certified exhaustive account or contribution history.','Finances plugin source-as-of unavailable; retrieval time is not source freshness.','Observed transfers do not certify contribution room, deductibility or destination receipt.'],
    pluginEvidence:{schema:'familyhub.finances-plugin-evidence.v1',retrievedAt:plan.retrievedAt,sourceAsOf:null,sourceFreshness:'unknown',rawSha256:rawHash,pages,plan:privateMapping}};
  parseFinancePreparation(bundle);
  return {bundle,postedCount:bankActivities.length,pendingCount:pending.length,unassigned};
}