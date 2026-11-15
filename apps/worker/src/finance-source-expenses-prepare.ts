import {createHash} from "node:crypto";
import {SourceExpensesError,validateSourceExpenses,type SourceExpenseRow} from "./finance-source-expenses-model.js";
import {sourceExpenseKey} from "./finance-source-expenses-store.js";
import type {FeedBatch} from "./finances-full-feed.js";
type Raw=Record<string,any>;
export type SourceExpensesEvidence={collectedAt:string;accounts:{item_id:string;account_id:string;name:string}[];transactions:FeedBatch};
const fail=():never=>{throw new SourceExpensesError("Preuve de dépenses source incomplète ou incohérente. Aucun import effectué.");};
const text=(v:unknown):string=>typeof v==="string"&&!!v.trim()?v:fail();
const cents=(v:unknown):number=>{if(typeof v!=="number"||!Number.isFinite(v))return fail();const n=Math.round(v*100);return Number.isSafeInteger(n)&&Math.abs(v*100-n)<0.000001?n:fail();};
/** Pure preparation only. Raw provider IDs are hashed here and never returned or persisted. */
export function prepareSourceExpenses(input:SourceExpensesEvidence,now=new Date()){
  const q=input.transactions?.query,pages=input.transactions?.pages;
  if(!q||Object.keys(q).some(k=>!["query_type","account_id","date","include_transfers","limit","order_by_field","order_by_direction","select_fields"].includes(k))||q.query_type!=="transactions"||q.include_transfers!==true||q.date?.op!=="between"||!Array.isArray(q.date.val)||q.date.val.length!==2||!Array.isArray(pages)||!pages.length||!Array.isArray(input.accounts)||!input.accounts.length)return fail();
  const selected=q.account_id;if(!selected||selected.op!=="in"||!Array.isArray(selected.val)||!selected.val.length||new Set(selected.val).size!==selected.val.length||selected.val.some((x:unknown)=>typeof x!=="string"))return fail();
  const accounts=input.accounts.map(a=>({sourceKey:sourceExpenseKey("account",text(a.item_id),text(a.account_id)),name:text(a.name)}));
  const rawAccounts=new Map(input.accounts.map((a,i)=>[JSON.stringify([a.item_id,a.account_id]),accounts[i].sourceKey]));
  if(rawAccounts.size!==accounts.length||new Set(input.accounts.map(a=>a.account_id)).size!==selected.val.length||input.accounts.some(a=>!selected.val.includes(a.account_id)))return fail();
  const rows:SourceExpenseRow[]=[],seen=new Map<string,string>(),cursors=new Set<string>(),warnings=new Set<string>(),asOf:unknown[]=[];let cursor:string|null=null,complete=true,hasMore:boolean|null=null;
  for(const [i,page] of pages.entries()){
    const r=page.result,c=r?.coverage;if(page.requestCursor!==cursor||!Array.isArray(r?.items)||typeof r.has_more!=="boolean")return fail();
    complete&&=c?.dataset==="transactions"&&c.availability==="ready"&&["complete","full_history"].includes(c.state)&&c.is_complete_for_query===true&&Array.isArray(c.warning_codes)&&!c.warning_codes.length;
    if(Array.isArray(c?.warning_codes))for(const warning of c.warning_codes)warnings.add(text(warning));asOf.push(c?.source_as_of??null);
    hasMore=r.has_more;if(hasMore){cursor=text(r.next_cursor);if(cursors.has(cursor))return fail();cursors.add(cursor);}else if(r.next_cursor!=null||i!==pages.length-1)return fail();
    for(const raw of r.items as Raw[]){
      const item=text(raw.item_id),account=text(raw.account_id),accountSourceKey=rawAccounts.get(JSON.stringify([item,account]));if(!accountSourceKey)return fail();
      const amount=cents(raw.amount);if(raw.normalized_amount!=null&&cents(raw.normalized_amount)!==-amount)return fail();
      const category=raw.personal_finance_category;
      if(category!=null&&(typeof category!=="object"||Array.isArray(category)))return fail();
      for(const field of ["transfer_to_account_id","transfer_transaction_id"]) if(raw[field]!=null && typeof raw[field]!=="string") return fail();
      const hasLink=typeof raw.transfer_to_account_id==="string"&&!!raw.transfer_to_account_id||typeof raw.transfer_transaction_id==="string"&&!!raw.transfer_transaction_id;
      const linkKnown=Object.hasOwn(raw,"transfer_to_account_id")&&Object.hasOwn(raw,"transfer_transaction_id");
      const row:SourceExpenseRow={sourceKey:sourceExpenseKey("transaction",item,text(raw.transaction_id),account),accountSourceKey,pendingSourceKey:raw.pending_transaction_id==null?null:sourceExpenseKey("transaction",item,text(raw.pending_transaction_id),account),date:raw.date,description:raw.merchant_name||raw.name,outflowCents:amount,currency:raw.iso_currency_code,pending:raw.pending,category:{primary:category?.primary??null,detailed:category?.detailed??null,confidence:category?.confidence_level??null},linkedTransfer:hasLink?true:linkKnown?false:null};
      const serialized=JSON.stringify(row),existing=seen.get(row.sourceKey);if(existing&&existing!==serialized)return fail();if(!existing){seen.set(row.sourceKey,serialized);rows.push(row);}if(rows.length>30000)return fail();
    }
  }
  complete&&=hasMore===false;
  const sourceAsOf=asOf.length&&asOf[0]!=null&&asOf.every(s=>s===asOf[0])?asOf[0]:null;
  return validateSourceExpenses({schemaVersion:1,source:"finances-plugin",collectedAt:input.collectedAt,evidenceSha256:createHash("sha256").update(JSON.stringify(input)).digest("hex"),accounts,query:{from:q.date.val[0],through:q.date.val[1],accountSourceKeys:accounts.map(a=>a.sourceKey),includeTransfers:true},coverage:{complete,hasMore,sourceAsOf,warningCodes:[...warnings]},rows},now);
}
