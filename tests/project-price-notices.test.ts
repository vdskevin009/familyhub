import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPriceNotices, validateProjectPriceState, type ProjectPriceEvidence, type ProjectPriceState } from '../apps/worker/src/project-price-notices.ts';
import type { VehicleObservation } from '../apps/worker/src/vehicle-model.ts';
import type { PropertyObservation } from '../apps/worker/src/property-model.ts';

const at = (hour: number) => new Date(Date.UTC(2026, 10, 23, hour)).toISOString();
const now = (hour: number) => new Date(at(hour));
const fact = <T>(value: T | null, hour: number) => ({ value, sourceUrl: value === null ? null : 'https://example.com/synthetic-listing', checkedAt: value === null ? null : at(hour), note: 'Synthetic evidence only' });
function vehicle(hour: number, price: number | null = 29000): VehicleObservation {
  return { id: `v-${hour}`, listingId: 'synthetic-auto', observedAt: at(hour), title: 'Véhicule fictif', url: 'https://example.com/synthetic-listing',
    status: 'active', statusEvidence: fact('active', hour), priceBasis: 'before-tax', priceCad: fact(price, hour),
    make: fact('Synthetic', hour), model: fact('Family SUV', hour), year: fact(2021, hour), trim: fact(null, hour),
    mileageKm: fact(75000, hour), location: fact('Vancouver', hour), familySuv: fact(true, hour), used: fact(true, hour),
    greaterVancouver: fact(true, hour), awd: fact(null, hour), accidentHistory: fact(null, hour) };
}
function property(hour: number, price: number | null = 1600000): PropertyObservation {
  return { id: `p-${hour}`, listingId: 'synthetic-property', observedAt: at(hour), address: 'Adresse fictive', url: 'https://example.com/synthetic-listing',
    status: 'active', statusEvidence: fact('active', hour), priceCad: fact(price, hour), bedrooms: fact(3, hour),
    lowerLonsdale: fact(true, hour), separateEntrances: fact(true, hour), airbnb: { status: 'unknown', evidence: [] } };
}
const follow = (listingId = 'synthetic-auto', revision = 1, followed = true, hour = 9) => ({ requestId: `follow-${revision}`, listingId, followed, revision, recordedAt: at(hour) });
const evidence = (observations: ProjectPriceEvidence['observations'], followingHistory = [follow()]): ProjectPriceEvidence => ({ observations, followingHistory });
const initial = () => projectPriceNotices({ vehicle: evidence([vehicle(10)]) }, {}, now(10));
const changed = () => projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500)]) }, initial().state, now(12));
const onlyCursor = (state: ProjectPriceState) => Object.values(state)[0];

test('first successful read of a followed period is silent, even with historical price changes', () => {
  const result = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500)]) }, {}, now(12));
  assert.deepEqual(result.ready, ['vehicles']); assert.equal(result.candidates.length, 0);
  assert.equal(onlyCursor(result.state).fact?.value, 27500);
});

test('known newer price after explicit follow produces a dated private in-app notice', () => {
  const result = changed(), c = result.candidates[0];
  assert.equal(result.candidates.length, 1); assert.equal(c.kind, 'project-price'); assert.equal(c.source, 'vehicles');
  assert.equal(c.pushEligible, false); assert.deepEqual(c.target, { view: 'vehicle', recordId: 'synthetic-auto' });
  assert.equal(c.sourceDate, at(12)); assert.equal(c.expiresAt, at(60)); assert.equal(c.links?.length, 1);
  assert.match(c.title, /Auto.*29.*27/); assert.match(c.detail, /Véhicule fictif.*en baisse/);
  assert.match(c.detail, /Avant taxes et frais/); assert.match(c.detail, /ni une économie obtenue/);
  assert.equal(onlyCursor(result.state).notice?.before.checkedAt, at(10));
});

test('property uses its exact identity and independent source category', () => {
  const history = [follow('synthetic-property')];
  const baseline = projectPriceNotices({ property: evidence([property(10)], history) }, {}, now(10));
  const result = projectPriceNotices({ property: evidence([property(10), property(12, 1550000)], history) }, baseline.state, now(12));
  assert.deepEqual(result.ready, ['properties']); assert.equal(result.candidates[0].source, 'properties');
  assert.deepEqual(result.candidates[0].target, { view: 'property', recordId: 'synthetic-property' });
  assert.match(result.candidates[0].detail, /Adresse fictive/);
});

test('not-followed listings never alert, and a future follow cannot authorize a current notice', () => {
  const rows = [vehicle(10), vehicle(12, 27500)];
  assert.equal(projectPriceNotices({ vehicle: evidence(rows, []) }, {}, now(12)).candidates.length, 0);
  assert.equal(projectPriceNotices({ vehicle: evidence(rows, [follow('synthetic-auto', 1, true, 13)]) }, initial().state, now(12)).candidates.length, 0);
  const futureUnfollow = projectPriceNotices({ vehicle: evidence(rows, [follow(), follow('synthetic-auto', 2, false, 14)]) }, initial().state, now(12));
  assert.equal(futureUnfollow.candidates.length, 1);
});

test('repeated true keeps the first follow baseline; unfollow/refollow starts a silent new period', () => {
  const rows = [vehicle(10), vehicle(12, 27500)];
  const repeated = [follow(), follow('synthetic-auto', 2, true, 11)];
  const result = projectPriceNotices({ vehicle: evidence(rows, repeated) }, initial().state, now(12));
  assert.equal(result.candidates.length, 1); assert.equal(onlyCursor(result.state).periodRevision, 1);
  const unfollowed = [...repeated, follow('synthetic-auto', 3, false, 13)];
  assert.deepEqual(projectPriceNotices({ vehicle: evidence(rows, unfollowed) }, result.state, now(13)).state, {});
  const refollowed = [...unfollowed, follow('synthetic-auto', 4, true, 14)];
  const reset = projectPriceNotices({ vehicle: evidence([...rows, vehicle(15, 27000)], refollowed) }, result.state, now(15));
  assert.equal(reset.candidates.length, 0); assert.equal(onlyCursor(reset.state).periodStartedAt, at(14));
});

test('an unknown price resets the baseline, and the next known price is not a fabricated change', () => {
  const rows = [vehicle(10), vehicle(12, 27500), vehicle(13, null)];
  const unknown = projectPriceNotices({ vehicle: evidence(rows) }, changed().state, now(13));
  assert.equal(unknown.candidates.length, 0); assert.equal(onlyCursor(unknown.state).fact, null);
  const restored = projectPriceNotices({ vehicle: evidence([...rows, vehicle(14, 26000)]) }, unknown.state, now(14));
  assert.equal(restored.candidates.length, 0);
  assert.equal(projectPriceNotices({ vehicle: evidence([...rows, vehicle(14, 26000), vehicle(15, 25500)]) }, restored.state, now(15)).candidates.length, 1);
});

test('old price, future observation, inactive status, and old status suspend without resolving facts', () => {
  const before = changed();
  const variants = [
    { ...vehicle(13, 27500), priceCad: fact(27500, -40) },
    vehicle(14, 27500),
    vehicle(14, null),
    { ...vehicle(13, 27500), status: 'sold' as const, statusEvidence: fact('sold', 13) },
    { ...vehicle(13, 27500), statusEvidence: fact('active', -40) }
  ];
  for (const current of variants) {
    const result = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500), current]) }, before.state, now(13));
    assert.equal(result.candidates.length, 0); assert.deepEqual(result.state, before.state);
  }
});

test('an old baseline does not support a new price-change claim', () => {
  const result = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(60, 26000)]) }, initial().state, now(60));
  assert.equal(result.candidates.length, 0); assert.equal(onlyCursor(result.state).fact?.value, 26000);
});

test('price source, listing URL, or vehicle identity change creates a new silent baseline', () => {
  const variants = [
    { ...vehicle(12, 27500), priceCad: { ...fact(27500, 12), sourceUrl: 'https://example.org/other-source' } },
    { ...vehicle(12, 27500), url: 'https://example.com/relisted' },
    { ...vehicle(12, 27500), make: fact('Other', 12) },
    { ...vehicle(12, 27500), model: fact('Other', 12) },
    { ...vehicle(12, 27500), year: fact(2022, 12) },
    { ...vehicle(12, 27500), trim: fact('Other', 12) }
  ];
  for (const current of variants) {
    const result = projectPriceNotices({ vehicle: evidence([vehicle(10), current]) }, initial().state, now(12));
    assert.equal(result.candidates.length, 0); assert.equal(onlyCursor(result.state).fact?.value, 27500);
  }
});

test('missing vehicle model identity never supports a price notice', () => {
  for (const field of ['make', 'model', 'year'] as const) {
    const current = vehicle(12, 27500); (current[field] as { value: unknown }).value = null;
    current[field].sourceUrl = null; current[field].checkedAt = null;
    assert.equal(projectPriceNotices({ vehicle: evidence([vehicle(10), current]) }, initial().state, now(12)).candidates.length, 0);
  }
});

test('changed property address does not inherit an old listing-price comparison', () => {
  const history = [follow('synthetic-property')];
  const baseline = projectPriceNotices({ property: evidence([property(10)], history) }, {}, now(10));
  const result = projectPriceNotices({ property: evidence([property(10), { ...property(12, 1500000), address: 'Autre adresse fictive' }], history) }, baseline.state, now(12));
  assert.equal(result.candidates.length, 0);
});

test('late intermediate B11 cannot duplicate B12; recheck B13 does not renew evidence or expiration', () => {
  const result = changed(), original = result.candidates[0];
  const late = projectPriceNotices({ vehicle: evidence([vehicle(12, 27500), vehicle(11, 27500), vehicle(10)]) }, result.state, now(13));
  assert.equal(late.candidates[0].key, original.key); assert.equal(late.candidates[0].sourceDate, at(12));
  const rechecked = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(11, 27500), vehicle(12, 27500), vehicle(13, 27500)]) }, late.state, now(13));
  assert.deepEqual(rechecked.candidates, result.candidates); assert.equal(onlyCursor(rechecked.state).frontierAt, at(13));
});

test('a delayed newly ingested old fact cannot lower the durable frontier', () => {
  const result = changed(), delayed = { ...vehicle(13, 28000), priceCad: fact(28000, 11) };
  const next = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500), delayed]) }, result.state, now(13));
  assert.equal(next.candidates.length, 0); assert.deepEqual(next.state, result.state);
});

test('returning to the same price preserves key and evidenceKey for persistent library deduplication', () => {
  const first = changed();
  const increase = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500), vehicle(13)]) }, first.state, now(13));
  assert.match(increase.candidates[0].detail, /en hausse/);
  const returned = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500), vehicle(13), vehicle(14, 27500)]) }, increase.state, now(14));
  assert.equal(returned.candidates[0].key, first.candidates[0].key);
  assert.equal(returned.candidates[0].evidenceKey, first.candidates[0].evidenceKey);
});

test('equal price fact dates with incompatible values refuse arbitrary observation ordering', () => {
  const conflict = { ...vehicle(13, 28000), priceCad: fact(28000, 12) };
  const rows = [vehicle(10), vehicle(12, 27500), conflict];
  assert.equal(projectPriceNotices({ vehicle: evidence(rows) }, initial().state, now(13)).candidates.length, 0);
  assert.equal(projectPriceNotices({ vehicle: evidence([...rows].reverse()) }, initial().state, now(13)).candidates.length, 0);
});

test('equal observation dates with incompatible statuses cannot acquire a lexical ID order', () => {
  const current = vehicle(12, 27500), conflict = { ...current, id: 'another-id', status: 'sold' as const, statusEvidence: fact('sold', 12) };
  assert.equal(projectPriceNotices({ vehicle: evidence([vehicle(10), current, conflict]) }, initial().state, now(12)).candidates.length, 0);
});

test('expired notice is not renewed by current equal-price evidence', () => {
  const result = changed();
  const later = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500), vehicle(61, 27500)]) }, result.state, now(61));
  assert.equal(later.candidates.length, 0); assert.equal(onlyCursor(later.state).notice?.after.checkedAt, at(12));
});

test('serialized restart preserves notice identity and source dates, without mutating input state', () => {
  const previous = changed(), serialized = JSON.stringify(previous.state);
  const restarted = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500)]) }, JSON.parse(serialized), now(13));
  assert.deepEqual(restarted.candidates, previous.candidates); assert.equal(JSON.stringify(previous.state), serialized);
  assert.deepEqual(validateProjectPriceState(JSON.parse(serialized)), previous.state);
});

test('unavailable domain preserves its cursor and is not reported ready', () => {
  const previous = changed();
  const missing = projectPriceNotices({}, previous.state, now(13));
  assert.deepEqual(missing.state, previous.state); assert.deepEqual(missing.ready, []); assert.deepEqual(missing.candidates, []);
  const propertyOnly = projectPriceNotices({ property: evidence([], []) }, previous.state, now(13));
  assert.deepEqual(propertyOnly.state, previous.state); assert.deepEqual(propertyOnly.ready, ['properties']);
});

test('malformed durable evidence and observation conflicts fail closed', () => {
  assert.throws(() => validateProjectPriceState([])); assert.throws(() => validateProjectPriceState({ arbitrary: {} }));
  const state = changed().state, key = Object.keys(state)[0];
  assert.throws(() => validateProjectPriceState({ ...state, [key]: { ...state[key], secret: 'extra field' } }));
  assert.throws(() => validateProjectPriceState({ ...state, [key]: { ...state[key], frontierAt: at(11) } }));
  const conflict = { ...vehicle(10, 28000), observedAt: at(12) };
  assert.throws(() => projectPriceNotices({ vehicle: evidence([vehicle(10), conflict]) }, {}, now(12)));
  assert.throws(() => projectPriceNotices({ vehicle: evidence([vehicle(10)], [follow('synthetic-auto', 2)]) }, {}, now(12)));
  assert.throws(() => projectPriceNotices({ vehicle: evidence([vehicle(10)], [{ ...follow(), recordedAt: '2026-11-23T09:00:00' }]) }, {}, now(12)));
});

test('unrepresentable prices abstain, while actual cents remain visible', () => {
  for (const value of [27500.001, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER / 10]) {
    const result = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, value)]) }, initial().state, now(12));
    assert.equal(result.candidates.length, 0); assert.equal(onlyCursor(result.state).fact, null);
  }
  const cents = projectPriceNotices({ vehicle: evidence([vehicle(10), vehicle(12, 27500.25)]) }, initial().state, now(12));
  assert.match(cents.candidates[0].title, /500,25/);
  assert.equal(onlyCursor(cents.state).notice?.after.value, 27500.25);
  const state = changed().state, key = Object.keys(state)[0];
  assert.throws(() => validateProjectPriceState({ ...state, [key]: { ...state[key], fact: { ...state[key].fact, value: 27500.001 } } }));
});
