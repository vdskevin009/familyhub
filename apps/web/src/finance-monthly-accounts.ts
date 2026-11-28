import type { FinanceHistoricalAccountVersion } from "../../worker/src/finance-account-history-model";
import { summarizeFinanceAccountCapture, type FinanceAccountCapture, type FinanceAccountCaptureSnapshot, type FinanceCaptureAccount } from "../../worker/src/finance-account-captures-model";
export type MonthlyAccountSelection = { month: string | null; versionId: string | null; accountId: string; currency: string };
export const initialAccountSelection: MonthlyAccountSelection = { month: null, versionId: null, accountId: "", currency: "CAD" };
export type MonthlyAccountRow = { id: string; name: string; kind: string; currency: string | null; netCents: number | null; rawCents: number | null; sourceAsOf: string | null; canonicalAccountId?: string; source?: FinanceCaptureAccount };
export type MonthlyAccountVersion = { id: string; date: string; dateKind: "received" | "source"; origin: string; superseded?: boolean; coverage: "complete" | "partial" | "unknown"; rows: MonthlyAccountRow[]; snapshot?: FinanceAccountCaptureSnapshot; notes: string[] };
export function sourceAccountVersions(captures: FinanceAccountCapture[]): MonthlyAccountVersion[] {
  return captures.map(c => ({ id: c.id, date: c.snapshot.collectedAt, dateKind: "received", origin: c.origin, superseded: captures.some(n => n.snapshot.supersedesCaptureId === c.id), coverage: c.snapshot.coverage,
    rows: c.snapshot.accounts.map(a => ({ id: a.sourceKey, name: a.name, kind: a.kind, currency: a.netBalance?.currency ?? a.balance?.currency ?? null,
      netCents: a.netBalance?.amountCents ?? null, rawCents: a.balance?.amountCents ?? null, sourceAsOf: a.netBalance?.sourceAsOf ?? a.balance?.sourceAsOf ?? null, source: a })),
    snapshot: c.snapshot, notes: [] }));
}
export function selectAccountVersion(versions: MonthlyAccountVersion[], selection: MonthlyAccountSelection) {
  const sorted = [...versions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const preferredHistory = (list: MonthlyAccountVersion[]) => list.filter(v => v.origin === "historical-archive").sort((a,b) => Number(a.coverage === "complete") - Number(b.coverage === "complete") || a.rows.length - b.rows.length || a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).at(-1);
  const preferred = sorted.filter(v => v.origin === "source-capture" && !v.superseded).at(-1) ?? preferredHistory(sorted) ?? sorted.at(-1);
  const month = selection.month ?? preferred?.date.slice(0, 7) ?? "";
  const inMonth = sorted.filter(v => v.date.startsWith(month));
  const version = selection.versionId ? inMonth.find(v => v.id === selection.versionId) : inMonth.filter(v => v.origin === "source-capture" && !v.superseded).at(-1) ?? preferredHistory(inMonth) ?? inMonth.at(-1);
  return { month, inMonth, version, firstMonth: sorted[0]?.date.slice(0, 7) ?? "", lastMonth: sorted.at(-1)?.date.slice(0, 7) ?? "" };
}
export function summarizeMonthlyAccounts(version: MonthlyAccountVersion, accountId: string, currency: string) {
  const scope = version.rows.filter(r => !accountId || r.id === accountId);
  const rows = scope.filter(r => r.currency === currency || r.currency === null);
  const included = rows.filter(r => r.currency === currency && r.netCents !== null);
  const safeNumber = (value: bigint) => value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(value);
  const assetsCents = safeNumber(included.reduce((s, r) => s + BigInt(Math.max(0, r.netCents!)), 0n)), debtsCents = safeNumber(included.reduce((s, r) => s - BigInt(Math.min(0, r.netCents!)), 0n));
  const unknownCount = rows.length - included.length;
  // The shared source helper remains authoritative; filtered scopes never promote partial coverage.
  const source = version.snapshot ? summarizeFinanceAccountCapture({ ...version.snapshot, ...(accountId ? { accounts: version.snapshot.accounts.filter(a => a.sourceKey === accountId), coverage: "partial" as const } : {}) }).currencies.find(c => c.currency === currency) : null;
  const netCents = version.snapshot ? source?.netAmountCents ?? null : included.length ? safeNumber(included.reduce((sum, r) => sum + BigInt(r.netCents!), 0n)) : null;
  const arithmeticUnavailable = assetsCents === null || debtsCents === null || source?.arithmeticUnavailable === true;
  const complete = !arithmeticUnavailable && (version.snapshot ? source?.complete === true && unknownCount === 0 : version.coverage === "complete" && unknownCount === 0 && rows.length > 0);
  return { rows, includedCount: included.length, unknownCount, assetsCents, debtsCents, netCents, complete, arithmeticUnavailable };
}

/** Month buckets and received labels both use UTC; source-only calendar dates never shift. */
export const displayMonthlyCapture = (stamp: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(stamp));

/** Archive values are already signed. Never transpose provider conventions or fabricate a receipt. */
export function historicalAccountVersions(versions: FinanceHistoricalAccountVersion[]): MonthlyAccountVersion[] {
  return versions.map(v => ({ id: v.id, date: v.sourceAsOf.length === 10 ? v.sourceAsOf : new Date(v.sourceAsOf).toISOString(), dateKind: "source", origin: "historical-archive", coverage: v.coverage === "complete-recorded-scope" ? "complete" : "partial", rows: v.accounts.map(a => ({ id: a.sourceKey, canonicalAccountId: a.canonicalAccountId, name: a.name, kind: a.kind, currency: a.currency, netCents: a.balanceCents, rawCents: a.balanceCents, sourceAsOf: v.sourceAsOf })), notes: ["Exact sum of signed balances as recorded in this archive. The historical sign convention is not documented, so this is not a verified net balance. No performance is calculated against recent captures."] }));
}
