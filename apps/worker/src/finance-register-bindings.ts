import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FinanceState } from "./finance-model.js";
import { parseFinancePreparation } from "./finance-import.js";
import { pluginAccountKey, pluginTransactionKey } from "./finances-plugin-import.js";
import { sourceExpenseKey } from "./finance-source-expenses-store.js";

export const FINANCE_REGISTER_CAPABILITY = "finance-register-bindings-v1" as const;
export type FinanceRegisterBindings = { accounts: Record<string, string>; transactions: Record<string, string> };
export type FinanceRegisterProof = { capability: typeof FINANCE_REGISTER_CAPABILITY; ledgerRevision: string; bindings: FinanceRegisterBindings; unavailableArchiveCount: number };
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Only immutable, hash-verified successful imports can establish a cross-provider identity.
 * No discovery by names/amounts, no raw provider IDs/paths, no private-store writes. */
export async function readFinanceRegisterBindings(directory: string, state: FinanceState): Promise<FinanceRegisterProof> {
  const bindings: FinanceRegisterBindings = { accounts: {}, transactions: {} };
  const conflicts = new Set<string>(), seen = new Set<string>();
  let unavailableArchiveCount = 0, totalBytes = 0;
  const put = (kind: keyof FinanceRegisterBindings, key: string, value: string) => {
    const identity = kind + key;
    if (conflicts.has(identity)) return;
    if (bindings[kind][key] && bindings[kind][key] !== value) { delete bindings[kind][key]; conflicts.add(identity); return; }
    bindings[kind][key] = value;
  };
  if (state.imports.length > 2400) throw new Error("Historique de rapprochement trop volumineux.");
  for (const item of state.imports) {
    if (seen.has(item.hash)) continue;
    seen.add(item.hash);
    let file;
    try {
      if (!/^[a-f0-9]{64}$/.test(item.hash)) throw Error("Hash");
      const root = await realpath(directory), sources = await realpath(join(root, "sources"));
      const path = join(sources, item.hash + ".json"), actual = await realpath(path);
      if (dirname(sources) !== root || dirname(actual) !== sources || resolve(actual) !== resolve(path)) throw Error("Boundary");
      file = await open(path, "r");
      if ((await file.stat()).size > 20_000_000) throw Error("Size");
      const chunks: Buffer[] = []; let length = 0;
      while (true) { const bytes = Buffer.alloc(Math.min(65536, 20_000_001 - length)); const read = await file.read(bytes, 0, bytes.length, null); if (!read.bytesRead) break; length += read.bytesRead; totalBytes += read.bytesRead; if (length > 20_000_000 || totalBytes > 128_000_000) throw Error("Size"); chunks.push(bytes.subarray(0, read.bytesRead)); }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (hash(raw) !== item.hash) throw Error("Hash");
      const bundle = JSON.parse(raw), proof = bundle.pluginEvidence;
      if (!proof) continue;
      if (proof.schema !== "familyhub.finances-plugin-evidence.v1" || !Array.isArray(proof.pages) || hash(JSON.stringify(proof.pages)) !== proof.rawSha256 || !proof.plan?.accounts || !proof.plan.resolutions) throw Error("Proof");
      const imported = parseFinancePreparation(bundle);
      const proposed: FinanceRegisterBindings = { accounts: {}, transactions: {} };
      for (const [key, canonical] of Object.entries(proof.plan.accounts)) {
        const [itemId, accountId] = JSON.parse(key);
        if (typeof canonical !== "string" || !imported.accounts.some(a => a.id === canonical && state.data?.accounts.some(b => b.id === a.id && b.identity === a.identity && b.currency === a.currency))) throw Error("Account");
        proposed.accounts[sourceExpenseKey("account", itemId, accountId)] = canonical;
      }
      for (const page of proof.pages) {
        if (!Array.isArray(page.result?.items)) throw Error("Rows");
        for (const row of page.result.items) {
          if (row.pending) continue;
          const key = pluginTransactionKey(row), resolution = proof.plan.resolutions[key];
          if (!resolution) continue; // Explicitly unassigned source records do not gain identity.
          const canonical = resolution.kind === "existing" ? resolution.ledgerId : resolution.kind === "new" ? "finances:" + key : null;
          const saved = state.data?.transactions.find(t => t.id === canonical), archived = imported.transactions.find(t => t.id === canonical);
          const account = proof.plan.accounts[pluginAccountKey(row.item_id, row.account_id)];
          if (!saved || !archived || saved.accountId !== account || archived.accountId !== account || saved.date !== row.date || archived.date !== row.date || saved.currency !== row.iso_currency_code || archived.currency !== row.iso_currency_code || !Number.isFinite(row.amount) || saved.outflowCents !== Math.round(row.amount * 100) || archived.outflowCents !== saved.outflowCents || saved.status !== "posted") throw Error("Facts");
          proposed.transactions[sourceExpenseKey("transaction", row.item_id, row.transaction_id, row.account_id)] = saved.id;
        }
      }
      for (const kind of ["accounts", "transactions"] as const) for (const [key, value] of Object.entries(proposed[kind])) put(kind, key, value);
    } catch { unavailableArchiveCount++; } finally { await file?.close(); }
  }
  return { capability: FINANCE_REGISTER_CAPABILITY, ledgerRevision: state.revision, bindings, unavailableArchiveCount: unavailableArchiveCount + conflicts.size };
}
