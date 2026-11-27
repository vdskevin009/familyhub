import type { WorkerConfig } from "./types";
import { workerRequestHeaders } from "./worker-transport";
import { validateMortgageAlertSettings, type MortgageAlertSettings } from "../../worker/src/mortgage-daily";

/** One explicit authenticated write. An uncertain response is never replayed. */
export async function saveMortgageAlertSettings(config:WorkerConfig,settings:MortgageAlertSettings):Promise<void> {
  if(!config.Endpoint||!config.ApiKey) throw new Error("Connect your PC before saving your thresholds.");
  const body=validateMortgageAlertSettings(settings);
  try { const health=await fetch(config.Endpoint.replace(/\/$/,"")+"/health",{headers:workerRequestHeaders(config,false),cache:"no-store",signal:AbortSignal.timeout(15000)});const capability=await health.json();if(!health.ok||!Array.isArray(capability.capabilities)||!capability.capabilities.includes("mortgage-assistant-v1"))throw new Error(); }
  catch { throw new Error("The worker does not confirm support for Mortgage Assistant. No save request was sent. Check for an update and refresh."); }
  let response:Response;
  try { response=await fetch(config.Endpoint.replace(/\/$/,"")+"/mortgage/settings",{method:"POST",headers:workerRequestHeaders(config),body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(15000)}); }
  catch { throw new Error("Save not confirmed. Refresh to check the thresholds before trying again."); }
  if(!response.ok) throw new Error(response.status===404?"Update the PC worker to save these thresholds.":"The thresholds were not confirmed. Refresh before trying again.");
}
