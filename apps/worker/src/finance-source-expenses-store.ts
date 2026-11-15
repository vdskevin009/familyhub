import {createHash,randomUUID} from "node:crypto";
import {mkdir,open,rename,unlink} from "node:fs/promises";
import {dirname,join} from "node:path";
import {SOURCE_EXPENSES_LIMITS,SourceExpensesError,validateSourceExpenses,validateSourceExpensesState,type SourceExpensesSnapshot,type SourceExpensesState} from "./finance-source-expenses-model.js";
export class SourceExpensesConflict extends SourceExpensesError {}
export function sourceExpenseKey(kind:"account"|"transaction",itemId:string,recordId:string,accountId?:string):string {
  if(!["account","transaction"].includes(kind)||[itemId,recordId,...(kind==="transaction"?[accountId]:[])].some(v=>typeof v!=="string"||!v.trim()||v.length>512||/[\u0000-\u001f\u007f]/.test(v))) throw new SourceExpensesError("Identité source invalide.");
  // Account namespace deliberately matches source inventory, never a canonical identity.
  return "fsi_"+createHash("sha256").update(JSON.stringify(kind==="account"?["finances-plugin",kind,itemId,recordId]:["finances-plugin",kind,itemId,accountId,recordId])).digest("hex");
}
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class FinanceSourceExpensesStore {
  private queue:Promise<unknown>=Promise.resolve(); private path:string;
  constructor(privateDirectory:string){this.path=join(privateDirectory,"finance","source-expenses.json");}
  async read(now=new Date()):Promise<SourceExpensesState>{
    let file; try{
      file=await open(this.path,"r"); if((await file.stat()).size>SOURCE_EXPENSES_LIMITS.historyBytes) throw new SourceExpensesError("Historique source trop volumineux.");
      const chunks:Buffer[]=[];let length=0;while(true){const bytes=Buffer.alloc(Math.min(65536,SOURCE_EXPENSES_LIMITS.historyBytes+1-length)),result=await file.read(bytes,0,bytes.length,null);if(!result.bytesRead)break;length+=result.bytesRead;if(length>SOURCE_EXPENSES_LIMITS.historyBytes)throw new SourceExpensesError("Historique source trop volumineux.");chunks.push(bytes.subarray(0,result.bytesRead));}
      const state=validateSourceExpensesState(JSON.parse(Buffer.concat(chunks).toString("utf8")),now);
      if(state.revision!==(state.snapshots.length?digest(state.snapshots):"empty"))throw new SourceExpensesError("Révision invalide.");return state;
    }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {revision:"empty",snapshots:[]};throw new SourceExpensesError("Historique des dépenses source illisible. Le fichier est conservé.");}finally{await file?.close();}
  }
  private plan(snapshot:SourceExpensesSnapshot,current:SourceExpensesState,expectedRevision:string){
    if(expectedRevision!==current.revision)throw new SourceExpensesConflict("Les dépenses source ont changé. Relisez avant de réessayer.");
    const found=current.snapshots.find(s=>s.collectedAt===snapshot.collectedAt);
    if(found&&JSON.stringify(found)===JSON.stringify(snapshot))return {snapshot,proposedRevision:current.revision,alreadyImported:true,next:current};
    if(current.snapshots.length&&snapshot.collectedAt<=current.snapshots.at(-1)!.collectedAt)throw new SourceExpensesConflict("Collecte antérieure ou contradictoire. Historique conservé.");
    if(current.snapshots.length>=SOURCE_EXPENSES_LIMITS.captures)throw new SourceExpensesError("Limite de captures atteinte. Historique conservé; archivage nécessaire.");
    const snapshots=[...current.snapshots,snapshot], next={revision:digest(snapshots),snapshots};
    if(Buffer.byteLength(JSON.stringify(next))>SOURCE_EXPENSES_LIMITS.historyBytes)throw new SourceExpensesError("Historique source trop volumineux. Aucun historique supprimé.");
    return {snapshot,proposedRevision:next.revision,alreadyImported:false,next};
  }
  async preview(value:unknown,expectedRevision:string,now=new Date()) {const snapshot=validateSourceExpenses(value,now),current=await this.read(now);const {next,...result}=this.plan(snapshot,current,expectedRevision);return result;}
  save(value:unknown,expectedRevision:string,now=new Date()):Promise<SourceExpensesState>{
    let snapshot:SourceExpensesSnapshot;try{snapshot=validateSourceExpenses(value,now);}catch(e){return Promise.reject(e);}
    const run=this.queue.then(async()=>{const plan=this.plan(snapshot,await this.read(now),expectedRevision);if(plan.alreadyImported)return plan.next;
      await mkdir(dirname(this.path),{recursive:true});const temporary=this.path+"."+randomUUID()+".tmp";
      try{const file=await open(temporary,"wx",0o600);try{await file.writeFile(JSON.stringify(plan.next),"utf8");await file.sync();}finally{await file.close();}await rename(temporary,this.path);}finally{await unlink(temporary).catch(e=>{if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;});}
      const confirmed=await this.read(now);if(confirmed.revision!==plan.proposedRevision)throw new SourceExpensesError("Enregistrement non confirmé. Relisez avant de réessayer.");return confirmed;
    });this.queue=run.catch(()=>{});return run;
  }
}
