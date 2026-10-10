import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";
import { GroceryError } from "./grocery-model.js";
import { GroceryConflict } from "./grocery-store.js";
import { emptyPlan, validatePlan } from "./grocery-planning.js";
export class GroceryPlanningStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  async read() {
    try { return validatePlan(JSON.parse(await readFile(join(this.directory, "planning.json"), "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyPlan(); throw new GroceryError("La liste Courses est illisible. Le fichier est préservé sur le PC."); }
  }
  save(value: { plan?: unknown; expectedRevision?: unknown }) {
    const result = this.queue.then(async () => { const p = validatePlan(value.plan), previous = await this.read(); if (value.expectedRevision !== previous.revision) throw new GroceryConflict("La liste a changé sur le PC. Votre brouillon reste ici ; comparez-le avec la version PC."); p.revision = randomUUID(); await atomicJson(join(this.directory, "planning.json"), p); return p; });
    this.queue = result.catch(() => {}); return result;
  }
}
