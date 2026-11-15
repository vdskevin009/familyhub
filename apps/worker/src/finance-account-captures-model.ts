import { validateFinanceSourceInventory, type SourceAccount, type SourceDatedMoney } from "./finance-source-inventory-model.js";
export const ACCOUNT_CAPTURES_CAPABILITY = "finance-account-captures-v1" as const;
export const ACCOUNT_CAPTURES_LIMITS = { bytes: 250_000, historyBytes: 8_000_000, captures: 240 } as const;
export const PLAID_CURRENT_CONVENTION = "plaid-current-v1" as const;
export type FinanceCaptureAccount = Omit<SourceAccount, "reconciliation"> & {
  provider: "plaid" | "unknown";
  netBalance: (SourceDatedMoney & { basis: typeof PLAID_CURRENT_CONVENTION }) | null;
};
export type FinanceAccountCaptureSnapshot = {
  schemaVersion: 1; source: "finances-plugin"; collectedAt: string;
  coverage: "complete" | "partial" | "unknown"; sourceAccountCount: number | null;
  sourceSha256: string | null; supersedesCaptureId: string | null; accounts: FinanceCaptureAccount[];
};
export type FinanceAccountCapture = { id: string; origin: "source-capture" | "legacy-inventory"; snapshot: FinanceAccountCaptureSnapshot };
export type FinanceAccountCapturesState = { revision: string; captures: FinanceAccountCapture[] };
export type FinanceAccountCaptureImportResult = {
  capability: typeof ACCOUNT_CAPTURES_CAPABILITY; applied: boolean; alreadyImported: boolean;
  expectedRevision: string; proposedRevision: string; capture: FinanceAccountCapture; state: FinanceAccountCapturesState | null;
};
export class AccountCapturesError extends Error {}
export const accountCapturesFail = (): never => { throw new AccountCapturesError("Capture de comptes invalide. Les données existantes sont conservées."); };
export function captureObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return accountCapturesFail();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) return accountCapturesFail();
  return v;
}
export const captureHash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
/** Versioned documented Plaid balances.current convention; never inferred from a label or canonical type.
 * https://plaid.com/docs/api/accounts/#accounts-get-response-accounts-balances-current
 * Collection does not attest real-time freshness or withdrawable funds. */
export function plaidCurrentNet(account: Pick<FinanceCaptureAccount, "provider" | "kind" | "balance">): FinanceCaptureAccount["netBalance"] {
  if (account.provider !== "plaid" || !account.balance || !["depository", "investment", "credit", "loan"].includes(account.kind)) return null;
  return { ...account.balance, amountCents: (account.kind === "credit" || account.kind === "loan" ? -1 : 1) * account.balance.amountCents || 0, basis: PLAID_CURRENT_CONVENTION };
}
const unknown = () => ({ status: "unavailable" as const, coverage: "unknown" as const, observedCount: 0 });
export function validateFinanceAccountCaptureSnapshot(value: unknown, now = new Date()): FinanceAccountCaptureSnapshot {
  const v = captureObject(value, ["schemaVersion", "source", "collectedAt", "coverage", "sourceAccountCount", "sourceSha256", "supersedesCaptureId", "accounts"]);
  if (v.schemaVersion !== 1 || v.source !== "finances-plugin" || !["complete", "partial", "unknown"].includes(v.coverage as string)
    || (v.sourceSha256 !== null && !captureHash(v.sourceSha256)) || (v.supersedesCaptureId !== null && !captureHash(v.supersedesCaptureId))
    || !Array.isArray(v.accounts) || v.accounts.length > 100) return accountCapturesFail();
  const rows = v.accounts.map(a => captureObject(a, ["sourceKey", "name", "institution", "kind", "balance", "credit", "provider", "netBalance"]));
  const source = validateFinanceSourceInventory({ schemaVersion: 1, source: v.source, collectedAt: v.collectedAt,
    accounts: rows.map(({provider,netBalance,...a}) => ({...a,reconciliation:"not-reconciled"})), predictions: [],
    availability: {accounts:{status:"partial",coverage:"partial",observedCount:rows.length},holdings:unknown(),activity:unknown(),recurring:unknown(),liabilities:unknown(),budgets:"not-provided",goals:"not-provided"} }, now);
  const accounts = source.accounts.map(({ reconciliation, ...a }, i): FinanceCaptureAccount => {
    const row = rows[i]; if (row.provider !== "plaid" && row.provider !== "unknown") return accountCapturesFail();
    const account = {...a,provider:row.provider,netBalance:null} as FinanceCaptureAccount;
    const expected = plaidCurrentNet(account);
    if (row.netBalance !== null) {
      const net = captureObject(row.netBalance,["amountCents","currency","sourceAsOf","basis"]);
      if (!expected || net.basis !== expected.basis || net.amountCents !== expected.amountCents || net.currency !== expected.currency || net.sourceAsOf !== expected.sourceAsOf) return accountCapturesFail();
      account.netBalance = expected;
    }
    return account;
  }).sort((a,b) => a.sourceKey.localeCompare(b.sourceKey));
  if (v.sourceAccountCount !== null && (!Number.isSafeInteger(v.sourceAccountCount) || (v.sourceAccountCount as number) < accounts.length || (v.sourceAccountCount as number) > 100)) return accountCapturesFail();
  if (v.coverage === "complete" && (v.sourceAccountCount !== accounts.length || !accounts.length || v.sourceSha256 === null)) return accountCapturesFail();
  const result: FinanceAccountCaptureSnapshot = {schemaVersion:1,source:"finances-plugin",collectedAt:source.collectedAt,coverage:v.coverage as FinanceAccountCaptureSnapshot["coverage"],sourceAccountCount:v.sourceAccountCount as number|null,sourceSha256:v.sourceSha256 as string|null,supersedesCaptureId:v.supersedesCaptureId as string|null,accounts};
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > ACCOUNT_CAPTURES_LIMITS.bytes) return accountCapturesFail();
  return result;
}
export function validateFinanceAccountCapturesState(value: unknown, now = new Date()): FinanceAccountCapturesState {
  const row = captureObject(value,["revision","captures"]);
  if (!Array.isArray(row.captures) || row.captures.length > ACCOUNT_CAPTURES_LIMITS.captures || (row.revision !== "empty" && !captureHash(row.revision))) return accountCapturesFail();
  const captures = row.captures.map(value => {
    const c = captureObject(value,["id","origin","snapshot"]);
    if (!captureHash(c.id) || (c.origin !== "source-capture" && c.origin !== "legacy-inventory")) return accountCapturesFail();
    const snapshot = validateFinanceAccountCaptureSnapshot(c.snapshot,now);
    if (c.origin === "legacy-inventory" && (snapshot.coverage !== "partial" || snapshot.sourceAccountCount !== null || snapshot.sourceSha256 !== null || snapshot.supersedesCaptureId !== null || snapshot.accounts.some(a => a.provider !== "unknown" || a.netBalance !== null))) return accountCapturesFail();
    return {id:c.id,origin:c.origin,snapshot} as FinanceAccountCapture;
  });
  if (new Set(captures.map(c=>c.id)).size !== captures.length || ((row.revision === "empty") !== !captures.length)) return accountCapturesFail();
  for (const capture of captures) {
    const priorId = capture.snapshot.supersedesCaptureId;
    if (priorId !== null) {
      const prior = captures.find(c=>c.id===priorId);
      if (!prior || prior.id===capture.id || prior.origin!=="source-capture" || prior.snapshot.collectedAt!==capture.snapshot.collectedAt || captures.filter(c=>c.snapshot.supersedesCaptureId===priorId).length!==1) return accountCapturesFail();
      const seen = new Set([capture.id]); let cursor: FinanceAccountCapture | undefined = prior;
      while (cursor) { if (seen.has(cursor.id)) return accountCapturesFail(); seen.add(cursor.id); cursor=captures.find(c=>c.id===cursor!.snapshot.supersedesCaptureId); }
    }
  }
  if (new TextEncoder().encode(JSON.stringify({revision:row.revision,captures})).byteLength>ACCOUNT_CAPTURES_LIMITS.historyBytes) return accountCapturesFail();
  return {revision:row.revision as string,captures};
}
/** A subtotal from exactly one capture. Missing evidence is never zero and currencies never mix. */
export function summarizeFinanceAccountCapture(snapshot: FinanceAccountCaptureSnapshot) {
  const currencies = [...new Set(snapshot.accounts.flatMap(a=>a.balance?[a.balance.currency]:a.netBalance?[a.netBalance.currency]:[]))].sort().map(currency=>{
    const rows=snapshot.accounts.filter(a=>(a.balance?.currency??a.netBalance?.currency)===currency);
    const included=rows.filter(a=>a.netBalance!==null && !["unknown","other"].includes(a.kind));
    const unknownCurrencyAccountCount=snapshot.accounts.filter(a=>!a.balance&&!a.netBalance).length;
    const total = included.reduce((sum,a)=>sum+BigInt(a.netBalance!.amountCents),0n);
    const arithmeticUnavailable = total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER);
    return {currency,netAmountCents:included.length && !arithmeticUnavailable ? Number(total) : null,includedAccountCount:included.length,excludedAccountCount:rows.length-included.length,arithmeticUnavailable,
      complete:!arithmeticUnavailable && snapshot.coverage==="complete" && included.length===rows.length && !unknownCurrencyAccountCount};
  });
  return {coverage:snapshot.coverage,currencies,unknownCurrencyAccountCount:snapshot.accounts.filter(a=>!a.balance&&!a.netBalance).length};
}
