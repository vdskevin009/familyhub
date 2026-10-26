import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { GroceryError, emptyReceipt, validateReceipt, possibleDuplicates, type GroceryRecord, type GrocerySource, type GroceryReceipt } from "./grocery-model.js";
import { pcExpressLocalDate, type PcExpressMessage } from "./pc-express-mail.js";
export class GroceryConflict extends GroceryError {}
export type StoredGrocerySource = GrocerySource & { data: string };
type State = { schema: 1; records: GroceryRecord[]; sources: StoredGrocerySource[] };
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9-]{36}$/;
const timestamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function validAutomaticImport(r: GroceryRecord): boolean {
  const a = r.automaticImport;
  return !!a && a.kind === "pc-express-gmail" && timestamp(a.importedAt)
    && /^\d{15}$/.test(a.orderId) && Array.isArray(a.sourceMessageIds)
    && a.sourceMessageIds.length === 2 && new Set(a.sourceMessageIds).size === 2
    && a.sourceMessageIds.every(id => typeof id === "string" && /^[a-f0-9]{8,64}$/i.test(id));
}
export function validateSource(value: unknown): StoredGrocerySource {
  if (!value || typeof value !== "object") throw new GroceryError("Source invalide.");
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 200 || typeof v.data !== "string" || v.data.length > 7_000_000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.data)) throw new GroceryError("Source invalide.");
  const bytes = Buffer.from(v.data, "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new GroceryError("Chaque source doit faire entre 1 octet et 5 Mo.");
  const type = v.type;
  const valid = type === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : type === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
    : type === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : type === "text/plain" ? !bytes.includes(0) : false;
  if (!valid) throw new GroceryError("Format non reconnu. Choisissez JPG, PNG, WebP, PDF ou texte.");
  return { hash: createHash("sha256").update(bytes).digest("hex"), name: v.name.trim(), type: type as string, size: bytes.length, data: v.data };
}
export class GroceryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private running = new Set<string>();
  private path: string;
  constructor(private directory: string, private extractor: (sources: StoredGrocerySource[], directory: string) => Promise<GroceryReceipt>) { this.path = join(directory, "purchases.json"); }
  private async read(): Promise<State> {
    try {
      const state: State = JSON.parse(await readFile(this.path, "utf8"));
      if (state.schema !== 1 || !Array.isArray(state.records) || state.records.length > 2000 || !Array.isArray(state.sources)) throw new GroceryError();
      for (const s of state.sources) if (validateSource(s).hash !== s.hash) throw new GroceryError();
      if (new Set(state.records.map(r => r.id)).size !== state.records.length || new Set(state.sources.map(s => s.hash)).size !== state.sources.length) throw new GroceryError();
      for (const r of state.records) {
        if (!idPattern.test(r.id) || !idPattern.test(r.revision) || !["saved", "draft"].includes(r.status) || !["pending", "running", "complete", "failed"].includes(r.extraction)
          || !timestamp(r.createdAt) || r.reviewedAt !== null && !timestamp(r.reviewedAt)
          || r.automaticImport !== undefined && !validAutomaticImport(r)
          || r.status === "saved" && r.reviewedAt === null && !(validAutomaticImport(r) && r.receipt.sourceType === "confirmation"
            && r.receipt.reference === r.automaticImport!.orderId && r.receipt.fulfillment && r.receipt.items.length)
          || r.duplicateOf !== null && (r.status !== "draft" || r.duplicateOf === r.id || !state.records.some(target => target.id === r.duplicateOf && target.status === "saved"))
          || !Array.isArray(r.sources) || !r.sources.length || r.sources.some(s => !hashPattern.test(s.hash) || typeof s.name !== "string" || !s.name.trim() || s.name.length > 200 || !state.sources.some(other => other.hash === s.hash && other.type === s.type && other.size === s.size))) throw new GroceryError();
        validateReceipt(r.receipt);
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: 1, records: [], sources: [] };
      throw new GroceryError("La base Courses est illisible. Elle a été préservée ; restaurez une copie valide sur le PC.");
    }
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> { const result = this.queue.then(action); this.queue = result.catch(() => {}); return result; }
  private async persist(state: State) {
    if (state.records.length > 2000 || state.sources.reduce((s, x) => s + x.size, 0) > 100 * 1024 * 1024) throw new GroceryError("La base Courses atteint sa limite (2 000 tickets / 100 Mo). Sauvegardez-la sur le PC avant de poursuivre.");
    await atomicJson(this.path, state);
  }
  async list() {
    const state = await this.read();
    return { records: state.records.map(r => r.extraction === "running" && !this.running.has(r.id) ? { ...r, extraction: "failed" as const } : r) };
  }
  async source(id: string, hash: string) {
    if (!idPattern.test(id) || !hashPattern.test(hash)) throw new GroceryError("Source invalide.");
    const state = await this.read();
    return state.records.find(r => r.id === id)?.sources.some(s => s.hash === hash) ? state.sources.find(s => s.hash === hash) : undefined;
  }
  /** Internal collector path. Append only; never reinterpret a phone/manual edit as automatic authority. */
  importDeliveredConfirmation(messages: PcExpressMessage[]) {
    return this.serialized(async () => {
      if (messages.length !== 2 || messages.some(m => !timestamp(m.receivedAt) || !m.accountId || !/^\d{15}$/.test(m.orderId)
        || !/^[a-f0-9]{8,64}$/i.test(m.messageId)) || new Set(messages.map(m => m.accountId)).size !== 1
        || new Set(messages.map(m => m.orderId)).size !== 1 || new Set(messages.map(m => m.messageId)).size !== 2)
        throw new GroceryError("Preuves de commande incompatibles.");
      const confirmation = messages.find(m => m.kind === "confirmation"), delivery = messages.find(m => m.kind === "delivered");
      if (!confirmation?.receipt || !delivery || delivery.receivedAt < confirmation.receivedAt)
        throw new GroceryError("Confirmation et livraison de la même commande requises.");
      const receipt = validateReceipt({ ...confirmation.receipt, fulfillment: {
        date: pcExpressLocalDate(delivery.receivedAt),
        evidence: `Gmail ${delivery.messageId}: avis de livraison de la commande ${delivery.orderId}; date locale America/Vancouver de réception ${delivery.receivedAt}. Total et lignes restent ceux de la confirmation estimée.`
      } });
      if (receipt.sourceType !== "confirmation" || receipt.store !== "PC Express" || receipt.reference !== confirmation.orderId
        || receipt.currency !== "CAD" || !receipt.date || !receipt.items.length || receipt.total === null
        || receipt.items.some(item => !item.name || item.quantity === null))
        throw new GroceryError("Confirmation complète requise pour l'import automatique.");
      const incoming = messages.map(m => validateSource(m.source));
      if (new Set(incoming.map(s => s.hash)).size !== 2) throw new GroceryError("Deux preuves distinctes requises.");
      const state = await this.read();
      const matching = state.records.filter(r => r.receipt.reference.trim() === confirmation.orderId
        || r.automaticImport?.orderId === confirmation.orderId || incoming.some(s => r.sources.some(x => x.hash === s.hash)));
      if (matching.length) {
        const existing = matching[0];
        // A uniquely reviewed order is already represented, including the manual catch-up.
        // Acknowledge coverage without attaching evidence or reinterpreting corrected facts.
        const protectedOrder = matching.length === 1 && existing.status === "saved" && existing.reviewedAt !== null
          && !existing.duplicateOf && existing.receipt.reference.trim() === confirmation.orderId;
        const same = matching.length === 1 && existing.automaticImport && existing.status === "saved" && existing.reviewedAt === null
          && JSON.stringify(existing.receipt) === JSON.stringify(receipt) && incoming.every(s => existing.sources.some(x => x.hash === s.hash));
        return { record: existing, outcome: same || protectedOrder ? "unchanged" as const : "conflict" as const };
      }
      const now = new Date().toISOString();
      const record: GroceryRecord = { id: randomUUID(), revision: randomUUID(), status: "saved", createdAt: now,
        sources: incoming.map(({ data: _data, ...metadata }) => metadata), receipt, extraction: "complete", reviewedAt: null, duplicateOf: null,
        automaticImport: { kind: "pc-express-gmail", importedAt: now, orderId: confirmation.orderId, sourceMessageIds: messages.map(m => m.messageId) } };
      state.records.push(record);
      for (const source of incoming) if (!state.sources.some(s => s.hash === source.hash)) state.sources.push(source);
      await this.persist(state);
      return { record, outcome: "imported" as const };
    });
  }
  import(value: { sources?: unknown }) {
    return this.serialized(async () => {
      if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 8) throw new GroceryError("Choisissez de 1 à 8 photos d'un même ticket.");
      const incoming = [...new Map(value.sources.map(validateSource).map(s => [s.hash, s])).values()];
      if (incoming.reduce((s, x) => s + x.size, 0) > 20 * 1024 * 1024) throw new GroceryError("Un ticket doit faire au maximum 20 Mo.");
      const state = await this.read();
      const existing = state.records.find(r => (r.sources.length === incoming.length || r.status === "saved") && incoming.every(s => r.sources.some(x => x.hash === s.hash)));
      if (existing) return { record: existing.duplicateOf ? state.records.find(r => r.id === existing.duplicateOf)! : existing, duplicate: true };
      if (state.records.some(r => incoming.some(s => r.sources.some(x => x.hash === s.hash)))) throw new GroceryConflict("Une photo appartient déjà à un autre ticket. Ouvrez le ticket existant ; ne l'enregistrez pas à nouveau.");
      const record: GroceryRecord = { id: randomUUID(), revision: randomUUID(), status: "draft", createdAt: new Date().toISOString(),
        sources: incoming.map(({ data: _data, ...metadata }) => metadata), receipt: emptyReceipt(), extraction: "pending", reviewedAt: null, duplicateOf: null };
      state.records.push(record);
      for (const s of incoming) if (!state.sources.some(x => x.hash === s.hash)) state.sources.push(s);
      await this.persist(state); return { record, duplicate: false };
    });
  }
  review(id: string, value: { receipt?: unknown; expectedRevision?: unknown; save?: unknown; confirmed?: unknown; distinctPurchase?: unknown }) {
    return this.serialized(async () => {
      const receipt = validateReceipt(value.receipt), state = await this.read(), r = state.records.find(r => r.id === id);
      if (!r || value.expectedRevision !== r.revision) throw new GroceryConflict("Le ticket a changé sur le PC. Vos corrections restent affichées ; actualisez et comparez avant de réessayer.");
      if (this.running.has(id)) throw new GroceryConflict("L'extraction est en cours. Attendez son résultat avant de corriger.");
      if (r.duplicateOf) throw new GroceryConflict("Ce ticket est rattaché à un achat existant.");
      if ((value.save === true || r.status === "saved") && (value.confirmed !== true || !receipt.items.length || receipt.items.some(i => !i.name))) throw new GroceryError("Ajoutez les produits et confirmez la revue des sources et des incertitudes.");
      if ((value.save === true || r.status === "saved") && possibleDuplicates({ ...r, receipt }, state.records).length && value.distinctPurchase !== true) throw new GroceryConflict("Même magasin, date, devise et total qu'un achat enregistré. Ouvrez-le ou confirmez qu'il s'agit d'un achat distinct.");
      r.receipt = receipt; r.revision = randomUUID();
      if (value.save === true) r.status = "saved";
      if ((r.status === "saved" && r.reviewedAt === null) || value.save === true) r.reviewedAt = new Date().toISOString();
      await this.persist(state); return r;
    });
  }
  linkDuplicate(id: string, value: { expectedRevision?: unknown; targetId?: unknown }) {
    return this.serialized(async () => {
      const state = await this.read(), r = state.records.find(r => r.id === id), target = state.records.find(r => r.id === value.targetId);
      if (!r || r.status !== "draft" || r.revision !== value.expectedRevision || !target || target.status !== "saved" || !possibleDuplicates(r, [target]).length || this.running.has(id)) throw new GroceryConflict("Actualisez les tickets avant de rattacher le doublon.");
      for (const source of r.sources) if (!target.sources.some(s => s.hash === source.hash)) target.sources.push(source);
      target.revision = randomUUID(); r.duplicateOf = target.id; r.revision = randomUUID();
      await this.persist(state); return target;
    });
  }
  async extract(id: string, value: { expectedRevision?: unknown }) {
    const start = await this.serialized(async () => {
      const state = await this.read(), r = state.records.find(r => r.id === id);
      if (!r || r.revision !== value.expectedRevision || r.status !== "draft" || r.duplicateOf || this.running.has(id) || r.receipt.items.length) throw new GroceryConflict("Actualisez le ticket. L'extraction ne remplace pas des corrections ou un achat enregistré.");
      if (this.running.size) throw new GroceryConflict("Une extraction est en cours sur le PC. Réessayez après son résultat.");
      r.extraction = "running"; await this.persist(state); this.running.add(id);
      return r.sources.map(s => state.sources.find(x => x.hash === s.hash)!);
    });
    try {
      await mkdir(this.directory, { recursive: true });
      const receipt = validateReceipt(await this.extractor(start, this.directory));
      return await this.finishExtraction(id, receipt);
    } catch { await this.finishExtraction(id, null); throw new GroceryError("Extraction indisponible. Les sources sont conservées. Actualisez puis réessayez ou saisissez les produits."); }
    finally { this.running.delete(id); }
  }
  private finishExtraction(id: string, receipt: GroceryReceipt | null) {
    return this.serialized(async () => {
      const state = await this.read(), r = state.records.find(r => r.id === id)!;
      if (receipt) r.receipt = receipt;
      r.extraction = receipt ? "complete" : "failed"; r.revision = randomUUID(); await this.persist(state); return r;
    });
  }
}
