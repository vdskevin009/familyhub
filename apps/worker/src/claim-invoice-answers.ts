import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, dataDirectory } from "./private-store.js";
import type { ClaimPreparation } from "./claim-preparation.js";

type Answer = { scope: string; value: string | null; revision: number; confirmedAt: string };
type Store = { version: 1; answers: Answer[] };
const path = join(dataDirectory, "claim-invoice-answers.json");
export function invoiceAnswerScope(dossier: ClaimPreparation) {
  return createHash("sha256").update(JSON.stringify([dossier.expenseId, dossier.insurer, dossier.fields])).digest("hex");
}
async function read(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, answers: [] }; throw error; }
  if (raw.length > 2_000_000) throw new Error("Saved invoice answers need local review.");
  const store = JSON.parse(raw) as Store;
  if (store.version !== 1 || !Array.isArray(store.answers) || store.answers.length > 1000
    || new Set(store.answers.map(a => a.scope)).size !== store.answers.length
    || store.answers.some(a => !/^[a-f0-9]{64}$/.test(a.scope) || !Number.isSafeInteger(a.revision) || a.revision < 1
      || (a.value !== null && (typeof a.value !== "string" || !a.value.trim() || a.value.length > 500))
      || !Number.isFinite(Date.parse(a.confirmedAt)))) throw new Error("Saved invoice answers need local review.");
  return store;
}
export async function confirmedInvoiceIllness(dossier: ClaimPreparation) {
  const scope = invoiceAnswerScope(dossier), answer = (await read()).answers.find(a => a.scope === scope);
  return { scope, value: answer?.value ?? null, revision: answer?.revision ?? 0 };
}
let pending = Promise.resolve();
export function confirmInvoiceIllness(dossier: ClaimPreparation, input: { confirmed?: unknown; expectedScope?: unknown; expectedRevision?: unknown; value?: unknown; remove?: unknown }) {
  const action = pending.then(async () => {
    const scope = invoiceAnswerScope(dossier);
    if (dossier.blocked || input.confirmed !== true || input.expectedScope !== scope) throw new Error("Review this invoice and explicitly confirm its answer before saving.");
    const value = input.remove === true ? null : typeof input.value === "string" ? input.value.trim() : "";
    if (value !== null && (!value || value.length > 500 || /[\u0000-\u001f]/.test(value))) throw new Error("Enter the illness or injury in your own words (up to 500 characters).");
    const store = await read(), previous = store.answers.find(a => a.scope === scope);
    if (input.expectedRevision !== (previous?.revision ?? 0)) throw new Error("The saved invoice answer changed. Read the current step again.");
    if (!previous && store.answers.length >= 1000) throw new Error("Saved invoice answers need local review.");
    const answer = { scope, value, revision: (previous?.revision ?? 0) + 1, confirmedAt: new Date().toISOString() };
    store.answers = [...store.answers.filter(a => a.scope !== scope), answer];
    await atomicJson(path, store);
    return { scope, value, revision: answer.revision };
  });
  pending = action.then(() => {}, () => {});
  return action;
}
