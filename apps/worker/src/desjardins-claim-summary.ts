import type {Page} from "playwright";
import type {ClaimPreparation} from "./claim-preparation.js";
const origin="https://www.agea-gbim.dsf-dfs.com";
export const desjardinsSummaryPath="/AGEA-GBIM/Reclamation/ResumeFrais_ExpenseSummary.aspx";
export function desjardinsCompactSummary(text:string,dossier:ClaimPreparation){
 const f=dossier.fields;
 if(dossier.blocked||dossier.insurer!=="desjardins"||!f.serviceDate||f.originalAmount==null||f.otherInsurancePaid==null
  ||!/^Subsequent Physiotherapy Session \(\d+ minutes\)$/i.test(f.service||"")||f.originalAmount<=f.otherInsurancePaid)return false;
 const date=new Date(f.serviceDate.slice(0,10)+"T12:00:00Z");if(!Number.isFinite(date.getTime()))return false;
 const expectedDate=date.toLocaleDateString("fr-CA",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"});
 const net=((Math.round(f.originalAmount*100)-Math.round(f.otherInsurancePaid*100))/100).toFixed(2).replace(".",",")+" $";
 const lines=text.normalize("NFKC").split(/\r?\n/).map(s=>s.replace(/\s+/g," ").trim()).filter(Boolean);
 return lines.filter(s=>s===expectedDate).length===1&&lines.filter(s=>s===net).length===2
  &&lines.filter(s=>s==="Traitement subséquent").length===1&&lines.includes("Résumé des frais")&&lines.includes("Montant total réclamé");
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
