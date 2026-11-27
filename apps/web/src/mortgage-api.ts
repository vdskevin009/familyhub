import type { WorkerConfig } from "./types";
import { workerRequestHeaders } from "./worker-transport";
import { validateState, type MortgageState } from "../../worker/src/mortgage-model";
export async function fetchMortgage(config: WorkerConfig, signal?: AbortSignal): Promise<MortgageState> {
  if (!config.Endpoint || !config.ApiKey) throw new Error("Connect your PC in More → Settings and tools to load your history.");
  const response=await fetch(config.Endpoint.replace(/\/$/,"")+"/mortgage",{headers:workerRequestHeaders(config,false),cache:"no-store",signal});
  if (!response.ok) throw new Error(response.status===404 ? "Update the PC worker to use Mortgage." : "History unavailable. Check the PC and refresh.");
  try { return validateState(await response.json()); }
  catch { throw new Error("The history received could not be read. Check the data on the PC and refresh."); }
}
