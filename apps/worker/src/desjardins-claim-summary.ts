import type {Page} from "playwright";
import type {ClaimPreparation} from "./claim-preparation.js";
import {calendarDate} from "./healthcare-evidence.js";
const origin="https://www.agea-gbim.dsf-dfs.com";
export const desjardinsSummaryPath="/AGEA-GBIM/Reclamation/ResumeFrais_ExpenseSummary.aspx";
const normal=(s:string)=>s.normalize("NFKC").replace(/\s+/g," ").trim();
export function desjardinsCompactSummary(text:string,dossier:ClaimPreparation){
 const f=dossier.fields;
 if(dossier.blocked||dossier.insurer!=="desjardins"||!f.serviceDate||f.originalAmount==null||f.otherInsurancePaid==null
  ||!/^Subsequent Physiotherapy Session \(\d+ minutes\)$/i.test(f.service||"")||f.originalAmount<=f.otherInsurancePaid)return false;
 const day=calendarDate(f.serviceDate.slice(0,10));if(!day)return false;const date=new Date(day+"T12:00:00Z");
 const expectedDate=date.toLocaleDateString("fr-CA",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"});
 const net=((Math.round(f.originalAmount*100)-Math.round(f.otherInsurancePaid*100))/100).toFixed(2).replace(".",",")+" $";
 const lines=text.normalize("NFKC").split(/\r?\n/).map(s=>s.replace(/\s+/g," ").trim()).filter(Boolean);
 return lines.filter(s=>s===expectedDate).length===1&&lines.filter(s=>s===net).length===2
  &&lines.filter(s=>s==="Traitement subséquent").length===1&&lines.includes("Résumé des frais")&&lines.includes("Montant total réclamé");
}

export async function readDesjardinsExpenseSummary(page:Page,dossier:ClaimPreparation,ownerAnswersCurrent:boolean,paidReceipt:boolean){
 const u=new URL(page.url()),main=page.locator("main"),f=dossier.fields;
 if(u.origin!==origin||u.username||u.password||u.pathname!==desjardinsSummaryPath||await main.count()!==1||dossier.insurer!=="desjardins"||dossier.blocked||f.originalAmount==null||f.otherInsurancePaid==null)return null;
 const day=calendarDate(f.serviceDate?.slice(0,10)),duration=/^Subsequent Physiotherapy Session \(([1-9]\d{0,2}) minutes\)$/i.exec(f.service||"");
 if(!day||!duration)return null;
 const lines=(await main.innerText()).split(/\r?\n/).map(normal).filter(Boolean);
 const after=(label:string)=>{const indices=lines.flatMap((s,i)=>s===label?[i]:[]);return indices.length===1?lines[indices[0]+1]??null:null;};
 const date=new Date(day+"T12:00:00Z").toLocaleDateString("fr-CA",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"});
 const money=(n:number)=>n.toFixed(2).replace(".",",")+" $",remaining=money((Math.round(f.originalAmount*100)-Math.round(f.otherInsurancePaid*100))/100);
 const readback={date:after("Date des frais"),service:after("Type de frais"),duration:after("Durée"),amount:after("Coût du produit ou du service"),
  otherInsurancePaid:after("Montant obtenu d’un régime privé"),remaining:after("Montant total réclamé"),accident:after("Les frais ont-ils été engagés à la suite d’un accident?"),
  otherInsurance:after("Avez-vous déjà demandé ou obtenu un remboursement pour ces frais?"),governmentReimbursement:after("Avez-vous demandé ou obtenu un remboursement d’un organisme gouvernemental pour ces frais?"),
  privateInsuranceClaim:after("Avez-vous fait une autre réclamation pour ces frais auprès d’un régime privé?"),reimbursementMethod:after("Comment devons-nous faire le remboursement?")};
 const matches=ownerAnswersCurrent&&paidReceipt&&readback.date===date&&readback.service==="Traitement subséquent"&&readback.duration===duration[1]+" minutes"
  &&readback.amount===money(f.originalAmount)&&readback.otherInsurancePaid===money(f.otherInsurancePaid)&&readback.remaining===remaining
  &&readback.accident==="Non"&&readback.otherInsurance==="Oui"&&readback.governmentReimbursement==="Non"&&readback.privateInsuranceClaim==="Oui"
  &&readback.reimbursementMethod==="Par dépôt direct dans votre compte"&&lines.filter(s=>s===date).length===2&&lines.filter(s=>s==="Traitement subséquent").length===2
  &&lines.filter(s=>s===remaining).length===2;
 return {matches,...readback};
}

/** The observed summary Continue only opens the next preparation/review page. */
export async function advanceDesjardinsSummary(page:Page,matched:boolean,reserve:()=>void){
 const u=new URL(page.url()),main=page.locator("main");
 if(!matched||u.origin!==origin||u.username||u.password||u.pathname!==desjardinsSummaryPath||await main.count()!==1
  ||await main.locator("input,select,textarea").filter({visible:true}).count())return false;
 const next=main.getByRole("button",{name:"Continuer",exact:true}).filter({visible:true});
 if(await next.count()!==1||!await next.isEnabled()||await main.getByRole("button",{name:/^Supprimer/}).filter({visible:true}).count()!==1)return false;
 reserve();await next.click({timeout:10000});
 await page.waitForURL(url=>url.origin===origin&&url.pathname!==u.pathname&&/^\/AGEA-GBIM\/Reclamation\/(?:[A-Za-z_]+\/)*[A-Za-z_]+\.aspx$/.test(url.pathname),{timeout:30000,waitUntil:"domcontentloaded"});
 await page.locator("main").waitFor({state:"visible",timeout:30000});return true;
}
/** Expand the unique source-matched expense for read-only inspection. */
export async function openDesjardinsSummaryDetails(page:Page,dossier:ClaimPreparation,reserve:()=>void){
 const u=new URL(page.url()),main=page.locator("main");
 if(u.origin!==origin||u.username||u.password||u.pathname!==desjardinsSummaryPath||await main.count()!==1)return false;
 const details=main.getByRole("button",{name:"Voir les détails",exact:true}).filter({visible:true});
 await details.first().waitFor({state:"visible",timeout:10000}).catch(()=>{});
 if(await details.count()!==1||await details.getAttribute("id")!=="voir-les-détails"||!await details.isEnabled()
  ||!desjardinsCompactSummary(await main.innerText(),dossier)
  ||await main.locator("input,select,textarea").filter({visible:true}).count())return false;
 reserve();await details.click({timeout:7000});await page.waitForTimeout(300);return true;
}
