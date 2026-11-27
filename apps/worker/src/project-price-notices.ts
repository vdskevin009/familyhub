import { createHash } from 'node:crypto';
import { validateProperty, type PropertyObservation } from './property-model.js';
import { validateVehicle, type VehicleObservation } from './vehicle-model.js';
import type { FollowingDecision } from './vehicle-project.js';
import type { Candidate } from './notification-model.js';

export type ProjectPriceEvidence = {
  observations: (VehicleObservation | PropertyObservation)[];
  followingHistory: FollowingDecision[];
};
type Domain = 'vehicle' | 'property';
type Fact = { value: number; checkedAt: string; sourceUrl: string };
type Notice = { before: Fact; after: Fact };
type Cursor = {
  version: 1; domain: Domain; listingId: string;
  periodRevision: number; periodStartedAt: string;
  identity: string | null; frontierAt: string | null;
  fact: Fact | null; notice: Notice | null;
};
export type ProjectPriceState = Record<string, Cursor>;
const horizon = 48 * 60 * 60 * 1000;
const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const cursorKey = (domain: Domain, listingId: string) => hash([domain, listingId]);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const stamp = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const safeUrl = (v: unknown): v is string => {
  if (!text(v, 2000)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
};
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const validPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  && Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) <= 0.000001;
function validFact(v: unknown): v is Fact {
  return record(v) && exactKeys(v, ['value', 'checkedAt', 'sourceUrl'])
    && validPrice(v.value) && stamp(v.checkedAt) && safeUrl(v.sourceUrl);
}

/** Fail closed on unreadable state; callers persist the returned copy only with the notification transaction. */
export function validateProjectPriceState(input: unknown): ProjectPriceState {
  if (!record(input) || Object.keys(input).length > 5000) throw Error('Invalid project price notification state');
  for (const [key, v] of Object.entries(input)) {
    if (!record(v) || !exactKeys(v, ['version', 'domain', 'listingId', 'periodRevision', 'periodStartedAt', 'identity', 'frontierAt', 'fact', 'notice'])
      || !digest(key) || v.version !== 1 || !['vehicle', 'property'].includes(String(v.domain)) || !text(v.listingId, 160)
      || key !== cursorKey(v.domain as Domain, v.listingId) || !Number.isSafeInteger(v.periodRevision) || Number(v.periodRevision) < 1
      || !stamp(v.periodStartedAt) || v.identity !== null && !digest(v.identity) || v.frontierAt !== null && !stamp(v.frontierAt)
      || v.fact !== null && !validFact(v.fact)) throw Error('Invalid project price notification cursor');
    if (v.fact !== null && (v.identity === null || v.frontierAt !== v.fact.checkedAt)
      || v.fact === null && (v.identity !== null || v.notice !== null)) throw Error('Inconsistent project price notification baseline');
    if (v.notice !== null) {
      if (!record(v.notice) || !exactKeys(v.notice, ['before', 'after']) || !validFact(v.notice.before) || !validFact(v.notice.after)
        || !validFact(v.fact) || v.notice.before.sourceUrl !== v.notice.after.sourceUrl
        || v.notice.after.sourceUrl !== v.fact.sourceUrl || v.notice.after.value !== v.fact.value
        || v.notice.before.value === v.notice.after.value || v.notice.before.checkedAt >= v.notice.after.checkedAt
        || v.notice.after.checkedAt < v.periodStartedAt || v.notice.after.checkedAt > v.fact.checkedAt) throw Error('Invalid project price notification evidence');
    }
  }
  return JSON.parse(JSON.stringify(input)) as ProjectPriceState;
}

function periods(history: FollowingDecision[], now: number) {
  if (!Array.isArray(history)) throw Error('Invalid project following history');
  const result = new Map<string, { revision: number; startedAt: string }>();
  const ids = new Set<string>();
  let previousAt = -Infinity;
  for (const [index, d] of [...history].sort((a, b) => a.revision - b.revision).entries()) {
    if (!d || !text(d.requestId, 160) || ids.has(d.requestId) || !text(d.listingId, 160) || typeof d.followed !== 'boolean'
      || d.revision !== index + 1 || !text(d.recordedAt, 40) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(d.recordedAt)
      || !Number.isFinite(Date.parse(d.recordedAt)) || Date.parse(d.recordedAt) < previousAt) throw Error('Invalid project following history');
    ids.add(d.requestId); previousAt = Date.parse(d.recordedAt);
    // A future decision cannot authorize a present notification or reset an existing period.
    if (previousAt > now) continue;
    if (!d.followed) result.delete(d.listingId);
    else if (!result.has(d.listingId)) result.set(d.listingId, { revision: d.revision, startedAt: new Date(d.recordedAt).toISOString() });
  }
  return result;
}

function identity(domain: Domain, p: VehicleObservation | PropertyObservation): string | null {
  if (!p.priceCad.sourceUrl) return null;
  if (domain === 'vehicle') {
    const v = p as VehicleObservation;
    if (v.make.value === null || v.model.value === null || v.year.value === null) return null;
    return hash([domain, v.listingId, v.url, v.priceCad.sourceUrl, v.priceBasis, v.make.value, v.model.value, v.year.value, v.trim.value]);
  }
  return hash([domain, p.listingId, p.url, p.priceCad.sourceUrl, 'CAD', (p as PropertyObservation).address]);
}
const priceFact = (p: VehicleObservation | PropertyObservation): Fact | null => !validPrice(p.priceCad.value) ? null : {
  value: Math.round(p.priceCad.value * 100) / 100, checkedAt: new Date(p.priceCad.checkedAt!).toISOString(), sourceUrl: p.priceCad.sourceUrl!
};
function selectedObservation(domain: Domain, rows: (VehicleObservation | PropertyObservation)[]) {
  const byDate = new Map<number, string>();
  for (const row of rows) {
    if (row.priceCad.value === null) continue;
    const at = Date.parse(row.priceCad.checkedAt!);
    const proof = JSON.stringify([identity(domain, row), row.priceCad.value]);
    if (byDate.has(at) && byDate.get(at) !== proof) return null;
    byDate.set(at, proof);
  }
  const latestAt = rows.reduce((latest, row) => Math.max(latest, Date.parse(row.observedAt)), -Infinity);
  const latest = rows.filter(row => Date.parse(row.observedAt) === latestAt);
  const signature = (p: VehicleObservation | PropertyObservation) => JSON.stringify([
    identity(domain, p), priceFact(p), p.status, p.statusEvidence.checkedAt && new Date(p.statusEvidence.checkedAt).toISOString()
  ]);
  // Source observations sharing a timestamp do not acquire order from arbitrary IDs.
  return latest.every(row => signature(row) === signature(latest[0])) ? latest[0] : null;
}
function baseline(cursor: Cursor, fact: Fact, id: string) {
  cursor.identity = id; cursor.fact = fact; cursor.frontierAt = fact.checkedAt; cursor.notice = null;
}
const money = (value: number) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

/** Pure saved-evidence projection: no collector, network, persistence or Push is performed. */
export function projectPriceNotices(
  input: { vehicle?: ProjectPriceEvidence; property?: ProjectPriceEvidence }, savedState: ProjectPriceState, now = new Date()
): { candidates: Candidate[]; ready: ('vehicles' | 'properties')[]; state: ProjectPriceState } {
  const state = validateProjectPriceState(savedState), candidates: Candidate[] = [], ready: ('vehicles' | 'properties')[] = [];
  const time = now.getTime();
  if (!Number.isFinite(time)) throw Error('Invalid project price observation clock');
  const fresh = (at: string) => Number.isFinite(Date.parse(at)) && Date.parse(at) <= time && time - Date.parse(at) <= horizon;
  for (const domain of ['vehicle', 'property'] as const) {
    const evidence = input[domain];
    if (evidence === undefined) continue;
    if (!evidence || !Array.isArray(evidence.observations)) throw Error('Invalid project price evidence');
    const following = periods(evidence.followingHistory, time);
    const rows = new Map<string, (VehicleObservation | PropertyObservation)[]>(), observedIds = new Map<string, string>();
    for (const raw of evidence.observations) {
      const p = domain === 'vehicle' ? validateVehicle(raw) : validateProperty(raw);
      const content = JSON.stringify(p);
      if (observedIds.has(p.id) && observedIds.get(p.id) !== content) throw Error('Conflicting project observation ID');
      observedIds.set(p.id, content);
      const history = rows.get(p.listingId) ?? [];
      history.push(p); rows.set(p.listingId, history);
    }
    const source = domain === 'vehicle' ? 'vehicles' : 'properties';
    ready.push(source);
    for (const [key, cursor] of Object.entries(state)) if (cursor.domain === domain && !following.has(cursor.listingId)) delete state[key];
    for (const [listingId, period] of following) {
      const key = cursorKey(domain, listingId), previous = state[key];
      const cursor = previous?.periodRevision === period.revision && previous.periodStartedAt === period.startedAt ? previous : {
        version: 1 as const, domain, listingId, periodRevision: period.revision, periodStartedAt: period.startedAt,
        identity: null, frontierAt: null, fact: null, notice: null
      };
      state[key] = cursor;
      const observations = rows.get(listingId);
      if (!observations?.length) continue;
      const current = selectedObservation(domain, observations);
      if (!current) continue;
      if (!fresh(current.observedAt)) continue;
      const fact = priceFact(current), id = identity(domain, current);
      if (fact === null || id === null) {
        cursor.fact = null; cursor.identity = null; cursor.notice = null;
        continue;
      }
      if (!fresh(fact.checkedAt) || current.status !== 'active'
        || !current.statusEvidence.checkedAt || !fresh(current.statusEvidence.checkedAt)) continue;
      if (cursor.frontierAt && fact.checkedAt < cursor.frontierAt) continue;
      if (!cursor.fact || cursor.identity !== id) { baseline(cursor, fact, id); continue; }
      if (fact.checkedAt === cursor.frontierAt && fact.value !== cursor.fact.value) continue;
      if (fact.value !== cursor.fact.value) {
        if (fact.checkedAt <= cursor.fact.checkedAt || fact.checkedAt < period.startedAt || !fresh(cursor.fact.checkedAt)) {
          baseline(cursor, fact, id); continue;
        }
        cursor.notice = { before: { ...cursor.fact }, after: { ...fact } };
      }
      cursor.fact = fact; cursor.frontierAt = fact.checkedAt;
      const notice = cursor.notice;
      if (!notice || !fresh(notice.after.checkedAt) || time >= Date.parse(notice.after.checkedAt) + horizon) continue;
      // Conservative identity: a return to an already signalled price cannot rearm a notification.
      const noticeKey = 'project-price:' + hash([domain, listingId, id, fact.value]);
      const label = domain === 'vehicle' ? (current as VehicleObservation).title : (current as PropertyObservation).address;
      candidates.push({
        key: noticeKey, groupKey: `project-price:${domain}:${listingId}`, evidenceKey: noticeKey,
        source, kind: 'project-price', actionable: true, pushEligible: false, priority: 1,
        expiresAt: new Date(Date.parse(notice.after.checkedAt) + horizon).toISOString(),
        title: `${domain === 'vehicle' ? 'Auto' : 'Bien'} : ${label} — ${money(notice.before.value)} → ${money(notice.after.value)}`,
        detail: `${label}. Prix affiché ${notice.after.value < notice.before.value ? 'en baisse' : 'en hausse'} : ${money(notice.before.value)} (source vérifiée le ${dateLabel(notice.before.checkedAt)}) → ${money(notice.after.value)} (source vérifiée le ${dateLabel(notice.after.checkedAt)}). ${domain === 'vehicle' ? 'Avant taxes et frais. ' : ''}Ce changement de prix affiché n'est ni une économie obtenue ni une évaluation du bien.`,
        target: { view: domain, recordId: listingId }, sourceDate: notice.after.checkedAt,
        links: [{ label: 'Annonce et prix observés', url: notice.after.sourceUrl }]
      });
    }
  }
  return { candidates, ready, state: validateProjectPriceState(state) };
}
