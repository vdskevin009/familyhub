import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicJson } from "./private-store.js";

export type OpportunityActionState = "seen" | "snoozed" | "dismissed" | "resolved";
export type OpportunityDecision = {
  opportunityId: string; evidenceVersion: string; state: OpportunityActionState;
  at: string; snoozedUntil?: string; reason?: string;
};
export type OpportunityActionHistory = Omit<OpportunityDecision, "state"> & { state: OpportunityActionState | "restored" };
export type OpportunityActionsSnapshot = {
  schema: 1; revision: string; decisions: Record<string, OpportunityDecision>; history: OpportunityActionHistory[];
  totals: Record<OpportunityActionState | "restored", number>;
};
export class OpportunityActionsConflict extends Error {}
const identity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9:_-]{1,200}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const states = ["seen", "snoozed", "dismissed", "resolved"];
const day = 86_400_000;
const empty = (): OpportunityActionsSnapshot => ({ schema: 1, revision: "empty", decisions: {}, history: [], totals: { seen: 0, snoozed: 0, dismissed: 0, resolved: 0, restored: 0 } });
function validDecision(value: unknown, history = false): value is OpportunityActionHistory {
  const d = value as OpportunityActionHistory;
  return !!d && typeof d === "object" && identity(d.opportunityId) && identity(d.evidenceVersion)
    && [...states, ...(history ? ["restored"] : [])].includes(d.state) && timestamp(d.at)
    && (d.reason === undefined || typeof d.reason === "string" && d.reason.length <= 240)
    && (d.state === "snoozed" ? timestamp(d.snoozedUntil) && Date.parse(d.snoozedUntil) > Date.parse(d.at) : d.snoozedUntil === undefined);
}
/** Decisions affect presentation only. They never mark a claim submitted or money saved. */
export class OpportunityActions {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action); this.tail = next.catch(() => {}); return next;
  }
  private async load(): Promise<OpportunityActionsSnapshot> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as OpportunityActionsSnapshot;
      if (!data || data.schema !== 1 || typeof data.revision !== "string" || !data.revision || data.revision.length > 100
        || !data.decisions || typeof data.decisions !== "object" || Array.isArray(data.decisions)
        || Object.keys(data.decisions).length > 5000 || Object.entries(data.decisions).some(([id, d]) => !identity(id) || !validDecision(d) || d.opportunityId !== id)
        || !Array.isArray(data.history) || data.history.length > 2000 || data.history.some(d => !validDecision(d, true))) throw new Error();
      if (data.totals === undefined) data.totals = data.history.reduce((counts, row) => { counts[row.state]++; return counts; }, empty().totals);
      if (!data.totals || typeof data.totals !== "object" || Array.isArray(data.totals) || Object.keys(data.totals).length !== 5 || [...states, "restored"].some(k => !Number.isSafeInteger(data.totals[k as keyof typeof data.totals]) || data.totals[k as keyof typeof data.totals] < 0)) throw new Error();
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw new Error("Décisions d’accueil illisibles. Aucun fichier remplacé ; vérifiez la sauvegarde privée.");
    }
  }
  read() { return this.serialize(() => this.load()); }
  mutate(input: unknown, now = new Date()) {
    return this.serialize(async () => {
      const state = await this.load(), body = input as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Action d’accueil invalide.");
      if (body.expectedRevision !== state.revision) throw new OpportunityActionsConflict("Les actions d’accueil ont changé. Actualisez avant de réessayer.");
      if (Object.keys(body).some(k => !["expectedRevision", "opportunityId", "evidenceVersion", "action", "snoozedUntil", "reason"].includes(k))
        || !identity(body.opportunityId) || !identity(body.evidenceVersion) || !["seen", "snooze", "dismiss", "resolve", "restore"].includes(String(body.action))
        || body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 240)) throw new Error("Action d’accueil invalide.");
      const id = body.opportunityId, previous = state.decisions[id], at = now.toISOString(), evidenceVersion = body.evidenceVersion;
      if (body.action !== "snooze" && body.snoozedUntil !== undefined) throw new Error("Date de report inattendue.");
      if (body.action === "snooze" && (!timestamp(body.snoozedUntil) || Date.parse(body.snoozedUntil) <= now.getTime()
        || Date.parse(body.snoozedUntil) > now.getTime() + 90 * day)) throw new Error("Choisissez un report futur, dans les 90 prochains jours.");
      // Viewing an item never silently restores a decision already made for the same evidence.
      if (body.action === "seen" && previous?.evidenceVersion === evidenceVersion) return state;
      if (body.action === "restore") {
        if (previous && previous.evidenceVersion !== evidenceVersion) throw new OpportunityActionsConflict("Les preuves ont changé. Actualisez avant de rétablir cette action.");
        delete state.decisions[id];
      } else {
        if (!previous && Object.keys(state.decisions).length >= 5000) throw new Error("La limite des décisions d’accueil est atteinte. Les décisions existantes sont conservées.");
        const decision: OpportunityDecision = { opportunityId: id, evidenceVersion, at,
          state: body.action === "snooze" ? "snoozed" : body.action === "dismiss" ? "dismissed" : body.action === "resolve" ? "resolved" : "seen",
          ...(body.action === "snooze" ? { snoozedUntil: new Date(body.snoozedUntil as string).toISOString() } : {}),
          ...(typeof body.reason === "string" && body.reason.trim() ? { reason: body.reason.trim() } : {}) };
        state.decisions[id] = decision;
      }
      state.history.push(body.action === "restore" ? { opportunityId: id, evidenceVersion, at, state: "restored" } : { ...state.decisions[id] });
      const countKey = state.history.at(-1)!.state;
      if (state.totals[countKey] === Number.MAX_SAFE_INTEGER) throw new Error("La limite du compteur est atteinte. Aucun fichier remplacé.");
      state.totals[countKey]++;
      state.history = state.history.slice(-2000);
      state.revision = randomUUID();
      await atomicJson(this.path, state);
      return state;
    });
  }
}
