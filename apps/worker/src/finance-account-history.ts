import {createHash} from "node:crypto";
import {open,realpath} from "node:fs/promises";
import {join,resolve,dirname} from "node:path";
import {AccountCapturesError,captureHash} from "./finance-account-captures-model.js";
import {ACCOUNT_HISTORY_CAPABILITY,historicalSourceDate,validateFinanceAccountHistory,type FinanceHistoricalAccount,type FinanceHistoricalAccountVersion,type FinanceAccountHistory} from "./finance-account-history-model.js";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const MAX_ARCHIVE_BYTES=20_000_000,MAX_TOTAL_BYTES=128_000_000;
/** Read-only projection of original imported bundles. No mutable ledger balances, source-date fallback,
 * holdings, inferred semantics, provider identities or local paths enter the response. */
export async function readFinanceAccountHistory(financeDirectory:string,imports:readonly {hash:string}[]):Promise<FinanceAccountHistory>{
  if(!Array.isArray(imports)||imports.length>2400)throw new AccountCapturesError("The archive is too large. No files were changed.");
  const versions:FinanceHistoricalAccountVersion[]=[],seen=new Set<string>(),hashes=new Set<string>();let unavailableArchiveCount=0,totalBytes=0;
  for(const item of imports){
    if(!item||!captureHash(item.hash)){unavailableArchiveCount++;continue;}if(hashes.has(item.hash))continue;hashes.add(item.hash);
    let file;try{
      const root=await realpath(financeDirectory),sources=await realpath(join(financeDirectory,"sources"));
      if(dirname(sources)!==root)throw Error("Boundary");
      const path=join(sources,item.hash+".json"),actual=await realpath(path);
      if(resolve(actual)!==resolve(path)||dirname(actual)!==sources)throw Error("Boundary");
      file=await open(path,"r");const size=(await file.stat()).size;if(size>MAX_ARCHIVE_BYTES||totalBytes+size>MAX_TOTAL_BYTES)throw Error("Size");
      const chunks:Buffer[]=[];let length=0;while(true){const b=Buffer.alloc(Math.min(65536,MAX_ARCHIVE_BYTES+1-length));const r=await file.read(b,0,b.length,null);if(!r.bytesRead)break;length+=r.bytesRead;if(length>MAX_ARCHIVE_BYTES||totalBytes+length>MAX_TOTAL_BYTES)throw Error("Size");chunks.push(b.subarray(0,r.bytesRead));}totalBytes+=length;
      const raw=Buffer.concat(chunks).toString("utf8");if(digest(raw)!==item.hash)throw Error("Hash");const bundle=JSON.parse(raw);
      if(bundle?.schema!=="familyhub.td.preparation.v1"||!Array.isArray(bundle.accounts)||bundle.accounts.length>100)throw Error("Format");
      // These repeat canonical account rows only to scope received observations, not a historical account version.
      if(bundle.importMode==="balance-observations-only")continue;
      if(!bundle.accounts.length)continue;
      const groups=new Map<string,FinanceHistoricalAccount[]>(),identities=new Set<string>(),ids=new Set<string>();
      for(const a of bundle.accounts){
        if(!a||typeof a.accountId!=="string"||! /^[a-zA-Z0-9:_-]{1,160}$/.test(a.accountId)||ids.has(a.accountId))throw Error("Identity");ids.add(a.accountId);
        const identity=a.identityFingerprint??a.accountId;if(typeof identity!=="string"||!identity||identity.length>200||identities.has(identity))throw Error("Identity");identities.add(identity);
        // Missing observedOn is not collectedOn, scope.to, import time, or midnight of any other date.
        if(a.observedOn===undefined||a.observedOn===null)continue;if(!historicalSourceDate(a.observedOn))throw Error("Date");
        const row:FinanceHistoricalAccount={sourceKey:"fhi_"+digest(JSON.stringify(["canonical-archive-account",a.accountId,identity])),canonicalAccountId:a.accountId,name:a.alias,kind:a.type,currency:a.currency,balanceCents:a.observedBalanceCents??null};
        groups.set(a.observedOn,[...(groups.get(a.observedOn)??[]),row]);
      }
      // Build and validate the whole archive projection before admitting any part.
      const projected:FinanceHistoricalAccountVersion[]=[];
      for(const [sourceAsOf,accounts]of groups){accounts.sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey));
        projected.push({id:digest(JSON.stringify([item.hash,sourceAsOf])),sourceSha256:item.hash,sourceAsOf,collectedAt:null,convention:"recorded-signed-unverified",sourceAccountCount:bundle.accounts.length,
          coverage:accounts.length===bundle.accounts.length&&!bundle.pluginEvidence&&!bundle.pluginFeedEvidence?"complete-recorded-scope":"partial-recorded-scope",accounts});
      }
      validateFinanceAccountHistory({capability:ACCOUNT_HISTORY_CAPABILITY,versions:projected,unavailableArchiveCount:0});
      for(const version of projected){const fingerprint=JSON.stringify([version.sourceAsOf,version.coverage,version.sourceAccountCount,version.accounts]);if(!seen.has(fingerprint)){seen.add(fingerprint);versions.push(version);}}
      if(!projected.length)unavailableArchiveCount++;
    }catch{unavailableArchiveCount++;}finally{await file?.close();}
  }
  versions.sort((a,b)=>a.sourceAsOf.localeCompare(b.sourceAsOf)||a.id.localeCompare(b.id));
  return validateFinanceAccountHistory({capability:ACCOUNT_HISTORY_CAPABILITY,versions,unavailableArchiveCount});
}
