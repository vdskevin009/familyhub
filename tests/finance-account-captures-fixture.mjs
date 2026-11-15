import {financeSourceKey} from '../apps/worker/src/finance-source-inventory-store.ts';
import {plaidCurrentNet} from '../apps/worker/src/finance-account-captures-model.ts';
export const captureNow=new Date('2030-06-01T00:00:00.000Z');
export function accountCaptureFixture(collectedAt='2030-05-01T10:00:00.000Z') {
  const accounts=Array.from({length:9},(_,i)=>{
    const kind=i<2?'credit':i<4?'depository':'investment';
    const a={sourceKey:financeSourceKey('account','synthetic-item','synthetic-account-'+i),name:'Compte fictif '+i,institution:'Banque fictive',kind,provider:'plaid',balance:{amountCents:i===0?12000:i===1?-3000:i===2?0:10000+i,currency:i===8?'USD':'CAD',sourceAsOf:null},credit:null,netBalance:null};
    a.netBalance=plaidCurrentNet(a);return a;
  });
  return {schemaVersion:1,source:'finances-plugin',collectedAt,coverage:'complete',sourceAccountCount:9,sourceSha256:'a'.repeat(64),supersedesCaptureId:null,accounts};
}
