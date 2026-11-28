/** Private display evidence only. No canonical account IDs, ledger rows, totals or inferred mappings. */
export const SOURCE_INVENTORY_LIMITS = { accounts: 100, predictions: 500, bytes: 1_000_000, clockSkewMs: 300_000, staleAfterMs: 86_400_000 } as const;
export const SOURCE_INVENTORY_CAPABILITY = "finance-source-inventory-v1" as const;
export type SourceMoney = { amountCents: number; currency: string };
export type SourceDatedMoney = SourceMoney & { sourceAsOf: string | null };
export type SourceAvailability = {
  status: "unavailable" | "partial" | "available";
  coverage: "unknown" | "partial" | "complete";
  observedCount: number | null;
};
export type SourceCredit = {
  statementBalance: SourceDatedMoney | null;
  minimumPayment: SourceDatedMoney | null;
  paymentDueOn: string | null;
};
export type SourceAccount = {
  sourceKey: string;
  name: string;
  institution: string | null;
  kind: "depository" | "credit" | "investment" | "loan" | "other" | "unknown";
  reconciliation: "not-reconciled";
  balance: SourceDatedMoney | null;
  credit: SourceCredit | null;
};
export type SourcePrediction = {
  sourceKey: string;
  accountSourceKey: string | null;
  name: string;
  flow: "inflow" | "outflow" | "unknown";
  amount: SourceMoney | null;
  predictedOn: string | null;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "yearly" | "irregular" | "unknown";
  kind: "forecast";
};
export type FinanceSourceInventory = {
  schemaVersion: 1;
  source: "finances-plugin";
  collectedAt: string;
  accounts: SourceAccount[];
  predictions: SourcePrediction[];
  availability: {
    accounts: SourceAvailability;
    holdings: SourceAvailability;
    activity: SourceAvailability;
    recurring: SourceAvailability;
    liabilities: SourceAvailability;
    budgets: "not-provided";
    goals: "not-provided";
  };
};
export type FinanceSourceInventoryState = { revision: string; snapshot: FinanceSourceInventory | null };
export type SourceInventoryImportResult = {
  capability: typeof SOURCE_INVENTORY_CAPABILITY;
  applied: boolean;
  alreadyImported: boolean;
  expectedRevision: string;
  proposedRevision: string;
  snapshot: FinanceSourceInventory;
  state: FinanceSourceInventoryState | null;
};

export class SourceInventoryError extends Error {}
const fail = (): never => { throw new SourceInventoryError("Invalid source inventory. Existing data has been kept."); };
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !keys.includes(key))) return fail();
  return row;
}
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) return fail();
  return value as T;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value;
}
function key(value: unknown): string {
  if (typeof value !== "string" || !/^fsi_[a-f0-9]{64}$/.test(value)) return fail();
  return value;
}
function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail();
  const time = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return fail();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return fail();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== (value.length === 20 ? value.replace("Z", ".000Z") : value)) return fail();
  return new Date(time).toISOString();
}
function money(value: unknown, dated: false): SourceMoney;
function money(value: unknown, dated: true, collectedAt: string): SourceDatedMoney;
function money(value: unknown, dated: boolean, collectedAt?: string): SourceMoney | SourceDatedMoney {
  const row = object(value, dated ? ["amountCents", "currency", "sourceAsOf"] : ["amountCents", "currency"]);
  if (!Number.isSafeInteger(row.amountCents) || Math.abs(row.amountCents as number) > 1_000_000_000_000 || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) return fail();
  const result: SourceMoney = { amountCents: row.amountCents as number, currency: row.currency };
  if (!dated) return result;
  const sourceAsOf = row.sourceAsOf === null ? null : typeof row.sourceAsOf === "string" && row.sourceAsOf.length === 10 ? day(row.sourceAsOf) : timestamp(row.sourceAsOf);
  if (sourceAsOf !== null && (sourceAsOf.length === 10 ? sourceAsOf > collectedAt!.slice(0, 10) : Date.parse(sourceAsOf) > Date.parse(collectedAt!) + SOURCE_INVENTORY_LIMITS.clockSkewMs)) return fail();
  return { ...result, sourceAsOf };
}
function availability(value: unknown): SourceAvailability {
  const row = object(value, ["status", "coverage", "observedCount"]);
  const status = oneOf(row.status, ["unavailable", "partial", "available"]);
  const coverage = oneOf(row.coverage, ["unknown", "partial", "complete"]);
  if (row.observedCount !== null && (!Number.isSafeInteger(row.observedCount) || (row.observedCount as number) < 0 || (row.observedCount as number) > 100_000)) return fail();
  if (status === "available" && (coverage !== "complete" || row.observedCount === null)) return fail();
  if (coverage === "complete" && status !== "available") return fail();
  if (status === "partial" && coverage !== "partial") return fail();
  if (status === "unavailable" && coverage !== "unknown") return fail();
  return { status, coverage, observedCount: row.observedCount as number | null };
}
/** Validate only allowlisted, already-minimized input. Raw provider responses are deliberately not accepted. */
export function validateFinanceSourceInventory(value: unknown, now = new Date()): FinanceSourceInventory {
  const row = object(value, ["schemaVersion", "source", "collectedAt", "accounts", "predictions", "availability"]);
  if (row.schemaVersion !== 1 || row.source !== "finances-plugin" || !Number.isFinite(now.getTime())) return fail();
  const collectedAt = timestamp(row.collectedAt);
  if (Date.parse(collectedAt) > now.getTime() + SOURCE_INVENTORY_LIMITS.clockSkewMs) return fail();
  if (!Array.isArray(row.accounts) || row.accounts.length > SOURCE_INVENTORY_LIMITS.accounts || !Array.isArray(row.predictions) || row.predictions.length > SOURCE_INVENTORY_LIMITS.predictions) return fail();
  const accounts: SourceAccount[] = row.accounts.map(value => {
    const account = object(value, ["sourceKey", "name", "institution", "kind", "reconciliation", "balance", "credit"]);
    const kind = oneOf(account.kind, ["depository", "credit", "investment", "loan", "other", "unknown"]);
    let credit: SourceCredit | null = null;
    if (account.credit !== null) {
      if (kind !== "credit") return fail();
      const fields = object(account.credit, ["statementBalance", "minimumPayment", "paymentDueOn"]);
      credit = {
        statementBalance: fields.statementBalance === null ? null : money(fields.statementBalance, true, collectedAt),
        minimumPayment: fields.minimumPayment === null ? null : money(fields.minimumPayment, true, collectedAt),
        paymentDueOn: fields.paymentDueOn === null ? null : day(fields.paymentDueOn),
      };
    }
    return { sourceKey: key(account.sourceKey), name: label(account.name), institution: account.institution === null ? null : label(account.institution), kind,
      reconciliation: oneOf(account.reconciliation, ["not-reconciled"]), balance: account.balance === null ? null : money(account.balance, true, collectedAt), credit };
  });
  const accountKeys = new Set(accounts.map(account => account.sourceKey));
  if (accountKeys.size !== accounts.length) return fail();
  const predictions: SourcePrediction[] = row.predictions.map(value => {
    const forecast = object(value, ["sourceKey", "accountSourceKey", "name", "flow", "amount", "predictedOn", "frequency", "kind"]);
    const accountSourceKey = forecast.accountSourceKey === null ? null : key(forecast.accountSourceKey);
    // The caller may omit the link when its account is outside this deliberately separate inventory.
    if (accountSourceKey !== null && !accountKeys.has(accountSourceKey)) return fail();
    return { sourceKey: key(forecast.sourceKey), accountSourceKey, name: label(forecast.name), flow: oneOf(forecast.flow, ["inflow", "outflow", "unknown"]),
      amount: forecast.amount === null ? null : money(forecast.amount, false), predictedOn: forecast.predictedOn === null ? null : day(forecast.predictedOn),
      frequency: oneOf(forecast.frequency, ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly", "irregular", "unknown"]), kind: oneOf(forecast.kind, ["forecast"]) };
  });
  if (new Set(predictions.map(forecast => forecast.sourceKey)).size !== predictions.length) return fail();
  const sections = object(row.availability, ["accounts", "holdings", "activity", "recurring", "liabilities", "budgets", "goals"]);
  const result: FinanceSourceInventory = { schemaVersion: 1, source: "finances-plugin", collectedAt, accounts, predictions, availability: {
    accounts: availability(sections.accounts), holdings: availability(sections.holdings), activity: availability(sections.activity), recurring: availability(sections.recurring), liabilities: availability(sections.liabilities),
    budgets: oneOf(sections.budgets, ["not-provided"]), goals: oneOf(sections.goals, ["not-provided"]),
  } };
  // Counts describe this minimized inventory's admitted scope, never all linked accounts by implication.
  for (const [section, count] of [[result.availability.accounts, accounts.length], [result.availability.recurring, predictions.length]] as const) {
    if (section.observedCount !== null && section.observedCount !== count) return fail();
    if (count > 0 && section.observedCount === null) return fail();
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > SOURCE_INVENTORY_LIMITS.bytes) return fail();
  return result;
}

export function sourceInventoryIsStale(snapshot: Pick<FinanceSourceInventory, "collectedAt">, now = new Date()): boolean {
  return now.getTime() - Date.parse(snapshot.collectedAt) > SOURCE_INVENTORY_LIMITS.staleAfterMs;
}

export function validateFinanceSourceInventoryState(value: unknown, now = new Date()): FinanceSourceInventoryState {
  const row = object(value, ["revision", "snapshot"]);
  if (row.snapshot === null) {
    if (row.revision !== "empty") return fail();
    return { revision: "empty", snapshot: null };
  }
  if (typeof row.revision !== "string" || !/^[a-f0-9]{64}$/.test(row.revision)) return fail();
  return { revision: row.revision, snapshot: validateFinanceSourceInventory(row.snapshot, now) };
}
