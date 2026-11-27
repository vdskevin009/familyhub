import type { WorkerConfig } from "./types";
import { workerRequestHeaders } from "./worker-transport";
import type { GroceryLibrary, GroceryRecord, GroceryReceipt } from "../../worker/src/grocery-model";
export type UploadSource = { name: string; type: string; data: string };
export type SourceBytes = UploadSource & { hash: string; size: number };
export async function groceryRequest<T>(config: WorkerConfig, path: string, body?: unknown): Promise<T> {
  if (!config.Endpoint.trim() || !config.ApiKey.trim()) throw new Error("Pair your PC under More → Settings and tools → Local AI to save household purchases.");
  const evidencePlan = body as { plan?: { purchaseComparisons?: unknown[]; sourceEstimates?: unknown[] } } | undefined;
  if (body !== undefined && path === "/groceries/planning" && (evidencePlan?.plan?.purchaseComparisons?.length || evidencePlan?.plan?.sourceEstimates?.length)) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (evidencePlan?.plan?.purchaseComparisons?.length && !health.capabilities?.includes("grocery-comparison-evidence-v1")) throw new Error("Update the PC worker to save comparison evidence. No plan was changed.");
    if (evidencePlan?.plan?.sourceEstimates?.length && !health.capabilities?.includes("grocery-source-estimates-v1")) throw new Error("Update the PC worker to save source unit prices. No plan was changed.");
  }
  let response: Response;
  try { response = await fetch(config.Endpoint.replace(/\/$/, "") + path, { method: body === undefined ? "GET" : "POST",
    headers: workerRequestHeaders(config), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000), cache: "no-store", redirect: "error" }); }
  catch { throw new Error("The PC is unreachable or the result is unknown. Local sources and edits are retained. Refresh receipts before trying again."); }
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || "Grocery action unavailable."); }
  return response.json();
}
export const loadGroceries = (config: WorkerConfig) => groceryRequest<GroceryLibrary>(config, "/groceries");
export async function importGroceries(config: WorkerConfig, sources: UploadSource[]) {
  const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
  if (!health.capabilities?.includes("grocery-receipts-v1")) throw new Error("Update the PC worker to use Groceries. The photos remain on this device; no receipt was sent.");
  return groceryRequest<{ record: GroceryRecord; duplicate: boolean }>(config, "/groceries/import", { sources });
}
export async function reviewGroceries(config: WorkerConfig, record: GroceryRecord, receipt: GroceryReceipt, save: boolean, confirmed: boolean, distinctPurchase: boolean) {
  if (receipt.items.some(line => line.productReference)) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (!health.capabilities?.includes("grocery-purchase-resolution-v1")) throw new Error("Update the PC worker to save product references. No receipt was changed.");
  }
  if (receipt.fulfillment !== undefined) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (!health.capabilities?.includes("grocery-fulfillment-v1")) throw new Error("Update the PC worker to save delivery evidence. No purchase was changed.");
  }
  if (receipt.sourceType !== undefined) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (!health.capabilities?.includes("grocery-source-type-v1")) throw new Error("Update the PC worker to save the source type. Your edits remain on this device.");
  }
  return groceryRequest<GroceryRecord>(config, `/groceries/${record.id}/review`, { receipt, expectedRevision: record.revision, save, confirmed, distinctPurchase });
}
export async function fileSource(file: File): Promise<UploadSource> {
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("Choose JPG, PNG, WebP, PDF or text files, up to 5 MB each. Convert HEIC photos to JPG.");
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Could not read the photo.")); reader.readAsDataURL(file); });
  return { name: file.name, type: file.type, data };
}
