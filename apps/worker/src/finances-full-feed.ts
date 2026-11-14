import { createHash } from 'node:crypto';
import type { FinanceState } from './finance-model.js';
import { parseFinancePreparation } from './finance-import.js';
import { prepareFinancesPluginImport, pluginAccountKey, type PluginImportPlan, type PluginPage } from './finances-plugin-import.js';
type Obj = Record<string, any>;
type Dataset = 'transactions' | 'investment_holdings' | 'investment_transactions';
export type FeedBatch = { query: Obj; pages: PluginPage[] };
export type FinanceFeedEvidence = { linkedAccounts: Obj; transactions: FeedBatch; holdings: FeedBatch; activity: FeedBatch };
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail = (): never => { throw new Error('Finances feed evidence requires review.'); };
const text = (v: unknown): string => typeof v === 'string' && !!v.trim() ? v : fail();
const cents = (v: unknown): number => {
  if(typeof v !== 'number' || !Number.isFinite(v)) return fail();
  const n=Math.round(v*100); return Number.isSafeInteger(n) && Math.abs(v*100-n)<0.000001 ? n : fail();
};
const date = (v: unknown): string => {
  if(typeof v!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v+'T12:00:00Z')) || new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v) return fail();
  return v;
};
function sourceTimestamp(value: unknown): string {
  const valueText=text(value); date(valueText.slice(0,10));
  if(valueText.length!==10 && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(valueText)) return fail();
  if(!Number.isFinite(Date.parse(valueText))) return fail();
  return valueText;
}
const canonical = (v: any): string => JSON.stringify(v && typeof v==='object' ? Array.isArray(v) ? v.map(x=>JSON.parse(canonical(x))) : Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])) : v);
export function financeFeedQueries(plan: Pick<PluginImportPlan,'accounts'|'from'|'through'>): Record<Dataset,Obj> {
  const ids=[...new Set(Object.keys(plan.accounts).map(k=>text(JSON.parse(k)[1])))].sort();
  if(!ids.length || date(plan.from)>date(plan.through)) return fail();
  const base={account_id:{op:'in',val:ids},limit:400};
  const range={op:'between',val:[plan.from,plan.through]};
  return {
    transactions:{...base,query_type:'transactions',date:range,include_transfers:true,order_by_field:'date',order_by_direction:'asc'},
    investment_holdings:{...base,query_type:'investment_holdings'},
    investment_transactions:{...base,query_type:'investment_transactions',date:range,order_by_field:'date',order_by_direction:'asc'}
  };
}
function readBatch(batch: FeedBatch, expected: Obj, kind: Dataset) {
  if(canonical(batch.query)!==canonical(expected) || !batch.pages.length) return fail();
  let cursor:string|null=null; const cursors=new Set<string>(); const rows:Obj[]=[];
  let complete=true; const coverage:Obj[]=[];
  for(const [i,p] of batch.pages.entries()) {
    const r=p.result;
    if(p.requestCursor!==cursor || !Array.isArray(r?.items) || typeof r.has_more!=='boolean') return fail();
    rows.push(...r.items); if(rows.length>30000) return fail();
    const c=r.coverage;
    complete &&= c?.dataset===kind && c.availability==='ready' && ['complete','full_history'].includes(c.state) && c.is_complete_for_query===true && Array.isArray(c.warning_codes) && c.warning_codes.length===0;
    coverage.push(c ?? {dataset:kind,availability:'unknown',freshness:'unknown',is_complete_for_query:false});
    if(r.has_more) { cursor=text(r.next_cursor); if(cursors.has(cursor)||i===batch.pages.length-1) return fail(); cursors.add(cursor); }
    else if(r.next_cursor!=null || i!==batch.pages.length-1) return fail();
  }
  return {rows,complete,coverage};
}
/** Pure private preparation. No provider writes, inference of identity, or scheduling.
 * Pass the resulting bundle through FinanceLibrary preview/apply, never write its ledger directly.
 */
export function prepareFinanceFeed(evidence: FinanceFeedEvidence, plan: PluginImportPlan, state: FinanceState) {
  if(!state.data || plan.excludedTransactionKeys?.length) return fail();
  sourceTimestamp(plan.retrievedAt);
  const queries=financeFeedQueries(plan);
  const tx=readBatch(evidence.transactions,queries.transactions,'transactions');
  const holdings=readBatch(evidence.holdings,queries.investment_holdings,'investment_holdings');
  const activity=readBatch(evidence.activity,queries.investment_transactions,'investment_transactions');
  const sourceAccounts:Obj[]=(evidence.linkedAccounts.institutions ?? []).flatMap((i:Obj)=>i.accounts ?? []).concat(evidence.linkedAccounts.manual_accounts ?? []);
  if(new Set(sourceAccounts.map(a=>pluginAccountKey(a.item_id,a.account_id))).size!==sourceAccounts.length) return fail();
  if(new Set(Object.values(plan.accounts)).size!==Object.values(plan.accounts).length) return fail();
  const mapped=(r:Obj) => {
    const id=plan.accounts[pluginAccountKey(text(r.item_id),text(r.account_id))];
    if(!id || !sourceAccounts.some(a=>a.item_id===r.item_id && a.account_id===r.account_id)) return fail();
    const account=state.data!.accounts.find(a=>a.id===id);
    if(!account || r.iso_currency_code!==account.currency) return fail();
    return account;
  };
  for(const key of Object.keys(plan.accounts)) {
    const [item,account]=JSON.parse(key);
    if(!sourceAccounts.some(a=>a.item_id===item&&a.account_id===account)) return fail();
  }
  const prepared=prepareFinancesPluginImport(evidence.transactions.pages,plan,state);
  const bundle:Obj=prepared.bundle;
  const rawHash=digest(evidence), source={file:'finances-full-feed-evidence.json',sha256:rawHash};
  const withheld:string[]=[];
  for(const a of bundle.accounts) {
    const keys=Object.keys(plan.accounts).filter(k=>plan.accounts[k]===a.accountId);
    const [item,id]=JSON.parse(keys[0]);
    const r=sourceAccounts.find(r=>r.item_id===item&&r.account_id===id)!;
    if(r.balances?.iso_currency_code!==a.currency) return fail();
    const b=r.balances;
    // Source report times only. Record-update timestamps never date a balance.
    const rawDate=b.balance_date ?? (b.last_updated_datetime_source==='source_reported' ? b.last_updated_datetime : null);
    const asOf=rawDate==null?null:sourceTimestamp(rawDate);
    if(asOf && Date.parse(asOf)===Date.parse(a.observedOn) && b.current!=null && a.observedBalanceCents!==cents(b.current)) return fail();
    if(asOf && Number.isFinite(Date.parse(asOf)) && Date.parse(asOf)<=Date.parse(plan.retrievedAt) && (!Number.isFinite(Date.parse(a.observedOn)) || Date.parse(asOf)>=Date.parse(a.observedOn)) && b.current!=null) {
      a.observedOn=asOf; a.observedBalanceCents=cents(b.current); a.identityEvidence=source;
    } else withheld.push('Balance source date unavailable; retained prior dated account observation.');
  }
  const seen=new Set<string>();
  for(const r of activity.rows) {
    const a=mapped(r), key=digest(['investment',r.item_id,r.account_id,text(r.investment_transaction_id)]);
    if(seen.has(key)) return fail(); seen.add(key);
    const settled=date(r.date);
    if(settled<plan.from||settled>plan.through) return fail();
    // The plugin provides settlement and order-initiation, not execution date.
    // Do not promote either to the legacy ledger's required trade date or invent
    // legacy action codes. Preserve original/cancel pairs together in raw evidence.
    cents(r.amount);
    if(r.transaction_datetime) sourceTimestamp(r.transaction_datetime);
    withheld.push('Investment execution date and supported action semantics unavailable; retained prior activity. Cancellation reconciliation requires review.');
  }

  const groups=new Map<string,Obj[]>();
  for(const r of holdings.rows) { const a=mapped(r); const key=pluginAccountKey(r.item_id,r.account_id)+':'+text(r.security_id); if(seen.has(key)) return fail(); seen.add(key); groups.set(a.id,[...(groups.get(a.id)??[]),r]); }
  for(const [accountId,rows] of groups) {
    // A price date cannot establish when the position quantity was observed.
    const stamps=holdings.coverage.map(c=>c.source_as_of);
    const asOf=stamps[0]==null?null:sourceTimestamp(stamps[0]);
    if(!holdings.complete || !asOf || !Number.isFinite(Date.parse(asOf)) || Date.parse(asOf)>Date.parse(plan.retrievedAt) || stamps.some(s=>s!==asOf) || rows.some(r=>typeof r.is_cash_equivalent!=='boolean')) {
      withheld.push('Holdings lack a complete source-dated position snapshot; retained historical holdings.'); continue;
    }
    const cash=rows.filter(r=>r.is_cash_equivalent), positions=rows.filter(r=>!r.is_cash_equivalent);
    bundle.holdingsSnapshots.push({accountId,bankAsOf:asOf,currency:rows[0].iso_currency_code,cashCents:cash.reduce((s,r)=>s+cents(r.institution_value),0),totalValueCents:rows.reduce((s,r)=>s+cents(r.institution_value),0),positions:positions.map(r=>({Symbol:r.ticker_symbol??'',Description:text(r.name),Quantity:r.quantity==null?'':String(r.quantity),Price:r.institution_price==null?'':String(r.institution_price),'Market Value':(cents(r.institution_value)/100).toFixed(2),'Book Cost':r.cost_basis==null?'':(cents(r.cost_basis)/100).toFixed(2)})),source});
  }
  const limits=[...new Set([...bundle.limits,...withheld,
    ...(!holdings.complete?['Investment holdings coverage unavailable; empty result is not zero holdings.']:[]),
    ...(!activity.complete?['Investment activity coverage unavailable; empty result is not zero activity.']:[])])];
  bundle.limits=limits;
  bundle.pluginFeedEvidence={schema:'familyhub.finances-full-feed.v1',retrievedAt:plan.retrievedAt,rawSha256:rawHash,evidence,coverage:{transactions:tx.coverage,holdings:holdings.coverage,activity:activity.coverage},withheld};
  parseFinancePreparation(bundle);
  return {bundle,postedCount:prepared.postedCount,pendingCount:prepared.pendingCount,withheld,coverage:bundle.pluginFeedEvidence.coverage};
}



/** Opt-in orchestration using the existing paired API. Never retries an uncertain write. */
export async function syncFinanceFeed(input: {
  evidence: FinanceFeedEvidence; mapping: PluginImportPlan;
  transport: import('./contribution-sync.js').FinanceTransport;
}) {
  const before=await input.transport.read();
  if(input.mapping.expectedRevision!==before.revision) throw new Error("Ledger changed since mapping; review before proceeding.");
  const prepared=prepareFinanceFeed(input.evidence,input.mapping,before);
  const hash=digest(prepared.bundle), preview=await input.transport.preview(prepared.bundle);
  if((!preview.alreadyImported && preview.possibleDuplicates!==0) || (!preview.alreadyImported && preview.revision!==before.revision)) return fail();
  let uncertain=false;
  if(!preview.alreadyImported) {
    try { await input.transport.apply(prepared.bundle,before.revision); } catch { uncertain=true; }
  }
  const after=await input.transport.read();
  if(!after.imports.some(i=>i.hash===hash)) throw new Error(uncertain?'Finance feed outcome unconfirmed; no automatic replay.':'Finance feed import readback missing.');
  if(!after.data) return fail();
  // Import never authorizes edits or removal of earlier facts, including investment history.
  if(canonical(before.decisions)!==canonical(after.decisions) || canonical(before.decisionHistory)!==canonical(after.decisionHistory)) return fail();
  for(const kind of ['transactions','activities'] as const) {
    for(const old of before.data![kind]) {
      const saved=after.data[kind].find(r=>r.id===old.id);
      if(!saved) return fail();
      // Additional source provenance is allowed; original facts are not replaced.
      const {sources:_old,...oldFacts}=old, {sources:_saved,...savedFacts}=saved;
      if(canonical(oldFacts)!==canonical(savedFacts)) return fail();
    }
  }
  for(const kind of ['holdings','performance','gics','feeReports'] as const)
    for(const old of before.data![kind]) if(!after.data[kind].some(r=>canonical(r)===canonical(old))) return fail();
  const incoming=parseFinancePreparation(prepared.bundle);
  for(const row of incoming.transactions) {
    const saved=after.data.transactions.find(r=>r.id===row.id);
    if(!saved || saved.accountId!==row.accountId || saved.date!==row.date || saved.outflowCents!==row.outflowCents || saved.description!==row.description) return fail();
  }
  for(const row of incoming.activities) {
    const saved=after.data.activities.find(r=>r.id===row.id);
    if(!saved || saved.accountId!==row.accountId || saved.date!==row.date || saved.netCashCents!==row.netCashCents) return fail();
  }
  for(const row of incoming.holdings) if(!after.data.holdings.some(r=>canonical(r)===canonical(row))) return fail();
  return {importConfirmed:true,recoveredUncertainApply:uncertain,hash,withheld:prepared.withheld,coverage:prepared.coverage};
}
