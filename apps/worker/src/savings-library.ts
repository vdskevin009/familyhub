import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { validateContract, contractSignature, documentIdPattern, type SharedContract, type SharedDocument } from "./savings-sharing-model.js";
type Library = { schema: 1; records: SharedContract[]; documents: SharedDocument[] };
export class SavingsConflict extends Error {}
export class SavingsLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}
  private async read(): Promise<Library> {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8")) as Library;
      if (stored.schema !== 1 || !Array.isArray(stored.records) || !Array.isArray(stored.documents)) throw new Error();
      for (const record of stored.records) { validateContract(record.contract); if (typeof record.revision !== "string") throw new Error(); }
      return stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: 1, records: [], documents: [] };
      throw new Error("The shared Savings library could not be read. Existing data was not reset.");
    }
  }
  async list() { return { records: (await this.read()).records }; }
  async document(id: string) {
    if (!documentIdPattern.test(id)) throw new Error("Invalid document ID.");
    const library = await this.read();
    return library.records.some(record => record.contract.documents.some(document => document.id === id)) ? library.documents.find(document => document.id === id) : undefined;
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => {}); return result;
  }
  private prepare(library: Library, contracts: ReturnType<typeof validateContract>[], values: unknown) {
    if (!Array.isArray(values) || values.length > 100) throw new Error("Invalid shared document set.");
    const documents = [...library.documents];
    for (const value of values) {
      const metadata = contracts.flatMap(contract => contract.documents).find(document => document.id === value?.id);
      if (!metadata || value.type !== metadata.type || typeof value.data !== "string" || value.data.length > 7_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) throw new Error("Invalid shared document.");
      const bytes = Buffer.from(value.data, "base64");
      if (bytes.length !== metadata.size) throw new Error("Shared document size does not match.");
      const existing = documents.find(document => document.id === value.id);
      if (existing && (existing.type !== value.type || existing.data !== value.data)) throw new SavingsConflict("A different version of this document is already saved. Attach the new file separately.");
      if (!existing) documents.push({ id: metadata.id, type: metadata.type, data: value.data });
    }
    for (const contract of contracts) for (const metadata of contract.documents) {
      const document = documents.find(item => item.id === metadata.id);
      if (!document || document.type !== metadata.type || Buffer.from(document.data, "base64").length !== metadata.size) throw new Error("Attach all contract documents before sharing.");
    }
    if (documents.length > 100 || documents.reduce((sum, document) => sum + Buffer.byteLength(document.data, "base64"), 0) > 20 * 1024 * 1024) throw new Error("Shared documents exceed the 20 MB household limit.");
    return documents;
  }
  import(value: { contracts?: unknown; documents?: unknown }) {
    return this.serialized(async () => {
      if (!Array.isArray(value.contracts) || value.contracts.length > 100) throw new Error("Invalid contract import.");
      const contracts = value.contracts.map(validateContract);
      if (new Set(contracts.map(contract => contract.id)).size !== contracts.length) throw new Error("Duplicate contract IDs.");
      const library = await this.read(), records = [...library.records], conflicts: string[] = [];
      const accepted = contracts.filter(contract => {
        const existing = records.find(record => record.contract.id === contract.id);
        if (existing && contractSignature(existing.contract) !== contractSignature(contract)) { conflicts.push(contract.id); return false; }
        return true;
      });
      const incomingDocuments = Array.isArray(value.documents) ? value.documents.filter(document => accepted.some(contract => contract.documents.some(metadata => metadata.id === document?.id))) : value.documents;
      const documents = this.prepare(library, accepted, incomingDocuments);
      for (const contract of accepted) if (!records.some(record => record.contract.id === contract.id)) records.push({ contract, revision: randomUUID() });
      if (records.length > 100) throw new Error("Too many shared contracts.");
      if (records.length !== library.records.length || documents.length !== library.documents.length) await atomicJson(this.path, { schema: 1, records, documents });
      return { records, conflicts };
    });
  }
  update(id: string, value: { contract?: unknown; expectedRevision?: unknown; documents?: unknown }) {
    return this.serialized(async () => {
      const contract = validateContract(value.contract), library = await this.read();
      const existing = library.records.find(record => record.contract.id === id);
      if (contract.id !== id || !existing || value.expectedRevision !== existing.revision) throw new SavingsConflict("This shared contract changed on another device. Your edit remains on this device; refresh and review both versions before sharing it.");
      const documents = this.prepare(library, [contract], value.documents);
      if (contractSignature(existing.contract) === contractSignature(contract)) return { records: library.records };
      const records = library.records.map(record => record === existing ? { contract, revision: randomUUID() } : record);
      await atomicJson(this.path, { schema: 1, records, documents });
      return { records };
    });
  }
}
