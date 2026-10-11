import { validateContract } from "../../worker/src/savings-sharing-model";
import type { SavingsContract } from "./savings";
import { hasContractDocument, restoreContractDocuments, type DocumentBackup } from "./contract-documents";

const maxImportBytes = 12 * 1024 * 1024;
const format = "familyhub.savings-contract-import";

type ContractBundle = {
  kind: typeof format;
  schemaVersion: 1;
  contract: SavingsContract;
  documents: DocumentBackup[];
};

/**
 * A deliberately additive, device-local import. Never restore a whole FamilyHub
 * backup, replace a contract, change worker settings, or contact outside services.
 */
export async function importSavingsContractBundle(file: File, existing: SavingsContract[]): Promise<SavingsContract> {
  if (file.size === 0 || file.size > maxImportBytes || !/\.json$/i.test(file.name)) {
    throw new Error("Choose a FamilyHub contract JSON file (up to 12 MB).");
  }
  const raw = await file.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("This is not a valid JSON contract import file."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid FamilyHub contract import.");
  const bundle = parsed as Partial<ContractBundle>;
  if (bundle.kind !== format || bundle.schemaVersion !== 1 || !Array.isArray(bundle.documents)) {
    throw new Error("Unsupported FamilyHub contract import. Existing data was not changed.");
  }
  const contract = validateContract(bundle.contract);
  if (existing.some(item => item.id === contract.id)) {
    throw new Error("This contract already exists. Import stopped without replacing the saved version.");
  }
  if (contract.documents.length !== bundle.documents.length) {
    throw new Error("Document metadata and attachments do not match. Nothing was imported.");
  }
  const expected = new Map(contract.documents.map(doc => [doc.id, doc]));
  const seen = new Set<string>();
  for (const doc of bundle.documents) {
    if (!doc || typeof doc.id !== "string" || seen.has(doc.id)) throw new Error("Duplicate or invalid document in the import.");
    seen.add(doc.id);
    const meta = expected.get(doc.id);
    if (!meta || doc.type !== meta.type || typeof doc.data !== "string" ||
        doc.data.length > Math.ceil(meta.size / 3) * 4 + 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(doc.data)) {
      throw new Error("Contract document mismatch. Nothing was imported.");
    }
    let decoded: string;
    try { decoded = atob(doc.data); }
    catch { throw new Error("Invalid encoded document in import. Nothing was imported."); }
    if (decoded.length !== meta.size) throw new Error("Document size mismatch. Nothing was imported.");
    if (meta.type === "application/pdf" && !decoded.startsWith("%PDF-")) {
      throw new Error("A listed PDF is not a PDF document. Nothing was imported.");
    }
    if (await hasContractDocument(doc.id)) {
      throw new Error("An attachment ID already exists on this device. Import stopped to protect existing documents.");
    }
  }
  // Validate every byte before storing any file. Store attachments before the
  // caller adds the contract, so no saved contract points at missing bytes.
  await restoreContractDocuments(bundle.documents);
  return contract;
}
