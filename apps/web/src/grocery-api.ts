import type { WorkerConfig } from "./types";
import type { GroceryLibrary, GroceryRecord, GroceryReceipt } from "../../worker/src/grocery-model";
export type UploadSource = { name: string; type: string; data: string };
export type SourceBytes = UploadSource & { hash: string; size: number };
export async function groceryRequest<T>(config: WorkerConfig, path: string, body?: unknown): Promise<T> {
  if (!config.Endpoint.trim() || !config.ApiKey.trim()) throw new Error("Appairez votre PC dans Plus → Réglages et outils → Local AI pour conserver les achats du foyer.");
  const evidencePlan = body as { plan?: { purchaseComparisons?: unknown[]; sourceEstimates?: unknown[] } } | undefined;
  if (body !== undefined && path === "/groceries/planning" && (evidencePlan?.plan?.purchaseComparisons?.length || evidencePlan?.plan?.sourceEstimates?.length)) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (evidencePlan?.plan?.purchaseComparisons?.length && !health.capabilities?.includes("grocery-comparison-evidence-v1")) throw new Error("Mettez à jour le worker PC pour conserver les preuves de comparaison. Aucun plan n'a été modifié.");
    if (evidencePlan?.plan?.sourceEstimates?.length && !health.capabilities?.includes("grocery-source-estimates-v1")) throw new Error("Mettez à jour le worker PC pour conserver les prix unitaires source. Aucun plan n'a été modifié.");
  }
  let response: Response;
  try { response = await fetch(config.Endpoint.replace(/\/$/, "") + path, { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-familyhub-key": config.ApiKey.trim() }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000), cache: "no-store", redirect: "error" }); }
  catch { throw new Error("PC inaccessible ou résultat inconnu. Vos sources et corrections locales sont conservées. Actualisez les tickets avant de réessayer."); }
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || "Action Courses indisponible."); }
  return response.json();
}
export const loadGroceries = (config: WorkerConfig) => groceryRequest<GroceryLibrary>(config, "/groceries");
export async function importGroceries(config: WorkerConfig, sources: UploadSource[]) {
  const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
  if (!health.capabilities?.includes("grocery-receipts-v1")) throw new Error("Le worker PC doit être mis à jour pour Courses. Les photos restent sur cet appareil ; aucun ticket n'a été transmis.");
  return groceryRequest<{ record: GroceryRecord; duplicate: boolean }>(config, "/groceries/import", { sources });
}
export async function reviewGroceries(config: WorkerConfig, record: GroceryRecord, receipt: GroceryReceipt, save: boolean, confirmed: boolean, distinctPurchase: boolean) {
  if (receipt.items.some(line => line.productReference)) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (!health.capabilities?.includes("grocery-purchase-resolution-v1")) throw new Error("Mettez à jour le worker PC pour conserver les références produit. Aucun ticket modifié.");
  }
  if (receipt.fulfillment !== undefined) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (!health.capabilities?.includes("grocery-fulfillment-v1")) throw new Error("Mettez à jour le worker PC pour conserver la preuve de livraison. Aucun achat n'a été modifié.");
  }
  if (receipt.sourceType !== undefined) {
    const health = await groceryRequest<{ capabilities?: string[] }>(config, "/health");
    if (!health.capabilities?.includes("grocery-source-type-v1")) throw new Error("Mettez à jour le worker PC pour conserver le type de source. Vos corrections restent sur cet appareil.");
  }
  return groceryRequest<GroceryRecord>(config, `/groceries/${record.id}/review`, { receipt, expectedRevision: record.revision, save, confirmed, distinctPurchase });
}
export async function fileSource(file: File): Promise<UploadSource> {
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("Choisissez JPG, PNG, WebP, PDF ou texte, jusqu'à 5 Mo par source. Convertissez les photos HEIC en JPG.");
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Lecture de la photo impossible.")); reader.readAsDataURL(file); });
  return { name: file.name, type: file.type, data };
}
