import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { GroceryError, type GroceryRecord } from "./grocery-model.js";
import { GroceryConflict } from "./grocery-store.js";
import type { GroceryPlan } from "./grocery-planning.js";
import { purchaseLineKey } from "./grocery-purchase-evidence.js";
import { emptyPurchaseResolution, purchaseCandidateReason, validatePurchaseCandidate, validatePurchaseResolution, type PurchaseResolution } from "./grocery-purchase-resolution.js";

/** Separate derived evidence: never writes a receipt, a shopping plan, a price or a notification. */
export class GroceryPurchaseResolutionStore {
  private queue: Promise<unknown> = Promise.resolve();
  private path: string;
  constructor(directory: string, private records: () => Promise<{ records: GroceryRecord[] }>, private plan: () => Promise<GroceryPlan>) { this.path = join(directory, "purchase-resolution.json"); }
  async read(): Promise<PurchaseResolution> {
    try { const raw = await readFile(this.path, "utf8"); if (Buffer.byteLength(raw) > 6_000_000) throw new GroceryError("Fichier de résolution trop volumineux."); return validatePurchaseResolution(JSON.parse(raw)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyPurchaseResolution(); throw new GroceryError("Les confirmations de comparaison sont illisibles. Le fichier est conservé."); }
  }
  mutate(value: unknown, now = new Date()) {
    const run = this.queue.then(async () => {
      const state = await this.read(), body = value as Record<string, unknown>;
      if (!body || body.expectedRevision !== state.revision) throw new GroceryConflict("Les confirmations ont changé. Actualisez avant de réessayer.");
      if (body.action === "add-candidates") {
        if (Object.keys(body).some(k => !["action", "expectedRevision", "candidates"].includes(k)) || !Array.isArray(body.candidates) || !body.candidates.length || body.candidates.length > 20) throw new GroceryError("Lot de candidats invalide.");
        const candidates = body.candidates.map(validatePurchaseCandidate), [library, plan] = await Promise.all([this.records(), this.plan()]);
        for (const c of candidates) {
          const old = state.candidates.find(x => x.id === c.id);
          if (old) { if (JSON.stringify(old) !== JSON.stringify(c)) throw new GroceryConflict("La preuve candidate conservée ne peut pas être remplacée."); continue; }
          const record = library.records.find(r => r.id === c.recordId), reason = record ? purchaseCandidateReason(c, record, now.getTime()) : "Achat source absent.";
          if (reason) throw new GroceryError(reason);
          if (c.itemId && !plan.items.some(i => i.id === c.itemId)) throw new GroceryError("Article du catalogue absent.");
          state.candidates.push(c);
        }
      } else if (body.action === "confirm" || body.action === "unconfirm") {
        if (Object.keys(body).some(k => !["action", "expectedRevision", "id", "confirmed", "confirmationEvidence"].includes(k)) || typeof body.id !== "string") throw new GroceryError("Décision de comparaison invalide.");
        const c = state.candidates.find(x => x.id === body.id);
        if (!c) throw new GroceryError("Candidat absent. Actualisez les achats.");
        if (body.action === "confirm") {
          if (body.confirmed !== true) throw new GroceryError("Confirmez explicitement le produit et le format de cet achat.");
          const record = (await this.records()).records.find(r => r.id === c.recordId), reason = record ? purchaseCandidateReason(c, record, now.getTime()) : "Achat source absent.";
          if (reason) throw new GroceryError(reason);
          if (c.size === null || c.unit === null) throw new GroceryError("Le format public ne suffit pas pour confirmer une quantité comparable.");
          if (state.candidates.some(x => x.id !== c.id && x.recordId === c.recordId && x.lineIndex === c.lineIndex && state.decisions[x.id]?.state === "confirmed")) throw new GroceryConflict("Retirez la confirmation précédente avant de choisir un autre candidat.");
        }
        const evidence = body.confirmationEvidence as { at?: unknown; source?: unknown } | undefined;
        if (evidence !== undefined && (!evidence || typeof evidence.at !== "string" || !Number.isFinite(Date.parse(evidence.at)) || new Date(evidence.at).toISOString() !== evidence.at || Date.parse(evidence.at) > now.getTime() || typeof evidence.source !== "string" || !evidence.source.trim() || evidence.source.length > 1000)) throw new GroceryError("Provenance de la confirmation invalide.");
        state.decisions[c.id] = { state: body.action === "confirm" ? "confirmed" : "unconfirmed", at: now.toISOString(), ...(body.action === "confirm" ? { evidence: evidence ? { at: evidence.at as string, source: evidence.source as string } : { at: now.toISOString(), source: "Confirmation explicite dans FamilyHub" } } : {}) };
      } else throw new GroceryError("Action de comparaison inconnue.");
      const validated = validatePurchaseResolution(state); validated.revision = randomUUID(); await atomicJson(this.path, validated); return validated;
    });
    this.queue = run.catch(() => {}); return run;
  }
  /** Existing scanner only: bounded local enrichment, never a retailer request or a name/price guess. */
  reconcile(now = new Date()) {
    const run = this.queue.then(async () => {
      const state = await this.read(), library = await this.records(); let changed = false;
      const rules = state.candidates.filter(c => !c.reusedFrom && state.decisions[c.id]?.state === "confirmed" && library.records.some(r => r.id === c.recordId && !purchaseCandidateReason(c, r, now.getTime())));
      for (const record of library.records.filter(r => r.status === "saved" && !r.duplicateOf && r.extraction === "complete")) {
        for (const [lineIndex, line] of record.receipt.items.entries()) {
          if (!line.productReference || line.productReference.provider !== "pcexpress") continue;
          if (state.candidates.some(c => c.recordId === record.id && c.lineIndex === lineIndex && c.lineKey === purchaseLineKey(line) && state.decisions[c.id]?.state === "confirmed")) continue;
          const matches = rules.filter(c => c.productId === line.productReference!.id);
          const formats = new Set(matches.map(c => JSON.stringify([c.size, c.unit, c.formatBasis])));
          // Keep the most recent public proof per physical format; conflicting formats need a choice.
          const distinct = matches.slice().sort((a, b) => b.observedAt.localeCompare(a.observedAt)).filter((c, i, rows) => rows.findIndex(x => x.size === c.size && x.unit === c.unit && x.formatBasis === c.formatBasis) === i);
          for (const rule of distinct) {
            const id = "reuse-" + createHash("sha256").update(JSON.stringify([record.id, lineIndex, purchaseLineKey(line), rule.id])).digest("hex").slice(0,48);
            if (state.candidates.some(c => c.id === id) || state.candidates.length >= 500) continue;
            const c = { ...rule, id, recordId: record.id, lineIndex, lineKey: purchaseLineKey(line), reusedFrom: rule.id, note: ("Même référence produit explicite dans la source. Preuve réutilisée sans redater : " + rule.note).slice(0,1000) };
            state.candidates.push(c); changed = true;
            const age = now.getTime() - Date.parse(rule.observedAt);
            if (formats.size === 1 && c.formatBasis === "public-source" && c.size !== null && c.unit !== null && age >= 0 && age <= 7 * 86400000 && !purchaseCandidateReason(c, record, now.getTime())) state.decisions[id] = { state: "confirmed", at: now.toISOString(), evidence: { at: now.toISOString(), source: "Réutilisation automatique : même référence PC Express explicite ; format public confirmé précédemment, preuve de sept jours au maximum. Aucun prix ni montant payé repris." } };
          }
        }
      }
      if (!changed) return state;
      const next = validatePurchaseResolution(state); next.revision = randomUUID(); await atomicJson(this.path, next); return next;
    });
    this.queue = run.catch(() => {}); return run;
  }
}
