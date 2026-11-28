import type { FinanceState } from './finance-model.js';
import type { ContributionsConfig } from './contributions-view.js';
import type { SourceExpensesState, SourceExpenseRow } from './finance-source-expenses-model.js';
export type InferencePolicy = {schema:1;rules:{planId:string;sourceAccountKey:string;canonicalAccountId:string;targetAccountId:string;reference:string;from:string;through:string;evidenceTransactionIds:string[]}[]};
export type InferredPayment = {id:string;sourceKey:string;date:string;amountCents:number;attribution:'inferred';rationale:string;evidenceTransactionIds:string[];collectedAt:string;bankReceiptConfirmed:false};
/** Exact reviewed destination token only; no merchant substring or learned/transitive rule. */
function reference(description:string):string|null {
 const parts=description.split(' TFR-TO ');
 return parts.length===2 && /^[A-Z0-9]{5}$/.test(parts[0]) && /^[A-Z0-9]{4,32}$/.test(parts[1]) ? parts[1] : null;
}
const day=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const exactObject=(x:unknown,keys:string[])=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const eligibleDecision=(s:FinanceState,id:string)=>!s.decisions[id]||['transfer','investment'].includes(s.decisions[id].nature);
export function inferredContributions(state:FinanceState,config:ContributionsConfig,source:SourceExpensesState,policy:unknown,today:string,bindings:{accounts:Record<string,string>;transactions:Record<string,string>}={accounts:{},transactions:{}}):Record<string,{inferredCents:number|null;inferredPayments:InferredPayment[];inferenceStatus:string}> {
 const empty=(status:string):Record<string,{inferredCents:number|null;inferredPayments:InferredPayment[];inferenceStatus:string}>=>Object.fromEntries(config.plans.map(p=>[p.id,{inferredCents:null,inferredPayments:[] as InferredPayment[],inferenceStatus:status}]));
 if(policy===null)return empty('not-configured');
 if(!source.snapshots.length)return empty('source-unavailable');
 const p=policy as InferencePolicy;
 if(!exactObject(p,['schema','rules'])||p.schema!==1||!Array.isArray(p.rules)||p.rules.length>20||!day(today)||!state.data)return empty('requires-review');
 const tx=state.data.transactions, accounts=state.data.accounts;
 const keys=new Set<string>();
 for(const r of p.rules){
  if(!exactObject(r,['planId','sourceAccountKey','canonicalAccountId','targetAccountId','reference','from','through','evidenceTransactionIds'])||['planId','sourceAccountKey','canonicalAccountId','targetAccountId','reference'].some(k=>typeof (r as any)[k]!=='string'||!(r as any)[k]))return empty('requires-review');
  const plan=config.plans.find(p=>p.id===r.planId), account=accounts.find(a=>a.id===r.canonicalAccountId);
  if(!r||!plan||!/^fsi_[a-f0-9]{64}$/.test(r.sourceAccountKey)||!account||account.currency!==plan.currency||!plan.debitAccounts.includes(r.canonicalAccountId)||plan.targetAccountId!==r.targetAccountId||!accounts.some(a=>a.id===r.targetAccountId&&a.currency===plan.currency)||!day(r.from)||!day(r.through)||r.from>r.through||!Array.isArray(r.evidenceTransactionIds)||r.evidenceTransactionIds.length<2||new Set(r.evidenceTransactionIds).size!==r.evidenceTransactionIds.length||keys.has(r.sourceAccountKey+'|'+r.reference))return empty('requires-review');
  if(bindings.accounts[r.sourceAccountKey]&&bindings.accounts[r.sourceAccountKey]!==r.canonicalAccountId)return empty('requires-review');
  keys.add(r.sourceAccountKey+'|'+r.reference);
  for(const id of r.evidenceTransactionIds){const t=tx.find(t=>t.id===id);if(!t||!(plan.verifiedTransferTransactionIds??[]).includes(id)||!plan.debitAccounts.includes(t.accountId)||t.currency!==plan.currency||t.status!=='posted'||t.date>=r.from||t.outflowCents<=0||t.duplicateCandidate||!t.sources.length||reference(t.description)!==r.reference||!eligibleDecision(state,id))return empty('requires-review');}
 }
 const result=empty('available');
 for(const r of p.rules)result[r.planId].inferredCents=0;
 // Stable source identity is the only replay key. Conflicting facts never choose a winner.
 const seen=new Map<string,{row:SourceExpenseRow;collectedAt:string}>(), conflicts=new Set<string>();
 for(const capture of source.snapshots)for(const row of capture.rows){const old=seen.get(row.sourceKey);if(old&&JSON.stringify(old.row)!==JSON.stringify(row))conflicts.add(row.sourceKey);else seen.set(row.sourceKey,{row,collectedAt:capture.collectedAt});}
 for(const r of p.rules){const plan=config.plans.find(p=>p.id===r.planId)!,out=result[r.planId];
  for(const {row,collectedAt} of seen.values()){
   if(row.accountSourceKey!==r.sourceAccountKey||reference(row.description)!==r.reference||row.date<r.from||row.date>r.through||row.date<plan.from||row.date>plan.through||row.date>today)continue;
   if(conflicts.has(row.sourceKey)){out.inferenceStatus='partial-conflict';continue;}
   if(row.pending||row.outflowCents<=0||row.currency!==plan.currency||row.linkedTransfer===true||!eligibleDecision(state,row.sourceKey))continue;
   // An existing canonical candidate is never merged by resemblance. Abstain instead,
   // including after a later canonical import, so no representation can be added twice.
   if(bindings.transactions[row.sourceKey]||tx.some(t=>t.accountId===r.canonicalAccountId&&t.date===row.date&&t.currency===row.currency&&t.outflowCents===row.outflowCents)){out.inferenceStatus='partial-canonical-overlap';continue;}
   out.inferredPayments.push({id:row.sourceKey,sourceKey:row.sourceKey,date:row.date,amountCents:row.outflowCents,attribution:'inferred',rationale:'The destination reference matches earlier transfers with confirmed allocation. Bank receipt has not been verified.',evidenceTransactionIds:[...r.evidenceTransactionIds],collectedAt,bankReceiptConfirmed:false});
  }
 }
 for(const out of Object.values(result)){out.inferredPayments.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));if(out.inferredCents!==null){out.inferredCents=out.inferredPayments.reduce((n,r)=>n+r.amountCents,0);if(!Number.isSafeInteger(out.inferredCents))return empty('requires-review');}}
 return result;
}
