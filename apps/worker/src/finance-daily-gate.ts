import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {join, dirname} from 'node:path';

export const financeStages = ['collection', 'accounts', 'balances', 'transactions', 'contributions'] as const;
export type FinanceStage = typeof financeStages[number];
export type DailyFinanceScope = {
  schema: 1; inferencePolicySha256?: string;
  periods: {from: string; through: string}[];
  subjects: Record<FinanceStage, string[]>;
};
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
export const dailyFinanceDigest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
function realDay(value: string): boolean {
  const d = new Date(value + 'T12:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function financeScopeDigest(scope: DailyFinanceScope): string {
  if (scope.inferencePolicySha256!==undefined && !hashPattern.test(scope.inferencePolicySha256))throw Error('Invalid inference policy pin.');
  if (scope.schema !== 1 || !Array.isArray(scope.periods) || !scope.periods.length || !scope.subjects ||
      Object.keys(scope.subjects).sort().join('|') !== [...financeStages].sort().join('|') ||
      scope.periods.some(p => !realDay(p.from) || !realDay(p.through) || p.from > p.through)) throw Error('Invalid private finance scope.');
  for (const stage of financeStages) {
    const ids = scope.subjects[stage];
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw Error('Invalid private stage scope.');
  }
  return dailyFinanceDigest({...scope, schema: scope.schema,
    periods: [...scope.periods].sort((a,b) => canonical(a).localeCompare(canonical(b))),
    subjects: Object.fromEntries(financeStages.map(stage => [stage, [...scope.subjects[stage]].sort()]))});
}
export function vancouverFinanceTime(now: Date): {day: string; minute: number} {
  if (!Number.isFinite(now.getTime())) throw Error('Invalid gate clock.');
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now);
  const get = (kind: string) => parts.find(p => p.type === kind)!.value;
  return {day: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute'))};
}
export type StageReceiptPayload = {
  schema: 1; stage: FinanceStage; attemptId: string; localDate: string; scopeDigest: string;
  status: 'confirmed' | 'partial' | 'failed';
  verificationLimits?: string[];
  confirmedSubjectIds: string[];
  retainedUnassigned?: {subjectId: string; evidenceDigests: string[]; sourceNative: true; persisted: true; readbackVerified: true; limits: string[]}[];
  evidenceDigests: string[];
  withheldCount: number; uncertainWrite: boolean;
  sourceFreshness: 'unknown' | 'dated';
  sourceAsOf: string | null;
};
export type StageReceipt = {payload: StageReceiptPayload; digest: string};
export type StageReport = {writeOutcome: 'confirmed' | 'not-applied' | 'uncertain'; receipts: StageReceipt[]};
export type FinanceAttempt = {id: string; localDate: string; scopeDigest: string; startedAt: string; leaseExpiresAt: string};
type DayRecord = {scopeDigest: string; status: 'partial' | 'pending' | 'complete'; lastAttemptAt: string; attemptId: string; receiptDigests?: string[]; completedAt?: string; artifactDigest?: string};
export type DailyFinanceState = {schema: 1; revision: number; days: Record<string, DayRecord>; pending?: FinanceAttempt};
export type FinanceGateDecision = {action: 'collect' | 'recover' | 'skip'; reason: string; localDate: string};

export function decideDailyFinance(state: DailyFinanceState, scopeDigest: string, now: Date): FinanceGateDecision {
  const {day, minute} = vancouverFinanceTime(now);
  const current = state.days[day];
  if (current && current.scopeDigest !== scopeDigest) throw Error('Same-day intended scope changed; review required.');
  if (state.pending && state.pending.scopeDigest !== scopeDigest) throw Error('Pending intended scope changed; review required.');
  if (current?.status === 'complete') {
    if (state.pending) throw Error('Completed state conflicts with pending work.');
    return {action: 'skip', reason: 'already-complete', localDate: day};
  }
  // The final 20:00 slot may be delivered through 20:59; never start at 21:00.
  if (minute < 8 * 60 || minute >= 21 * 60) return {action: 'skip', reason: 'outside-window', localDate: day};
  const recent = Object.values(state.days).filter(r => r.scopeDigest === scopeDigest).map(r => r.lastAttemptAt).sort((a,b) => Date.parse(b)-Date.parse(a))[0] ?? state.pending?.startedAt;
  if (recent) {
    const elapsed = now.getTime() - Date.parse(recent);
    if (!Number.isFinite(elapsed) || elapsed < 0) throw Error('Clock/state regression requires review.');
    if (elapsed < 60 * 60_000) return {action: 'skip', reason: 'retry-not-due', localDate: day};
  }
  return {action: state.pending ? 'recover' : 'collect', reason: state.pending ? 'pending-readback-only' : 'due', localDate: day};
}

export function validateReceipt(receipt: StageReceipt, attempt: FinanceAttempt, scope: DailyFinanceScope): boolean {
  const p = receipt.payload;
  if (!p || dailyFinanceDigest(p) !== receipt.digest || !hashPattern.test(receipt.digest) || p.schema !== 1 ||
      !financeStages.includes(p.stage) || p.attemptId !== attempt.id || p.localDate !== attempt.localDate || p.scopeDigest !== attempt.scopeDigest ||
      (p.verificationLimits !== undefined && (!Array.isArray(p.verificationLimits) || p.verificationLimits.some(limit => typeof limit !== 'string' || !limit.trim()))) ||
      !Array.isArray(p.confirmedSubjectIds) || new Set(p.confirmedSubjectIds).size !== p.confirmedSubjectIds.length ||
      p.confirmedSubjectIds.some(id => !scope.subjects[p.stage].includes(id)) ||
      !Array.isArray(p.evidenceDigests) || !p.evidenceDigests.length || p.evidenceDigests.some(d => !hashPattern.test(d)) ||
      !Number.isSafeInteger(p.withheldCount) || p.withheldCount < 0 || typeof p.uncertainWrite !== 'boolean' ||
      !['confirmed','partial','failed'].includes(p.status) || !['unknown','dated'].includes(p.sourceFreshness) ||
      (p.sourceFreshness === 'unknown' ? p.sourceAsOf !== null : typeof p.sourceAsOf !== 'string' || !realDay(p.sourceAsOf.slice(0,10)) || !Number.isFinite(Date.parse(p.sourceAsOf)))) throw Error('Invalid authoritative stage receipt.');
  const retained = p.retainedUnassigned ?? [];
  if (!Array.isArray(retained) || retained.some(r => !r || !scope.subjects[p.stage].includes(r.subjectId) ||
      r.sourceNative !== true || r.persisted !== true || r.readbackVerified !== true ||
      !Array.isArray(r.evidenceDigests) || !r.evidenceDigests.length || r.evidenceDigests.some(d => !hashPattern.test(d) || !p.evidenceDigests.includes(d)) ||
      !Array.isArray(r.limits) || !r.limits.length || r.limits.some(limit => typeof limit !== 'string' || !limit.trim()))) throw Error('Unassigned source retention proof invalid.');
  const covered = [...p.confirmedSubjectIds, ...retained.map(r => r.subjectId)];
  if (new Set(covered).size !== covered.length) throw Error('Duplicate stage subject proof.');
  return p.status === 'confirmed' && p.withheldCount === 0 && !p.uncertainWrite &&
    [...covered].sort().join('\0') === [...scope.subjects[p.stage]].sort().join('\0');
}

export type FinanceGateCallbacks = {
  /** Called only after the local gate has persisted a pending attempt. */
  collect: (attempt: FinanceAttempt) => Promise<StageReport>;
  /** MUST perform authoritative reads only. No plugin collection, import, retry POST, or writes. */
  recoverReadOnly: (attempt: FinanceAttempt) => Promise<StageReport>;
  /** Compare receipt to actual stage artifacts/readback, not just its own digest/boolean. */
  verifyReceiptReadOnly: (receipt: StageReceipt, attempt: FinanceAttempt) => Promise<boolean>;
  /** Certify reported write outcome against authoritative state, including a no-write proof. */
  verifyOutcomeReadOnly: (report: StageReport, attempt: FinanceAttempt) => Promise<boolean>;
};
type Options = {directory: string; scope: DailyFinanceScope; clock?: () => Date; callbacks: FinanceGateCallbacks; checkpoint?: (phase: string) => Promise<void>};
export async function readState(path: string): Promise<DailyFinanceState> {
  let value: DailyFinanceState;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {schema: 1, revision: 0, days: {}};
    throw e;
  }
  if (value.schema !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.days || typeof value.days !== 'object' || Array.isArray(value.days)) throw Error('Invalid private completion state.');
  for (const [day, record] of Object.entries(value.days)) {
    if (!realDay(day) || !record || !hashPattern.test(record.scopeDigest) || !['partial','pending','complete'].includes(record.status) || !Number.isFinite(Date.parse(record.lastAttemptAt)) || !record.attemptId ||
        (record.status === 'complete' && (!record.completedAt || !Number.isFinite(Date.parse(record.completedAt)) || record.receiptDigests?.length !== financeStages.length || record.receiptDigests.some(d => !hashPattern.test(d)) || !record.artifactDigest || !hashPattern.test(record.artifactDigest)))) throw Error('Invalid private daily record.');
  }
    for (const [day, record] of Object.entries(value.days)) if (record.status === 'complete') {
    const artifact = JSON.parse(await readFile(join(dirname(path), 'verified-' + record.artifactDigest + '.json'), 'utf8'));
    if (dailyFinanceDigest(artifact) !== record.artifactDigest || artifact.complete !== true || artifact.attempt?.localDate !== day || artifact.attempt?.id !== record.attemptId || artifact.attempt?.scopeDigest !== record.scopeDigest || artifact.report?.writeOutcome !== 'confirmed' || canonical(artifact.report.receipts?.map((r:StageReceipt)=>r.digest)) !== canonical(record.receiptDigests)) throw Error('Stored completion proof mismatch.');
  }
  if (value.pending) {
    const p = value.pending, record = value.days[p.localDate];
    if (!p.id || !realDay(p.localDate) || !hashPattern.test(p.scopeDigest) || !Number.isFinite(Date.parse(p.startedAt)) || !Number.isFinite(Date.parse(p.leaseExpiresAt)) || !record || record.status !== 'pending' || record.attemptId !== p.id || record.scopeDigest !== p.scopeDigest) throw Error('Invalid pending attempt.');
  } else if (Object.values(value.days).some(r => r.status === 'pending')) throw Error('Pending record has no recovery context.');
  return value;
}
export async function durableExclusive(path: string, bytes: string) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export async function replace(path: string, state: DailyFinanceState) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const bytes = JSON.stringify(state); await durableExclusive(temporary, bytes); await rename(temporary, path);
  if (await readFile(path, 'utf8') !== bytes) throw Error('Completion state readback mismatch.');
}
export async function runDailyFinanceGate(options: Options) {
  const clock = options.clock ?? (() => new Date()), scope = structuredClone(options.scope), scopeDigest = financeScopeDigest(scope);
  const dir = join(options.directory, 'finance-feed', 'daily-gate'), statePath = join(dir, 'state.json');
  await mkdir(dir, {recursive: true});
  const lockPath = join(dir, 'lease.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return {action: 'skip', reason: 'locked-review-if-stale', complete: false};
    throw e;
  }
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, token: randomUUID(), acquiredAt: clock().toISOString(), leaseExpiresAt: new Date(clock().getTime() + 55 * 60_000).toISOString()})); await lock.sync();
    let state = await readState(statePath);
    const decision = decideDailyFinance(state, scopeDigest, clock());
        if (decision.action === 'skip') {
      if (decision.reason === 'already-complete') {
        const record = state.days[decision.localDate];
        const artifact = JSON.parse(await readFile(join(dir, 'verified-' + record.artifactDigest + '.json'), 'utf8'));
        if (artifact.report.receipts.length !== financeStages.length || new Set(artifact.report.receipts.map((r:StageReceipt)=>r.payload.stage)).size !== financeStages.length || !artifact.report.receipts.every((r:StageReceipt)=>validateReceipt(r,artifact.attempt,scope))) throw Error('Stored stage scope proof mismatch.');
      }
      return {...decision, complete: decision.reason === 'already-complete', notificationDue: decision.reason !== 'already-complete' && vancouverFinanceTime(clock()).minute >= 21 * 60};
    }
    const invocationStartedAt = clock().toISOString();
    const attempt: FinanceAttempt = decision.action === 'recover' ? state.pending! : {
      id: randomUUID(), localDate: decision.localDate, scopeDigest, startedAt: invocationStartedAt, leaseExpiresAt: new Date(Date.parse(invocationStartedAt) + 55 * 60_000).toISOString()};
    const deadline = Date.parse(invocationStartedAt) + 55 * 60_000;
    if (decision.action === 'collect') {
      state = {...state, revision: state.revision + 1, pending: attempt, days: {...state.days, [attempt.localDate]: {scopeDigest, status: 'pending', lastAttemptAt: attempt.startedAt, attemptId: attempt.id}}};
      await replace(statePath, state);
    }
        if (decision.action === 'recover') {
      state = {...state, revision: state.revision + 1, days: {...state.days,
        [attempt.localDate]: {...state.days[attempt.localDate], lastAttemptAt: invocationStartedAt}}};
      await replace(statePath, state);
    }
    const expectedDigest = dailyFinanceDigest(state);
    await options.checkpoint?.('pending');
        const assertCallbackWindow = () => {
      const time = vancouverFinanceTime(clock());
      if (time.minute < 8 * 60 || time.minute >= 21 * 60 || time.day !== decision.localDate) throw Error('Collection window closed; verification deferred to read-only recovery.');
    };
    assertCallbackWindow();
    const report = structuredClone(decision.action === 'recover' ? await options.callbacks.recoverReadOnly(structuredClone(attempt)) : await options.callbacks.collect(structuredClone(attempt)));
    if (!report || !['confirmed','not-applied','uncertain'].includes(report.writeOutcome) || !Array.isArray(report.receipts) || report.receipts.length > financeStages.length || new Set(report.receipts.map(r => r.payload?.stage)).size !== report.receipts.length) throw Error('Invalid stage report.');
    let all = report.receipts.length === financeStages.length;
    for (const receipt of report.receipts) {
      const complete = validateReceipt(receipt, attempt, scope);
      assertCallbackWindow();
      if (await options.callbacks.verifyReceiptReadOnly(structuredClone(receipt), structuredClone(attempt)) !== true) throw Error('Stage readback unconfirmed.');
      all = all && complete;
    }
    if (report.writeOutcome === 'uncertain' || report.receipts.some(r => r.payload.uncertainWrite)) return {...decision, complete: false, reason: 'pending-uncertain-readback', notificationDue: vancouverFinanceTime(clock()).minute >= 21 * 60};
    assertCallbackWindow();
    if (await options.callbacks.verifyOutcomeReadOnly(structuredClone(report), structuredClone(attempt)) !== true) throw Error('Write outcome readback unconfirmed.');
    if (clock().getTime() < Date.parse(invocationStartedAt) || clock().getTime() > deadline) throw Error('Gate lease elapsed; verification remains pending.');
    if (dailyFinanceDigest(await readState(statePath)) !== expectedDigest) throw Error('Completion state changed concurrently.');
    const complete = report.writeOutcome === 'confirmed' && all;
    const artifact = {schema: 1, attempt, report, verifiedAt: clock().toISOString(), complete};
    const artifactDigest = dailyFinanceDigest(artifact);
    const artifactPath = join(dir, 'verified-' + artifactDigest + '.json'), artifactBytes = JSON.stringify(artifact);
    try { await durableExclusive(artifactPath, artifactBytes); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(artifactPath, 'utf8') !== artifactBytes) throw e; }
    state = {...state, revision: state.revision + 1, days: {...state.days, [attempt.localDate]: {
      scopeDigest, status: complete ? 'complete' : 'partial', lastAttemptAt: invocationStartedAt, attemptId: attempt.id,
      receiptDigests: report.receipts.map(r => r.digest), artifactDigest, ...(complete ? {completedAt: clock().toISOString()} : {})}}};
    delete state.pending;
    await options.checkpoint?.('verified');
    if (dailyFinanceDigest(await readState(statePath)) !== expectedDigest) throw Error('Completion state changed before final write.');
    await replace(statePath, state);
    return {...decision, reason: complete ? (attempt.localDate === decision.localDate ? 'complete-verified' : 'prior-day-recovered') : 'partial-retry-later', complete: complete && attempt.localDate === decision.localDate, notificationDue: (!complete || attempt.localDate !== decision.localDate) && vancouverFinanceTime(clock()).minute >= 21 * 60, completedLocalDate: complete ? attempt.localDate : null};
  } finally { await lock.close(); await unlink(lockPath); }
}
