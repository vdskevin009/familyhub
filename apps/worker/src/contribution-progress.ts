import type { FinanceState } from './finance-model.js';

/** Private configuration only. No household defaults or fiscal interpretation. */
export type ContributionPlan = {
  from: string; through: string; currency: string; targetAccountId: string;
  personalGoalCents: number;
  debitAccounts: string[];
  exactTransferDescriptions: string[]; unassignedTransferDescriptions?: string[]; verifiedTransferTransactionIds?: string[];
  unassignedSourceObservations?: {id: string; date: string; amountCents: number; currency: string}[];
};
function day(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T12:00:00Z')) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date.');
  return value;
}
/** Observed outgoing transfers are NOT confirmed contributions or contribution room. */
export function contributionProgress(state: FinanceState, plan: ContributionPlan, asOf: string) {
  day(plan.from); day(plan.through); day(asOf);
  if (plan.from > plan.through || !Number.isSafeInteger(plan.personalGoalCents) || plan.personalGoalCents <= 0 || !/^[A-Z]{3}$/.test(plan.currency) || !plan.targetAccountId || !plan.debitAccounts.length || (!plan.exactTransferDescriptions.length && !(plan.verifiedTransferTransactionIds ?? []).length) || plan.exactTransferDescriptions.some(s => !s.trim()) || new Set(plan.debitAccounts).size !== plan.debitAccounts.length || plan.debitAccounts.includes(plan.targetAccountId)) throw new Error('Invalid private contribution plan.');
  const end = asOf < plan.through ? asOf : plan.through;
  const data = state.data;
  // Existing ledger collection time is not a provider source-as-of timestamp.
  const warnings = new Set<string>(['source-freshness-unverified']);
  const included: { id: string; date: string; amountCents: number }[] = [];
  const excluded: { id: string; reason: string }[] = [];
  if (!data) warnings.add('source-unavailable');
  const accounts = new Map(data?.accounts.map(a => [a.id, a]) ?? []);
  if (!accounts.has(plan.targetAccountId)) warnings.add('destination-unverified');
  for (const id of plan.debitAccounts) {
    if (accounts.get(id)?.currency !== plan.currency) warnings.add('source-account-unverified');
    const coverage = data?.coverage.find(c => c.accountId === id);
    // Transaction extrema alone do not certify complete source coverage.
    if (!coverage || coverage.warning || !coverage.earliest || coverage.earliest > plan.from || !coverage.latest || coverage.latest < end) warnings.add('coverage-incomplete');
  }
  if (data) {
    day(data.collectedOn);
    if (data.collectedOn > asOf) throw new Error('Source observation is in the future.');
    if (data.collectedOn < asOf) warnings.add('source-not-current');
    if (data.pendingCount) warnings.add('pending-excluded');
    if (data.limits.length) warnings.add('source-limitations');
  }
  const candidates = (data?.transactions ?? []).filter(r => plan.debitAccounts.includes(r.accountId) && (plan.exactTransferDescriptions.includes(r.description) || (plan.verifiedTransferTransactionIds ?? []).includes(r.id)) && r.date >= plan.from && r.date <= end);
  const unassigned = (data?.transactions ?? []).filter(r => plan.debitAccounts.includes(r.accountId) && (plan.unassignedTransferDescriptions ?? []).includes(r.description) && !(plan.exactTransferDescriptions.includes(r.description) || (plan.verifiedTransferTransactionIds ?? []).includes(r.id)) && r.date >= plan.from && r.date <= end).map(r => ({ id: r.id, date: r.date, reason: 'destination-unattributed' }));
  for (const r of plan.unassignedSourceObservations ?? []) {
    day(r.date); if(!r.id || !Number.isSafeInteger(r.amountCents) || !/^[A-Z]{3}$/.test(r.currency)) throw new Error('Invalid unassigned source evidence.');
    if(r.date>=plan.from && r.date<=end) unassigned.push({id:r.id,date:r.date,reason:'destination-unattributed'});
  }
  if(new Set(unassigned.map(r=>r.id)).size!==unassigned.length) throw new Error('Duplicate unassigned identity.');
  const counts = new Map<string, number>();
  for (const r of candidates) {
    const key = r.accountId + ':' + r.fingerprint + ':' + r.occurrence;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ids = new Set<string>();
  let observedTransferCents = 0;
  for (const r of candidates) {
    day(r.date);
    if (ids.has(r.id)) throw new Error('Duplicate source identity.');
    ids.add(r.id);
    const decision = state.decisions[r.id];
    let reason = '';
    if (r.status !== 'posted') reason = 'not-posted';
    else if (r.currency !== plan.currency || accounts.get(r.accountId)?.currency !== plan.currency) reason = 'currency-mismatch';
    else if (!Number.isSafeInteger(r.outflowCents) || r.outflowCents <= 0) reason = 'not-positive-debit';
    else if (!r.sources.length || !r.fingerprint) reason = 'evidence-missing';
    else if (r.duplicateCandidate || (counts.get(r.accountId + ':' + r.fingerprint + ':' + r.occurrence) ?? 0) > 1) reason = 'duplicate-ambiguous';
    else if (decision && !['transfer', 'investment'].includes(decision.nature)) reason = 'manual-decision-excluded';
    if (reason) { excluded.push({ id: r.id, reason }); continue; }
    observedTransferCents += r.outflowCents;
    if (!Number.isSafeInteger(observedTransferCents)) throw new Error('Unsafe total.');
    included.push({ id: r.id, date: r.date, amountCents: r.outflowCents });
  }
  if (excluded.length) warnings.add('excluded-observations');
  return {
    schema: 'familyhub.contribution-progress.v1', ledgerRevision: state.revision,
    ledgerCollectedOn: data?.collectedOn ?? null, sourceAsOf: null, sourceFreshness: 'unknown', evaluatedOn: asOf,
    from: plan.from, through: plan.through, observedThrough: end,
    currency: plan.currency, personalGoalCents: plan.personalGoalCents,
    observedTransferCents, remainingAgainstObservedCents: Math.max(0, plan.personalGoalCents - observedTransferCents),
    confirmedContributionCents: null, taxContributionRoomCents: null,
    status: warnings.size ? 'partial' : 'observed-transfers-only',
    warnings: [...warnings].sort(), included, excluded, unassigned,
  };
}