import {createHash,randomUUID} from "node:crypto";
import {mkdir,open,rename,unlink} from "node:fs/promises";
import {dirname,join} from "node:path";
import {FinanceSourceInventoryStore} from "./finance-source-inventory-store.js";
import {validateFinanceSourceInventory,type FinanceSourceInventory} from "./finance-source-inventory-model.js";
import {ACCOUNT_CAPTURES_LIMITS,AccountCapturesError,validateFinanceAccountCaptureSnapshot,validateFinanceAccountCapturesState,type FinanceAccountCapture,type FinanceAccountCaptureSnapshot,type FinanceAccountCapturesState} from "./finance-account-captures-model.js";
export class AccountCapturesConflict extends AccountCapturesError {}
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const accountCaptureId=(origin:FinanceAccountCapture["origin"],snapshot:FinanceAccountCaptureSnapshot)=>digest({origin,snapshot});
const order=(a:FinanceAccountCapture,b:FinanceAccountCapture)=>a.snapshot.collectedAt.localeCompare(b.snapshot.collectedAt)||a.id.localeCompare(b.id);
function stateOf(captures:FinanceAccountCapture[]):FinanceAccountCapturesState { const sorted=[...captures].sort(order); return {revision:sorted.length?digest(sorted):"empty",captures:sorted}; }
export function legacyInventoryCapture(value:FinanceSourceInventory,now=new Date()):FinanceAccountCapture {
  const inventory=validateFinanceSourceInventory(value,now);
  const snapshot=validateFinanceAccountCaptureSnapshot({schemaVersion:1,source:"finances-plugin",collectedAt:inventory.collectedAt,coverage:"partial",sourceAccountCount:null,sourceSha256:null,supersedesCaptureId:null,
    accounts:inventory.accounts.map(({reconciliation,...a})=>({...a,provider:"unknown",netBalance:null}))},now);
  return {id:accountCaptureId("legacy-inventory",snapshot),origin:"legacy-inventory",snapshot};
}
/** Logically append-only, atomic private history. Existing rows cannot be edited or deleted.
 * A legacy file is projected without writes; the next apply archives it without rewriting it.
 * A single worker owns both stores. There is no cross-process writer/locking support. */
export class FinanceAccountCapturesStore {
  private queue:Promise<unknown>=Promise.resolve(); private readonly path:string; private readonly legacy:FinanceSourceInventoryStore;
  constructor(privateDirectory:string){this.path=join(privateDirectory,"finance","account-captures.json");this.legacy=new FinanceSourceInventoryStore(privateDirectory);}
  private async persisted(now:Date):Promise<FinanceAccountCapturesState>{
    let file;try{
      file=await open(this.path,"r");if((await file.stat()).size>ACCOUNT_CAPTURES_LIMITS.historyBytes)throw new AccountCapturesError("Historique trop volumineux.");
      const chunks:Buffer[]=[];let size=0;while(true){const b=Buffer.alloc(Math.min(65536,ACCOUNT_CAPTURES_LIMITS.historyBytes+1-size));const r=await file.read(b,0,b.length,null);if(!r.bytesRead)break;size+=r.bytesRead;if(size>ACCOUNT_CAPTURES_LIMITS.historyBytes)throw new AccountCapturesError("Historique trop volumineux.");chunks.push(b.subarray(0,r.bytesRead));}
      const state=validateFinanceAccountCapturesState(JSON.parse(Buffer.concat(chunks).toString("utf8")),now);
      if(state.captures.some(c=>c.id!==accountCaptureId(c.origin,c.snapshot))||JSON.stringify(state)!==JSON.stringify(stateOf(state.captures)))throw new AccountCapturesError("Révision invalide.");return state;
    }catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return stateOf([]);throw new AccountCapturesError("Historique des comptes illisible. Les fichiers sont conservés.");}finally{await file?.close();}
  }
  private async readUnlocked(now:Date):Promise<FinanceAccountCapturesState>{
    const state=await this.persisted(now),legacy=await this.legacy.read(now);
    if(legacy.snapshot){const c=legacyInventoryCapture(legacy.snapshot,now);if(!state.captures.some(x=>x.id===c.id))state.captures.push(c);}
    return validateFinanceAccountCapturesState(stateOf(state.captures),now);
  }
  read(now=new Date()):Promise<FinanceAccountCapturesState>{const run=this.queue.then(()=>this.readUnlocked(now));this.queue=run.catch(()=>{});return run;}
  private plan(snapshot:FinanceAccountCaptureSnapshot,current:FinanceAccountCapturesState,expectedRevision:string,now:Date){
    if(expectedRevision!==current.revision)throw new AccountCapturesConflict("Les captures ont changé. Relisez avant de réessayer.");
    const capture:FinanceAccountCapture={id:accountCaptureId("source-capture",snapshot),origin:"source-capture",snapshot};
    if(current.captures.some(c=>c.id===capture.id))return {capture,proposedRevision:current.revision,alreadyImported:true,next:current};
    const same=current.captures.filter(c=>c.origin==="source-capture"&&c.snapshot.collectedAt===snapshot.collectedAt);
    if(snapshot.supersedesCaptureId!==null){const target=same.find(c=>c.id===snapshot.supersedesCaptureId);if(!target||current.captures.some(c=>c.snapshot.supersedesCaptureId===target.id))throw new AccountCapturesConflict("La version à corriger doit être la version courante de cette capture.");}
    else if(same.length)throw new AccountCapturesConflict("Une capture différente porte cet horodatage. Une correction explicite est requise.");
    const next=validateFinanceAccountCapturesState(stateOf([...current.captures,capture]),now);
    return {capture,proposedRevision:next.revision,alreadyImported:false,next};
  }
  async preview(value:unknown,expectedRevision:string,now=new Date()){const {next,...result}=this.plan(validateFinanceAccountCaptureSnapshot(value,now),await this.read(now),expectedRevision,now);return result;}
  private async write(state:FinanceAccountCapturesState){
    await mkdir(dirname(this.path),{recursive:true});const temporary=this.path+"."+randomUUID()+".tmp";
    try{const file=await open(temporary,"wx",0o600);try{await file.writeFile(JSON.stringify(state),"utf8");await file.sync();}finally{await file.close();}await rename(temporary,this.path);}
    finally{await unlink(temporary).catch(e=>{if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;});}
  }
  save(value:unknown,expectedRevision:string,now=new Date()):Promise<FinanceAccountCapturesState>{
    let snapshot:FinanceAccountCaptureSnapshot;try{snapshot=validateFinanceAccountCaptureSnapshot(value,now);}catch(e){return Promise.reject(e);}
    const run=this.queue.then(async()=>{const plan=this.plan(snapshot,await this.readUnlocked(now),expectedRevision,now);if(plan.alreadyImported)return plan.next;await this.write(plan.next);const confirmed=await this.readUnlocked(now);if(confirmed.revision!==plan.proposedRevision)throw new AccountCapturesError("Enregistrement non confirmé. Relisez avant de réessayer.");return confirmed;});this.queue=run.catch(()=>{});return run;
  }
  /** Serialize the entire legacy replacement with capture writes. Reserve projected incoming capacity
   * before changing either file. Archive only actual previous facts; never fabricate a failed incoming capture. */
  withLegacyReplacement<T>(previous:FinanceSourceInventory|null,incoming:FinanceSourceInventory,now:Date,commit:()=>Promise<T>):Promise<T>{
    const old=previous?legacyInventoryCapture(previous,now):null,next=legacyInventoryCapture(incoming,now);
    const run=this.queue.then(async()=>{
      const stored=await this.persisted(now),captures=[...stored.captures];
      if(old&&!captures.some(c=>c.id===old.id))captures.push(old);
      const archived=validateFinanceAccountCapturesState(stateOf(captures),now);
      validateFinanceAccountCapturesState(stateOf(captures.some(c=>c.id===next.id)?captures:[...captures,next]),now);
      if(archived.revision!==stored.revision)await this.write(archived);
      return commit();
    });this.queue=run.catch(()=>{});return run;
  }
}
