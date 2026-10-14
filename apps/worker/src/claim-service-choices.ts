import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, dataDirectory } from "./private-store.js";
import type { ClaimPreparation } from "./claim-preparation.js";

type Choice = { scope: string; kind: "service" | "benefit"; label: string; confirmedAt: string };
type Store = { version: 1; choices: Choice[] };
const path = join(dataDirectory, "claim-service-choices.json");
const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
// The private store contains a one-way scope digest and option labels only.
// Dates, patient identity, amounts and coordination answers are never learned.
export function serviceChoiceScope(dossier: ClaimPreparation): string | null {
  const { provider, service } = dossier.fields;
  if (!provider?.trim() || !service?.trim() || provider.length > 500 || service.length > 500) return null;
  return createHash("sha256").update(JSON.stringify([dossier.insurer, normalized(provider), normalized(service)])).digest("hex");
}
async function read(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, choices: [] }; throw error; }
  if (raw.length > 1_000_000) throw new Error("Saved service choices need local review.");
  const value = JSON.parse(raw) as Store;
  if (value.version !== 1 || !Array.isArray(value.choices) || value.choices.length > 256
    || value.choices.some(c => !/^[a-f0-9]{64}$/.test(c.scope) || !["service", "benefit"].includes(c.kind)
      || typeof c.label !== "string" || !c.label.trim() || c.label.length > 500 || !Number.isFinite(Date.parse(c.confirmedAt))))
    throw new Error("Saved service choices need local review.");
  return value;
}
let pending = Promise.resolve();
function mutate(action: (store: Store) => void): Promise<void> {
  const next = pending.then(async () => { const store = await read(); action(store); await atomicJson(path, store); });
  pending = next.catch(() => {}); return next;
}
export async function savedServiceChoice(dossier: ClaimPreparation, kind: string | null, options: { value: string; label: string }[]): Promise<string | null> {
  const scope = serviceChoiceScope(dossier);
  if (!scope || !["service", "benefit"].includes(kind || "")) return null;
  const choices = (await read()).choices.filter(c => c.scope === scope && c.kind === kind);
  if (choices.length !== 1) return null;
  const matches = options.filter(o => o.value && normalized(o.label) === normalized(choices[0].label));
  return matches.length === 1 ? matches[0].value : null;
}
export async function rememberServiceChoice(dossier: ClaimPreparation, kind: string | null, options: { value: string; label: string }[], selected: string): Promise<boolean> {
  const scope = serviceChoiceScope(dossier);
  const matches = options.filter(o => o.value === selected && o.value && o.label.trim());
  if (!scope || !["service", "benefit"].includes(kind || "") || matches.length !== 1
    || options.filter(o => normalized(o.label) === normalized(matches[0].label)).length !== 1) return false;
  const choice: Choice = { scope, kind: kind as Choice["kind"], label: matches[0].label, confirmedAt: new Date().toISOString() };
  await mutate(store => { store.choices = [...store.choices.filter(c => c.scope !== scope || c.kind !== kind), choice].slice(-256); });
  return true;
}
export async function forgetServiceChoices(dossier: ClaimPreparation): Promise<void> {
  const scope = serviceChoiceScope(dossier);
  if (scope) await mutate(store => { store.choices = store.choices.filter(c => c.scope !== scope); });
}
