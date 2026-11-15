import {financeSourceKey} from './finance-source-inventory-store.js';
import {prepareFinanceAccountCapture} from './finance-account-captures-prepare.js';
import type {FinanceSourceInventory,SourceAccount} from './finance-source-inventory-model.js';
import type {FinanceAccountCaptureSnapshot} from './finance-account-captures-model.js';
export type CloudAccountCapturePreparation={schema:1;accountScope:'returned-institution-accounts';returnedManualAccountCount:number|null;snapshot:FinanceAccountCaptureSnapshot;verificationLimits:string[]};
const fail=():never=>{throw Error('Complete institutional account capture evidence required.');};
/** Pure preparation from this one original linked response. No baseline credit, mapping or global provider assumptions. */
export function prepareCloudAccountCapture(linked:any,sourceSha256:string,now=new Date()):CloudAccountCapturePreparation {
 const body=linked?.rawLinkedAccounts?.structuredContent;
 if(linked?.rawLinkedAccounts?.isError===true||!Array.isArray(body?.institutions)||!body.institutions.length)return fail();
 const returnedManualAccountCount=Object.hasOwn(body,'manual_accounts')?(Array.isArray(body.manual_accounts)?body.manual_accounts.length:fail()):null;
 if(returnedManualAccountCount!==null&&returnedManualAccountCount!==0)return fail();
 const accounts:SourceAccount[]=[],providerBySourceKey:Record<string,'plaid'|'unknown'>={};
 for(const institution of body.institutions){
  const c=institution.account_coverage;
  if(c?.dataset!=='accounts'||c.availability!=='ready'||!['complete','full_history'].includes(c.state)||c.is_complete_for_query!==true||!Array.isArray(c.warning_codes)||c.warning_codes.length||!Array.isArray(institution.accounts))return fail();
  for(const raw of institution.accounts){
   const sourceKey=financeSourceKey('account',raw.item_id,raw.account_id);
   if(Object.hasOwn(providerBySourceKey,sourceKey))return fail();
   // Only this exact per-account provider field may authorize known sign semantics.
   providerBySourceKey[sourceKey]=raw.provider==='plaid'?'plaid':'unknown';
   const kind:SourceAccount['kind']=['depository','investment','credit','loan','other'].includes(raw.type)?raw.type:'unknown';
   if(raw.balances?.balance_date!=null||(raw.balances?.last_updated_datetime!=null&&(raw.balances.last_updated_datetime_source==='source_reported'||raw.balances.source==='source_reported')))return fail();
   let balance:SourceAccount['balance']=null;
   if(raw.balances?.current!=null){const v=raw.balances.current,cents=Math.round(v*100);if(typeof v!=='number'||!Number.isFinite(v)||!Number.isSafeInteger(cents)||Math.abs(v*100-cents)>0.000001||typeof raw.balances.iso_currency_code!=='string'||!/^[A-Z]{3}$/.test(raw.balances.iso_currency_code))return fail();balance={amountCents:cents,currency:raw.balances.iso_currency_code,sourceAsOf:null};}
   accounts.push({sourceKey,name:raw.name,institution:typeof institution.institution?.name==='string'?institution.institution.name:null,kind,reconciliation:'not-reconciled',balance,credit:null});
  }
 }
 const unavailable={status:'unavailable' as const,coverage:'unknown' as const,observedCount:0};
 const source:FinanceSourceInventory={schemaVersion:1,source:'finances-plugin',collectedAt:linked.collectedAt,accounts,predictions:[],availability:{accounts:{status:'available',coverage:'complete',observedCount:accounts.length},holdings:unavailable,activity:unavailable,recurring:unavailable,liabilities:unavailable,budgets:'not-provided',goals:'not-provided'}};
 const snapshot=prepareFinanceAccountCapture(source,{expectedSourceKeys:accounts.map(a=>a.sourceKey),providerBySourceKey,sourceSha256,accountScope:'returned-institution-accounts',returnedManualAccountCount},now);
 return {schema:1,accountScope:'returned-institution-accounts',returnedManualAccountCount,snapshot,verificationLimits:[returnedManualAccountCount===null?'Manual-account section absent; no assertion about manual accounts elsewhere.':'Manual-account section explicitly empty in this response; no assertion about manual accounts elsewhere.','Source account coverage covers only institutions returned by this response, not total household wealth.','Bank balance freshness is unknown; collection time is not bank source-as-of.','Credit statement, minimum payment and due dates are not derived from this linked response; no prior credit fields copied.','Unknown or absent per-account providers retain unknown net semantics.']};
}
