import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SOURCE_INVENTORY_LIMITS, SourceInventoryError, validateFinanceSourceInventory, type FinanceSourceInventory, type FinanceSourceInventoryState } from "./finance-source-inventory-model.js";
export type { FinanceSourceInventoryState } from "./finance-source-inventory-model.js";

/** Raw provider IDs are used only in memory to derive a namespaced display identity. Never persist them. */
export function financeSourceKey(kind: "account" | "prediction", itemId: string, recordId: string): string {
  if (!["account", "prediction"].includes(kind) || [itemId, recordId].some(value => typeof value !== "string" || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))) throw new SourceInventoryError("Identité source invalide.");
  return "fsi_" + createHash("sha256").update(JSON.stringify(["finances-plugin", kind, itemId, recordId])).digest("hex");
}
const revisionOf = (snapshot: FinanceSourceInventory) => createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
export class SourceInventoryConflict extends SourceInventoryError {}

/** Caller supplies the existing PRIVATE worker data directory, never a repository/public web directory.
 * One worker-owned instance; serialized/revision-checked writes to an isolated sidecar only.
 * This module performs no collection, network, canonical-ledger write or runtime registration.
 */
export class FinanceSourceInventoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  constructor(privateDirectory: string) { this.path = join(privateDirectory, "finance", "source-inventory.json"); }
  async preview(value: unknown, expectedRevision: string, now = new Date()) {
    const snapshot = validateFinanceSourceInventory(value, now), current = await this.read(now), revision = revisionOf(snapshot);
    if (typeof expectedRevision !== "string" || expectedRevision !== current.revision) throw new SourceInventoryConflict("L'inventaire a changé. Actualisez avant de réessayer.");
    if (revision !== current.revision && current.snapshot && Date.parse(snapshot.collectedAt) <= Date.parse(current.snapshot.collectedAt)) throw new SourceInventoryConflict("Cette collecte est antérieure ou contradictoire. L'inventaire conservé est inchangé.");
    return { snapshot, proposedRevision: revision, alreadyImported: revision === current.revision };
  }
  async read(now = new Date()): Promise<FinanceSourceInventoryState> {
    let file;
    try {
      file = await open(this.path, "r");
      if ((await file.stat()).size > SOURCE_INVENTORY_LIMITS.bytes + 256) throw new SourceInventoryError("Inventaire trop volumineux.");
      // Bound the actual read as well as stat, including a file that grows between the two.
      const bytes = Buffer.alloc(SOURCE_INVENTORY_LIMITS.bytes + 257);
      let length = 0;
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > SOURCE_INVENTORY_LIMITS.bytes + 256) throw new SourceInventoryError("Inventaire trop volumineux.");
      const value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "revision,snapshot") throw new SourceInventoryError("Inventaire invalide.");
      const snapshot = validateFinanceSourceInventory(value.snapshot, now), revision = revisionOf(snapshot);
      if (value.revision !== revision) throw new SourceInventoryError("Révision de l'inventaire invalide.");
      return { revision, snapshot };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: "empty", snapshot: null };
      throw new SourceInventoryError("L'inventaire source est illisible. Le fichier est conservé.");
    } finally { await file?.close(); }
  }
  save(value: unknown, expectedRevision: string, now = new Date()): Promise<FinanceSourceInventoryState> {
    // Clone/validate before queueing, so a caller cannot change an awaiting operation's content.
    let snapshot: FinanceSourceInventory;
    try { snapshot = validateFinanceSourceInventory(value, now); }
    catch (error) { return Promise.reject(error); }
    const run = this.queue.then(async () => {
      const current = await this.read(now);
      if (typeof expectedRevision !== "string" || expectedRevision !== current.revision) throw new SourceInventoryConflict("L'inventaire a changé. Actualisez avant de réessayer.");
      const revision = revisionOf(snapshot);
      if (revision === current.revision) return current;
      if (current.snapshot && Date.parse(snapshot.collectedAt) <= Date.parse(current.snapshot.collectedAt)) throw new SourceInventoryConflict("Cette collecte est antérieure ou contradictoire. L'inventaire conservé est inchangé.");
      const state = { revision, snapshot };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = this.path + "." + randomUUID() + ".tmp";
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(state), "utf8"); await file.sync(); } finally { await file.close(); }
        await rename(temporary, this.path);
      } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
      const confirmed = await this.read(now);
      if (confirmed.revision !== revision) throw new SourceInventoryError("Enregistrement de l'inventaire non confirmé. Relisez avant de réessayer.");
      return confirmed;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
