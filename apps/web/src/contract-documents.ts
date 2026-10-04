import type { ContractDocument } from "./savings";
const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
const maxBytes = 5 * 1024 * 1024;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("familyhub.contract-documents.v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Document storage is unavailable in this browser."));
  });
}
async function storedDocument(id: string, blob?: Blob): Promise<Blob | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction("documents", blob ? "readwrite" : "readonly");
    const request = blob ? tx.objectStore("documents").put(blob, id) : tx.objectStore("documents").get(id);
    tx.oncomplete = () => resolve(blob ?? request.result);
    tx.onerror = tx.onabort = () => reject(new Error("Could not save/read the document. Check available device storage."));
  }); } finally { db.close(); }
}
export async function hasContractDocument(id: string): Promise<boolean> { return Boolean(await storedDocument(id)); }
export async function saveContractDocument(file: File): Promise<ContractDocument> {
  if (!allowedTypes.has(file.type) || file.size > maxBytes || file.size === 0) throw new Error("Choose a PDF, PNG, JPG or text file up to 5 MB.");
  const document = { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString() };
  await storedDocument(document.id, file); return document;
}
export async function downloadContractDocument(document: ContractDocument) {
  const blob = await storedDocument(document.id);
  if (!blob) throw new Error("This document is not on this device. Restore a backup containing documents or attach it again.");
  const url = URL.createObjectURL(blob), link = window.document.createElement("a");
  link.href = url; link.download = document.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export type DocumentBackup = { id: string; type: string; data: string };
export async function exportContractDocuments(documents: ContractDocument[]): Promise<DocumentBackup[]> {
  const result: DocumentBackup[] = [];
  for (const document of documents) {
    const blob = await storedDocument(document.id);
    if (!blob) throw new Error(`The attached document ${document.name} is missing on this device. Attach it again before creating a complete backup.`);
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
    result.push({ id: document.id, type: document.type, data });
  }
  return result;
}
export async function restoreContractDocuments(documents: DocumentBackup[]) {
  if (!Array.isArray(documents) || documents.length > 100) throw new Error("Invalid document backup.");
  // Validate the whole set before the first write. Legacy backups without bytes remain readable.
  const blobs = documents.map(document => {
    if (!document || typeof document.id !== "string" || !/^[a-f0-9-]{36}$/.test(document.id) || !allowedTypes.has(document.type) || typeof document.data !== "string" || document.data.length > maxBytes * 1.4) throw new Error("Invalid backed-up document.");
    const bytes = Uint8Array.from(atob(document.data), char => char.charCodeAt(0));
    if (bytes.length > maxBytes) throw new Error("Backed-up document is too large.");
    return { id: document.id, blob: new Blob([bytes], { type: document.type }) };
  });
  for (const { id, blob } of blobs) await storedDocument(id, blob);
}
