import {ACCOUNT_CAPTURES_CAPABILITY,AccountCapturesError,captureObject,captureHash,type FinanceAccountCaptureImportResult} from "./finance-account-captures-model.js";
import type {FinanceAccountCapturesStore} from "./finance-account-captures-store.js";
export async function importFinanceAccountCapture(store:FinanceAccountCapturesStore,value:unknown,now=new Date()):Promise<FinanceAccountCaptureImportResult>{
  const body=captureObject(value,["capability","snapshot","apply","expectedRevision"]);
  if(body.capability!==ACCOUNT_CAPTURES_CAPABILITY||typeof body.apply!=="boolean"||(body.expectedRevision!=="empty"&&!captureHash(body.expectedRevision)))throw new AccountCapturesError("Capacité, aperçu et révision explicites requis.");
  const preview=await store.preview(body.snapshot,body.expectedRevision,now);
  const state=body.apply?await store.save(preview.capture.snapshot,body.expectedRevision,now):null;
  if(state&&state.revision!==preview.proposedRevision)throw new AccountCapturesError("Enregistrement non confirmé. Relisez avant de réessayer.");
  return {capability:ACCOUNT_CAPTURES_CAPABILITY,applied:body.apply,expectedRevision:body.expectedRevision,...preview,state};
}
