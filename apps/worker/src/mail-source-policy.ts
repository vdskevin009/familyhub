import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory, atomicJson } from "./private-store.js";
export type PluginMailAccount = { email: string; label: string; linkId: string };
export type MailCollectionDomain = "invoices" | "groceries";
export type ScopedPluginMailAccount = PluginMailAccount & { collections: MailCollectionDomain[] };
export type MailSourcePolicy = { schema: 1; mode: "legacy" }
  | { schema: 1; mode: "plugin"; accounts: PluginMailAccount[] }
  | { schema: 2; mode: "plugin"; accounts: ScopedPluginMailAccount[] };
/** Schema 1 preserves its historical all-domain meaning; schema 2 always requires explicit scopes. */
export function accountsForCollection(policy: Exclude<MailSourcePolicy, { mode: "legacy" }>, domain: MailCollectionDomain): PluginMailAccount[] {
  return policy.schema === 1 ? policy.accounts : policy.accounts.filter(account => account.collections.includes(domain));
}
async function pluginWasSelected(directory: string): Promise<boolean> {
  try {
    const text = await readFile(join(directory, "mail-source-selection.json"), "utf8");
    if (Buffer.byteLength(text) > 1024) throw new Error();
    const selected = JSON.parse(text);
    if (selected.schema !== 1 || selected.mode !== "plugin") throw new Error();
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw new Error("Saved mail source selection is invalid; direct Gmail remains blocked."); }
}
/** Runtime-only durable guard. Readiness/planning never creates a source selection. */
export async function rememberPluginSelection(directory = dataDirectory): Promise<void> {
  if (!await pluginWasSelected(directory)) await atomicJson(join(directory, "mail-source-selection.json"), { schema: 1, mode: "plugin" });
}
/** Missing policy means legacy only for an installation that has never selected the plugin. */
export async function readMailSourcePolicy(directory = dataDirectory): Promise<MailSourcePolicy> {
  let text: string;
  try { text = await readFile(join(directory, "mail-source-policy.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { if (await pluginWasSelected(directory)) throw new Error("Selected plugin policy is missing; explicit source rollback is required."); return { schema: 1, mode: "legacy" }; } throw new Error("Mail source policy is unavailable."); }
  if (Buffer.byteLength(text) > 32_000) throw new Error("Mail source policy is invalid.");
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error("Mail source policy is invalid."); }
  const p = value as { schema?: unknown; mode?: unknown; accounts?: unknown; allowDirectGmail?: unknown };
  if (p?.schema === 1 && p.mode === "legacy" && p.allowDirectGmail === true && p.accounts === undefined && Object.keys(p).every(key => ["schema", "mode", "allowDirectGmail"].includes(key))) return { schema: 1, mode: "legacy" };
  if (!p || ![1, 2].includes(p.schema as number) || p.mode !== "plugin" || !Object.keys(p).every(key => ["schema", "mode", "accounts"].includes(key)) || !Array.isArray(p.accounts) || !p.accounts.length || p.accounts.length > 16) throw new Error("Mail source policy is invalid.");
  const accounts: ScopedPluginMailAccount[] = [];
  for (const a of p.accounts) {
    if (!a || typeof a !== "object" || Array.isArray(a) || !Object.keys(a).every(key => (p.schema === 2 ? ["email", "label", "linkId", "collections"] : ["email", "label", "linkId"]).includes(key)) || typeof a.email !== "string" || a.email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(a.email) || a.email !== a.email.toLowerCase()
      || typeof a.label !== "string" || !a.label.trim() || a.label.length > 200 || typeof a.linkId !== "string" || !/^link_[A-Za-z0-9_-]{1,100}$/.test(a.linkId)) throw new Error("Mail source policy is invalid.");
    if (p.schema === 2 && (!Array.isArray(a.collections) || !a.collections.length || a.collections.length > 2
      || a.collections.some((domain: unknown) => domain !== "invoices" && domain !== "groceries")
      || new Set(a.collections).size !== a.collections.length)) throw new Error("Mail source collection scopes are invalid.");
    accounts.push({ email: a.email, label: a.label, linkId: a.linkId, collections: p.schema === 2 ? [...a.collections].sort() : ["invoices", "groceries"] });
  }
  if (new Set(accounts.map(a => a.email)).size !== accounts.length || new Set(accounts.map(a => a.linkId)).size !== accounts.length) throw new Error("Mail source policy accounts conflict.");
  return p.schema === 2 ? { schema: 2, mode: "plugin", accounts }
    : { schema: 1, mode: "plugin", accounts: accounts.map(({ collections: _collections, ...account }) => account) };
}
/** Configuration readiness only, never proof of a live connection. */
export async function mailSourceReadiness(directory = dataDirectory) {
  const policy = await readMailSourcePolicy(directory);
  if (policy.mode === "plugin") return { mode: "plugin" as const, ready: true };
  try { const info = await stat(join(directory, "gmail-credentials.dpapi")); return { mode: "legacy" as const, ready: info.isFile() && info.size > 0 }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mode: "legacy" as const, ready: false }; throw new Error("Mail source readiness is unavailable."); }
}
