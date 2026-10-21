import type { WorkerConfig } from "./types";
import { validateState, type MortgageState } from "../../worker/src/mortgage-model";
export async function fetchMortgage(config: WorkerConfig, signal?: AbortSignal): Promise<MortgageState> {
  if (!config.Endpoint || !config.ApiKey) throw new Error("Associez le PC dans Settings & tools pour charger l’historique.");
  const response=await fetch(config.Endpoint.replace(/\/$/,"")+"/mortgage",{headers:{"x-familyhub-key":config.ApiKey},cache:"no-store",signal});
  if (!response.ok) throw new Error(response.status===404 ? "Le worker PC doit être mis à jour pour Mortgage." : "Historique indisponible. Vérifiez le PC puis actualisez.");
  try { return validateState(await response.json()); }
  catch { throw new Error("Historique reçu invalide. Vérifiez les données sur le PC puis actualisez."); }
}
