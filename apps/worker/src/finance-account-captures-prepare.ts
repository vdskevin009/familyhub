import {validateFinanceSourceInventory} from "./finance-source-inventory-model.js";
import {accountCapturesFail,plaidCurrentNet,validateFinanceAccountCaptureSnapshot,type FinanceAccountCaptureSnapshot,type FinanceCaptureAccount} from "./finance-account-captures-model.js";
/** Pure admission of ALL exact source keys. No canonical crosswalk, matching, collection or account exclusion.
 * expectedSourceKeys comes from the explicit complete linked-account response, not names or suffixes.
 * Manual accounts require a dedicated adapter: a nonzero/missing manualAccountCount blocks complete admission.
 * Manual assets are not account balances and must never be added to this scope.
 * providerBySourceKey copies each provider identity from that same source, never a global assumption. */
export function prepareFinanceAccountCapture(value:unknown, options:{expectedSourceKeys:readonly string[];providerBySourceKey:Readonly<Record<string,"plaid"|"unknown">>;sourceSha256:string;manualAccountCount:number;supersedesCaptureId?:string|null}, now=new Date()):FinanceAccountCaptureSnapshot {
  const source=validateFinanceSourceInventory(value,now);
  if(!options||options.manualAccountCount!==0||!Array.isArray(options.expectedSourceKeys)||!options.expectedSourceKeys.length||options.expectedSourceKeys.length>100||new Set(options.expectedSourceKeys).size!==options.expectedSourceKeys.length||options.expectedSourceKeys.some(k=>typeof k!=="string"||!/^fsi_[a-f0-9]{64}$/.test(k))
    ||!options.providerBySourceKey||typeof options.providerBySourceKey!=="object"||Array.isArray(options.providerBySourceKey)||Object.keys(options.providerBySourceKey).sort().join(",")!==[...options.expectedSourceKeys].sort().join(",")
    ||source.availability.accounts.coverage!=="complete"||source.accounts.length!==options.expectedSourceKeys.length||source.accounts.some(a=>!options.expectedSourceKeys.includes(a.sourceKey)))return accountCapturesFail();
  const accounts=source.accounts.map(({reconciliation,...a})=>{const account:FinanceCaptureAccount={...a,provider:options.providerBySourceKey[a.sourceKey],netBalance:null};account.netBalance=plaidCurrentNet(account);return account;});
  return validateFinanceAccountCaptureSnapshot({schemaVersion:1,source:"finances-plugin",collectedAt:source.collectedAt,coverage:"complete",sourceAccountCount:accounts.length,sourceSha256:options.sourceSha256,supersedesCaptureId:options.supersedesCaptureId??null,accounts},now);
}
