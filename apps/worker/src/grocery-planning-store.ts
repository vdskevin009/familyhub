import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { GroceryError } from "./grocery-model.js";
import { GroceryConflict } from "./grocery-store.js";
import { emptyPlan, validatePlan } from "./grocery-planning.js";
import { purchaseEvidenceReason, sourceEstimateReason } from "./grocery-purchase-evidence.js";
import type { GroceryRecord } from "./grocery-model.js";
export class GroceryPlanningStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private readRecords?: () => Promise<{ records: GroceryRecord[] }>) {}
  async read() {
    try { return validatePlan(JSON.parse(await readFile(join(this.directory, "planning.json"), "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyPlan(); throw new GroceryError("La liste Courses est illisible. Le fichier est préservé sur le PC."); }
  }
  save(value: { plan?: unknown; expectedRevision?: unknown; confirmedComparisonEvidence?: unknown; confirmedSourceEstimates?: unknown }) {
    const result = this.queue.then(async () => {
      const p = validatePlan(value.plan), previous = await this.read();
      if (value.expectedRevision !== previous.revision) throw new GroceryConflict("La liste a changé sur le PC. Votre brouillon reste ici ; comparez-le avec la version PC.");
      const merged = new Map((previous.purchaseComparisons ?? []).map(e => [e.id, e]));
      let sourceRecords: GroceryRecord[] | undefined;
      const estimates = new Map((previous.sourceEstimates ?? []).map(e => [e.id, e]));
      for (const e of p.sourceEstimates ?? []) {
        const old = estimates.get(e.id);
        if (old) { if (JSON.stringify(old) !== JSON.stringify(e)) throw new GroceryConflict("Le prix source conservé ne peut pas être remplacé."); continue; }
        if (value.confirmedSourceEstimates !== true || !this.readRecords) throw new GroceryError("Confirmez explicitement le prix unitaire source.");
        sourceRecords ??= (await this.readRecords()).records;
        const record = sourceRecords.find(r => r.id === e.recordId), reason = record ? sourceEstimateReason(e, record) : "Achat source absent";
        if (reason) throw new GroceryError(reason); estimates.set(e.id, e);
      }
      if (previous.sourceEstimates !== undefined || p.sourceEstimates !== undefined) p.sourceEstimates = [...estimates.values()];
      for (const e of p.purchaseComparisons ?? []) {
        const old = merged.get(e.id);
        if (old) { if (JSON.stringify(old) !== JSON.stringify(e)) throw new GroceryConflict("La preuve conservée ne peut pas être remplacée."); continue; }
        if (value.confirmedComparisonEvidence !== true || !this.readRecords) throw new GroceryError("Confirmez explicitement la preuve de comparaison.");
        sourceRecords ??= (await this.readRecords()).records;
        const record = sourceRecords.find(r => r.id === e.recordId);
        const reason = record ? purchaseEvidenceReason(e, record, p) : "Achat source absent";
        if (reason) throw new GroceryError(reason);
        merged.set(e.id, e);
      }
      if (previous.purchaseComparisons !== undefined || p.purchaseComparisons !== undefined) p.purchaseComparisons = [...merged.values()];
      const validated = validatePlan(p); validated.revision = randomUUID(); await atomicJson(join(this.directory, "planning.json"), validated); return validated;
    });
    this.queue = result.catch(() => {}); return result;
  }
}
