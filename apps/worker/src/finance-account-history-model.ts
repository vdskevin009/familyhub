import {financeTimestamp} from "./finance-observations.js";
import {accountCapturesFail,captureObject,captureHash} from "./finance-account-captures-model.js";
export const ACCOUNT_HISTORY_CAPABILITY = "finance-account-history-v1" as const;
export type FinanceHistoricalAccount = {sourceKey:string;canonicalAccountId:string;name:string;kind:string;currency:string;balanceCents:number|null};
export type FinanceHistoricalAccountVersion = {
  id:string;sourceSha256:string;sourceAsOf:string;collectedAt:null;convention:"recorded-signed-unverified";
  sourceAccountCount:number;coverage:"complete-recorded-scope"|"partial-recorded-scope";accounts:FinanceHistoricalAccount[];
};
export type FinanceAccountHistory = {capability:typeof ACCOUNT_HISTORY_CAPABILITY;versions:FinanceHistoricalAccountVersion[];unavailableArchiveCount:number};
export function historicalDay(value:unknown):value is string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const time=Date.parse(value+"T00:00:00Z");return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
export function historicalSourceDate(value:unknown):value is string {if(historicalDay(value))return true;try{financeTimestamp(value);return true;}catch{return false;}}
const label=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export function validateFinanceAccountHistory(value:unknown):FinanceAccountHistory {
  const r=captureObject(value,["capability","versions","unavailableArchiveCount"]);
  if(r.capability!==ACCOUNT_HISTORY_CAPABILITY||!Array.isArray(r.versions)||r.versions.length>2400||!Number.isSafeInteger(r.unavailableArchiveCount)||(r.unavailableArchiveCount as number)<0||(r.unavailableArchiveCount as number)>100_000)return accountCapturesFail();
  const versions=r.versions.map(value=>{
    const v=captureObject(value,["id","sourceSha256","sourceAsOf","collectedAt","convention","sourceAccountCount","coverage","accounts"]);
    if(!captureHash(v.id)||!captureHash(v.sourceSha256)||!historicalSourceDate(v.sourceAsOf)||v.collectedAt!==null||v.convention!=="recorded-signed-unverified"||!["complete-recorded-scope","partial-recorded-scope"].includes(v.coverage as string)||!Number.isSafeInteger(v.sourceAccountCount)||(v.sourceAccountCount as number)<1||(v.sourceAccountCount as number)>100||!Array.isArray(v.accounts)||!v.accounts.length||v.accounts.length>(v.sourceAccountCount as number))return accountCapturesFail();
    const accounts=v.accounts.map(value=>{const a=captureObject(value,["sourceKey","canonicalAccountId","name","kind","currency","balanceCents"]);
      if(typeof a.canonicalAccountId!=="string"||! /^[a-zA-Z0-9:_-]{1,160}$/.test(a.canonicalAccountId)||typeof a.sourceKey!=="string"||!/^fhi_[a-f0-9]{64}$/.test(a.sourceKey)||!label(a.name,160)||!label(a.kind,40)||typeof a.currency!=="string"||! /^[A-Z]{3}$/.test(a.currency)||(a.balanceCents!==null&&(!Number.isSafeInteger(a.balanceCents)||Math.abs(a.balanceCents as number)>1e13)))return accountCapturesFail();
      return a as FinanceHistoricalAccount;});
    if(new Set(accounts.map(a=>a.sourceKey)).size!==accounts.length||(v.coverage==="complete-recorded-scope"&&accounts.length!==v.sourceAccountCount))return accountCapturesFail();
    return {...v,accounts} as FinanceHistoricalAccountVersion;
  });
  if(new Set(versions.map(v=>v.id)).size!==versions.length||new TextEncoder().encode(JSON.stringify(versions)).byteLength>32_000_000)return accountCapturesFail();
  return {capability:ACCOUNT_HISTORY_CAPABILITY,versions,unavailableArchiveCount:r.unavailableArchiveCount as number};
}
