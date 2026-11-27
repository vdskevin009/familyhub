import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { GroceryError, type GroceryRecord } from "./grocery-model.js";
import { GroceryConflict } from "./grocery-store.js";
import type { GroceryPlan } from "./grocery-planning.js";
import { purchaseLineKey, purchasePriceKey } from "./grocery-purchase-evidence.js";
import { emptyPurchaseResolution, purchaseCandidateReason, validatePurchaseCandidate, validatePurchaseResolution, type PurchaseResolution } from "./grocery-purchase-resolution.js";
import { validateScenarioHints, validateReferenceLeads } from "./grocery-purchase-scenario-model.js";
import { derivePurchaseScenarios } from "./grocery-purchase-scenarios.js";

/** Separate derived evidence: never writes a receipt, a shopping plan, a price or a notification. */
export class GroceryPurchaseResolutionStore {
  private queue: Promise<unknown> = Promise.resolve();
  private path: string;
  constructor(directory: string, private records: () => Promise<{ records: GroceryRecord[] }>, private plan: () => Promise<GroceryPlan>) { this.path = join(directory, "purchase-resolution.json"); }
  async read(): Promise<PurchaseResolution> {
    try { const raw = await readFile(this.path, "utf8"); if (Buffer.byteLength(raw) > 6_000_000) throw new GroceryError("The resolution file is too large."); return validatePurchaseResolution(JSON.parse(raw)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyPurchaseResolution(); throw new GroceryError("The comparison confirmations cannot be read. The file was retained."); }
  }
  mutate(value: unknown, now = new Date()) {
    const run = this.queue.then(async () => {
      const state = await this.read(), body = value as Record<string, unknown>;
      if (!body || body.expectedRevision !== state.revision) throw new GroceryConflict("The confirmations changed. Refresh before retrying.");
      if (body.action === "add-candidates") {
        if (Object.keys(body).some(k => !["action", "expectedRevision", "candidates"].includes(k)) || !Array.isArray(body.candidates) || !body.candidates.length || body.candidates.length > 20) throw new GroceryError("Invalid candidate batch.");
        const candidates = body.candidates.map(validatePurchaseCandidate), [library, plan] = await Promise.all([this.records(), this.plan()]);
        for (const c of candidates) {
          const old = state.candidates.find(x => x.id === c.id);
          if (old) { if (JSON.stringify(old) !== JSON.stringify(c)) throw new GroceryConflict("The saved candidate evidence cannot be replaced."); continue; }
          const record = library.records.find(r => r.id === c.recordId), reason = record ? purchaseCandidateReason(c, record, now.getTime()) : "Achat source absent.";
          if (reason) throw new GroceryError(reason);
          if (c.itemId && !plan.items.some(i => i.id === c.itemId)) throw new GroceryError("Catalogue item not found.");
          state.candidates.push(c);
        }
      } else if (body.action === "add-scenario-hints") {
        if (Object.keys(body).some(k => !["action", "expectedRevision", "hints", "reviewedSources"].includes(k)) || body.reviewedSources !== true || !Array.isArray(body.hints) || !body.hints.length || body.hints.length > 20) throw new GroceryError("Reviewed estimate sources are required.");
        const hints = validateScenarioHints(body.hints), plan = await this.plan();
        state.scenarioHints ??= [];
        for (const hint of hints) {
          if (Date.parse(hint.observedAt) > now.getTime()) throw new GroceryError("The reference date is in the future.");
          if (hint.purpose !== "source-format" && !plan.prices.some(p => p.id === hint.priceId && purchasePriceKey(p) === hint.priceKey)) throw new GroceryError("The reference price is missing or has changed.");
          const old = state.scenarioHints.find(h => h.id === hint.id);
          if (old) { if (JSON.stringify(old) !== JSON.stringify(hint)) throw new GroceryConflict("A saved estimate reference cannot be replaced."); } else state.scenarioHints.push(hint);
        }
      } else if (body.action === "add-reference-leads") {
        if (Object.keys(body).some(k => !["action", "expectedRevision", "leads", "reviewedSources"].includes(k)) || body.reviewedSources !== true || !Array.isArray(body.leads) || !body.leads.length || body.leads.length > 20) throw new GroceryError("Reviewed, documented leads are required.");
        const leads = validateReferenceLeads(body.leads); state.referenceLeads ??= [];
        for (const lead of leads) {
          if (lead.date > now.toISOString().slice(0,10)) throw new GroceryError("The lead date is in the future.");
          const old = state.referenceLeads.find(x => x.id === lead.id);
          if (old) { if (JSON.stringify(old) !== JSON.stringify(lead)) throw new GroceryConflict("A saved lead cannot be replaced."); } else state.referenceLeads.push(lead);
        }
      } else if (body.action === "confirm" || body.action === "unconfirm") {
        if (Object.keys(body).some(k => !["action", "expectedRevision", "id", "confirmed", "confirmationEvidence"].includes(k)) || typeof body.id !== "string") throw new GroceryError("Invalid comparison decision.");
        const c = state.candidates.find(x => x.id === body.id);
        if (!c) throw new GroceryError("Candidate not found. Refresh Purchases.");
        if (body.action === "confirm") {
          if (body.confirmed !== true) throw new GroceryError("Confirm the product and pack size for this purchase.");
          const record = (await this.records()).records.find(r => r.id === c.recordId), reason = record ? purchaseCandidateReason(c, record, now.getTime()) : "Achat source absent.";
          if (reason) throw new GroceryError(reason);
          if (c.size === null || c.unit === null) throw new GroceryError("The public pack size is not enough to confirm a comparable quantity.");
          if (state.candidates.some(x => x.id !== c.id && x.recordId === c.recordId && x.lineIndex === c.lineIndex && state.decisions[x.id]?.state === "confirmed")) throw new GroceryConflict("Remove the previous confirmation before choosing another candidate.");
        }
        const evidence = body.confirmationEvidence as { at?: unknown; source?: unknown } | undefined;
        if (evidence !== undefined && (!evidence || typeof evidence.at !== "string" || !Number.isFinite(Date.parse(evidence.at)) || new Date(evidence.at).toISOString() !== evidence.at || Date.parse(evidence.at) > now.getTime() || typeof evidence.source !== "string" || !evidence.source.trim() || evidence.source.length > 1000)) throw new GroceryError("Invalid confirmation evidence.");
        state.decisions[c.id] = { state: body.action === "confirm" ? "confirmed" : "unconfirmed", at: now.toISOString(), ...(body.action === "confirm" ? { evidence: evidence ? { at: evidence.at as string, source: evidence.source as string } : { at: now.toISOString(), source: "Confirmation explicite dans FamilyHub" } } : {}) };
      } else throw new GroceryError("Unknown comparison action.");
      const validated = validatePurchaseResolution(state); validated.revision = randomUUID(); if (Buffer.byteLength(JSON.stringify(validated)) > 6_000_000) throw new GroceryError("Evidence limit reached. Existing data was retained."); await atomicJson(this.path, validated); return validated;
    });
    this.queue = run.catch(() => {}); return run;
  }
  /** Existing scanner only: bounded local enrichment, never a retailer request or a name/price guess. */
  reconcile(now = new Date()) {
    const run = this.queue.then(async () => {
      const state = await this.read(), library = await this.records(); let changed = false;
      const rules = state.candidates.filter(c => !c.reusedFrom && state.decisions[c.id]?.state === "confirmed" && library.records.some(r => r.id === c.recordId && !purchaseCandidateReason(c, r, now.getTime())));
      for (const c of state.candidates) {
        const d = state.decisions[c.id];
        if (c.reusedFrom && d?.state === "confirmed" && d.evidence?.source.startsWith("Réutilisation automatique :") && !rules.some(rule => rule.id === c.reusedFrom)) {
          state.decisions[c.id] = { state: "unconfirmed", at: now.toISOString(), evidence: { at: now.toISOString(), source: "Réutilisation suspendue : la confirmation ou la ligne source a changé. Preuve candidate conservée ; nouvelle validation nécessaire." } }; changed = true;
        }
      }
      for (const record of library.records.filter(r => r.status === "saved" && !r.duplicateOf && r.extraction === "complete")) {
        for (const [lineIndex, line] of record.receipt.items.entries()) {
          if (!line.productReference || line.productReference.provider !== "pcexpress") continue;
          if (state.candidates.some(c => c.recordId === record.id && c.lineIndex === lineIndex && c.lineKey === purchaseLineKey(line) && state.decisions[c.id]?.state === "confirmed")) continue;
          const withdrawn = state.candidates.some(c => c.recordId === record.id && c.lineIndex === lineIndex && c.lineKey === purchaseLineKey(line) && state.decisions[c.id]?.state === "unconfirmed");
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
            if (!withdrawn && formats.size === 1 && c.formatBasis === "public-source" && c.size !== null && c.unit !== null && age >= 0 && age <= 7 * 86400000 && !purchaseCandidateReason(c, record, now.getTime())) state.decisions[id] = { state: "confirmed", at: now.toISOString(), evidence: { at: now.toISOString(), source: "Réutilisation automatique : même référence PC Express explicite ; format public confirmé précédemment, preuve de sept jours au maximum. Aucun prix ni montant payé repris." } };
          }
        }
      }
      const plan = await this.plan(), today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      const scenarios = derivePurchaseScenarios(library.records, plan, state, today);
      if (JSON.stringify(scenarios) !== JSON.stringify(state.scenarios ?? [])) { state.scenarios = scenarios; changed = true; }
      // Keep the existing bounded private file readable even at the worst schema limits.
      while (state.scenarios?.length && Buffer.byteLength(JSON.stringify(state)) > 5_900_000) { state.scenarios.pop(); changed = true; }
      if (!changed) return state;
      const next = validatePurchaseResolution(state); next.revision = randomUUID(); if (Buffer.byteLength(JSON.stringify(next)) > 6_000_000) throw new GroceryError("Evidence limit reached. Existing data was retained."); await atomicJson(this.path, next); return next;
    });
    this.queue = run.catch(() => {}); return run;
  }
}
