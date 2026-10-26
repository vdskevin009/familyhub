import type { Page } from "playwright";
import type { ClaimPreparation } from "./claim-preparation.js";
import {desjardinsDetailsPath,desjardinsDetailText,desjardinsDetailRadios} from "./desjardins-claim-details.js";

const origin = "https://www.agea-gbim.dsf-dfs.com";
/** Only observed intermediate navigation; never consent or final confirmation. */
export async function advanceDesjardinsIntroduction(page: Page, dossier: ClaimPreparation, reserve: () => void) {
  const url = new URL(page.url());
  if (dossier.insurer !== "desjardins" || dossier.blocked || url.origin !== origin || url.username || url.password
    || url.pathname !== "/AGEA-GBIM/Reclamation/Introduction_Introduction.aspx") return false;
  const main = page.locator("main");
  if (await main.count() !== 1 || await main.getByRole("heading", { name: "Réclamation pour soins de santé", exact: true }).count() !== 1
    || await main.locator("input,select,textarea").filter({ visible: true }).count()
    || await page.locator('input[type="password"],input[autocomplete="one-time-code"]').filter({ visible: true }).count()) return false;
  const start = main.getByRole("button", { name: "Commencer", exact: true }).filter({ visible: true });
  if (await start.count() !== 1 || !await start.isEnabled()) return false;
  reserve(); await start.click({ timeout: 10000 });
  await page.waitForURL(u => u.origin === origin && u.pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx", { timeout: 30000, waitUntil: "domcontentloaded" });
  await page.locator('main input[type="radio"][name="typeReclamation"]').first().waitFor({ state: "visible", timeout: 30000 });
  return new URL(page.url()).origin === origin && new URL(page.url()).pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx";
}

/** Only the observed expense-form Continue, after full current read-back. */
export async function advanceDesjardinsDetails(page:Page,ready:boolean,reserve:()=>void){
 const url=new URL(page.url()),main=page.locator("main");
 if(!ready||url.origin!==origin||url.username||url.password||url.pathname!==desjardinsDetailsPath||await main.count()!==1
  ||await main.getByRole("heading",{name:"Frais de soins professionnels",exact:true}).filter({visible:true}).count()!==1)return false;
 const groups=desjardinsDetailRadios(url.pathname);
 for(const control of await main.locator('input:not([type="hidden"]),select,textarea').filter({visible:true}).all()){
  const m=await control.evaluate((el:HTMLInputElement)=>({tag:el.tagName,type:el.type,name:el.name||"",label:Array.from(el.labels||[]).map(l=>{const copy=l.cloneNode(true) as HTMLElement;copy.querySelectorAll("input,select,textarea").forEach(c=>c.remove());return copy.textContent?.trim();}).join(" ")}));
  if(m.type==="radio"&&groups.some(g=>g.name===m.name))continue;
  if(!desjardinsDetailText(url.pathname,m.label,m.name,m.tag==="SELECT"?"select":m.type))return false;
 }
 for(const group of groups){
  const radios=main.locator(`input[type="radio"][name="${group.name}"]`).filter({visible:true});
  if(await radios.count()!==2||await radios.evaluateAll((els:HTMLInputElement[])=>els.filter(e=>e.checked).length)!==1)return false;
 }
 const next=main.getByRole("button",{name:"Continuer",exact:true}).filter({visible:true});
 if(await next.count()!==1||!await next.isEnabled())return false;
 reserve();await next.click({timeout:10000});
 await page.waitForURL(u=>u.origin===origin&&u.pathname!==url.pathname&&/^\/AGEA-GBIM\/Reclamation\/(?:[A-Za-z_]+\/)*[A-Za-z_]+\.aspx$/.test(u.pathname),{timeout:30000,waitUntil:"domcontentloaded"});
 await page.locator("main").waitFor({state:"visible",timeout:30000});return true;
}

export async function advanceDesjardinsRadio(page: Page, ready: boolean, reserve: () => void) {
  const url = new URL(page.url());
  const group = url.pathname === "/AGEA-GBIM/Reclamation/TypeReclamation_TypeOfClaim.aspx" ? "typeReclamation"
    : url.pathname === "/AGEA-GBIM/Reclamation/PersonneAssuree_InsuredPerson.aspx" ? "personneAssuree"
    : url.pathname === "/AGEA-GBIM/Reclamation/Fournisseur/ListeFournisseur_ProviderList.aspx" ? "fournisseur" : null;
  if (!ready || !group || url.origin !== origin || url.username || url.password) return false;
  const main = page.locator("main"), choices = main.locator(`input[type="radio"][name="${group}"]`).filter({ visible: true });
  if (await main.count() !== 1 || await choices.evaluateAll((els: HTMLInputElement[]) => els.filter(e => e.checked).length) !== 1
    || await main.locator('input[type="radio"]').filter({ visible: true }).count() !== await choices.count()
    || await main.locator('input:not([type="radio"]):not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea').filter({ visible: true }).count()) return false;
  const next = main.getByRole("button", { name: "Continuer", exact: true }).filter({ visible: true });
  if (await next.count() !== 1 || !await next.isEnabled()) return false;
  reserve(); await next.click({ timeout: 10000 });
  await page.waitForURL(u => u.origin === origin && u.pathname !== url.pathname && /^\/AGEA-GBIM\/Reclamation\/(?:[A-Za-z_]+\/)*[A-Za-z_]+\.aspx$/.test(u.pathname), { timeout: 30000, waitUntil: "domcontentloaded" });
  const nextGroup = group === "typeReclamation" ? "personneAssuree" : group === "personneAssuree" ? "fournisseur" : null;
  if (nextGroup) await page.locator(`main input[type="radio"][name="${nextGroup}"]`).first().waitFor({ state: "visible", timeout: 30000 });
  else await page.locator('main input:not([type="hidden"]), main select, main textarea').filter({ visible: true }).first().waitFor({ state: "visible", timeout: 30000 });
  return new URL(page.url()).origin === origin && new URL(page.url()).pathname !== url.pathname;
}
