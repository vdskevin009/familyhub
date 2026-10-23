import type { WorkerConfig } from "./types";
import { validateMortgageAlertSettings, type MortgageAlertSettings } from "../../worker/src/mortgage-daily";

/** One explicit authenticated write. An uncertain response is never replayed. */
export async function saveMortgageAlertSettings(config:WorkerConfig,settings:MortgageAlertSettings):Promise<void> {
  if(!config.Endpoint||!config.ApiKey) throw new Error("Associez le PC avant d’enregistrer vos seuils.");
  const body=validateMortgageAlertSettings(settings);
  try { const health=await fetch(config.Endpoint.replace(/\/$/,"")+"/health",{headers:{"x-familyhub-key":config.ApiKey},cache:"no-store",signal:AbortSignal.timeout(15000)});const capability=await health.json();if(!health.ok||!Array.isArray(capability.capabilities)||!capability.capabilities.includes("mortgage-assistant-v1"))throw new Error(); }
  catch { throw new Error("Le worker ne confirme pas la capacité Mortgage assistant. Aucun enregistrement envoyé; vérifiez sa mise à jour puis actualisez."); }
  let response:Response;
  try { response=await fetch(config.Endpoint.replace(/\/$/,"")+"/mortgage/settings",{method:"POST",headers:{"x-familyhub-key":config.ApiKey,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(15000)}); }
  catch { throw new Error("Enregistrement incertain. Actualisez les données pour vérifier les seuils avant toute nouvelle tentative."); }
  if(!response.ok) throw new Error(response.status===404?"Le worker PC doit être mis à jour pour enregistrer ces seuils.":"Les seuils n’ont pas été confirmés. Actualisez les données avant toute nouvelle tentative.");
}
