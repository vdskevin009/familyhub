import {
  classifiedRows, summarizeSpending,
  type ExpenseCategory, type FinanceState,
} from "../../worker/src/finance-model";
import type { SourceExpenseRow, SourceExpensesSnapshot } from "../../worker/src/finance-source-expenses-model";

/** A caller must supply a reviewed crosswalk. Names, dates and amounts alone are not identity. */
export type FinanceRegisterBindings = {
  accounts: Readonly<Record<string, string>>;
  transactions: Readonly<Record<string, string>>;
};
export type RegisterObservation = {
  collectedAt: string;
  sourceAsOf: string | null;
  evidenceSha256: string;
  row: SourceExpenseRow;
};
export type RegisterUnresolved = {
  sourceKey: string;
  accountId: string | null;
  reason: "unmapped-account" | "unmapped-transaction" | "conflicting-source-facts" | "invalid-binding" | "competing-bindings";
  observations: RegisterObservation[];
};
export type RegisterFilter = {
  from: string; to: string; currency: string; accountId?: string;
  category?: ExpenseCategory; search?: string; reviewOnly?: boolean;
};

const facts = (row: SourceExpenseRow) => JSON.stringify([
  row.accountSourceKey, row.date, row.currency, row.outflowCents, row.pending,
]);
const noBindings: FinanceRegisterBindings = { accounts: {}, transactions: {} };

/**
 * Read-only reconciliation groundwork. Not an import, an inferred account crosswalk,
 * or a substitute for one. Unbound/conflicting observations remain visible but never
 * enter totals. An already-imported transaction is counted once through the existing
 * ledger classifier and decisions, regardless of how many captures corroborate it.
 * All original observations (including superseded pending rows) remain in provenance.
 */
export function reconcileFinanceRegister(
  state: FinanceState,
  snapshots: readonly SourceExpensesSnapshot[],
  bindings: FinanceRegisterBindings = noBindings,
) {
  const ledger = new Map((state.data?.transactions ?? []).map(row => [row.id, row]));
  const accounts = new Set((state.data?.accounts ?? []).map(account => account.id));
  const observations = new Map<string, RegisterObservation[]>();
  for (const snapshot of [...snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))) {
    for (const row of snapshot.rows) {
      const observed = observations.get(row.sourceKey) ?? [];
      // Replay of the same capture is not a second provenance record.
      if (!observed.some(item => item.collectedAt === snapshot.collectedAt && item.evidenceSha256 === snapshot.evidenceSha256 && JSON.stringify(item.row) === JSON.stringify(row))) {
        observed.push({ collectedAt: snapshot.collectedAt, sourceAsOf: snapshot.coverage.sourceAsOf, evidenceSha256: snapshot.evidenceSha256, row });
      }
      observations.set(row.sourceKey, observed);
    }
  }
  const provenance = new Map<string, RegisterObservation[]>();
  const unresolved: RegisterUnresolved[] = [];
  const pending: RegisterObservation[][] = [];
  const supersededPending = new Map<string, RegisterObservation[]>();
  const candidates = new Map<string, string[]>();
  const resolveAccount = (sourceKey: string): string | null => {
    const id = bindings.accounts[sourceKey];
    return id && accounts.has(id) ? id : null;
  };
  // A known posted-to-pending link can retire a pending display row across captures.
  // Contradictory or cross-account links cannot suppress anything.
  for (const versions of observations.values()) {
    if (new Set(versions.map(item => facts(item.row))).size !== 1) continue;
    const row = versions.at(-1)!.row;
    if (row.pending || !row.pendingSourceKey) continue;
    const previous = observations.get(row.pendingSourceKey);
    if (previous?.every(item => item.row.pending && item.row.accountSourceKey === row.accountSourceKey && item.row.currency === row.currency)) {
      supersededPending.set(row.pendingSourceKey, previous);
    }
  }
  for (const [sourceKey, versions] of observations) {
    if (supersededPending.has(sourceKey)) continue;
    const row = versions.at(-1)!.row;
    const accountId = resolveAccount(row.accountSourceKey);
    const reject = (reason: RegisterUnresolved["reason"]) => unresolved.push({ sourceKey, accountId, reason, observations: versions });
    if (new Set(versions.map(item => facts(item.row))).size !== 1) { reject("conflicting-source-facts"); continue; }
    if (row.pending) { pending.push(versions); continue; }
    if (!accountId) { reject("unmapped-account"); continue; }
    const ledgerId = bindings.transactions[sourceKey];
    if (!ledgerId) { reject("unmapped-transaction"); continue; }
    const existing = ledger.get(ledgerId);
    if (!existing || existing.accountId !== accountId || existing.date !== row.date || existing.currency !== row.currency || existing.outflowCents !== row.outflowCents || existing.status !== "posted") {
      reject("invalid-binding"); continue;
    }
    candidates.set(ledgerId, [...(candidates.get(ledgerId) ?? []), sourceKey]);
  }
  for (const [ledgerId, sourceKeys] of candidates) {
    if (sourceKeys.length !== 1) {
      for (const sourceKey of sourceKeys) {
        const versions = observations.get(sourceKey)!;
        unresolved.push({ sourceKey, accountId: resolveAccount(versions.at(-1)!.row.accountSourceKey), reason: "competing-bindings", observations: versions });
      }
      continue;
    }
    const versions = observations.get(sourceKeys[0])!;
    const pendingKey = versions.at(-1)!.row.pendingSourceKey;
    provenance.set(ledgerId, [...versions, ...(pendingKey ? supersededPending.get(pendingKey) ?? [] : [])]);
  }
  return { state, provenance, observations, unresolved, pending, supersededPending, accountBindings: bindings.accounts };
}

/** All counts, category detail and totals share the same period/account/currency/search scope. */
export function filterFinanceRegister(register: ReturnType<typeof reconcileFinanceRegister>, filter: RegisterFilter) {
  const search = filter.search?.trim().toLocaleLowerCase("fr") ?? "";
  const prepared = classifiedRows(register.state).filter(row =>
    (!filter.category || row.category === filter.category) &&
    (!filter.reviewOnly || !row.reviewed) &&
    (!search || row.description.toLocaleLowerCase("fr").includes(search)),
  );
  const summary = summarizeSpending(register.state, filter.from, filter.to, filter.accountId, filter.currency, prepared);
  const matches = (item: RegisterObservation) => {
    const row = item.row;
    return row.date >= filter.from && row.date <= filter.to && row.currency === filter.currency &&
      (!filter.accountId || register.accountBindings[row.accountSourceKey] === filter.accountId || `source:${row.accountSourceKey}` === filter.accountId) &&
      (!search || row.description.toLocaleLowerCase("fr").includes(search));
  };
  // Unreconciled observations cannot be assigned a canonical category by guesswork.
  // Keep them alongside the result as explicit coverage limitations, not category payments.
  const unresolved = register.unresolved.filter(item => item.observations.some(matches));
  const pending = register.pending.filter(versions => versions.some(matches));
  return {
    ...summary, unresolved, pending,
    netCents: summary.included.length ? summary.totalCents : null,
    hasUnreconciledSources: unresolved.length > 0,
    complete: false as const,
  };
}
