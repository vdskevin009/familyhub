import test from 'node:test';
import assert from 'node:assert/strict';
import { insurerSyncMessage, insurerCollectionNeedsRefresh, applicableInsurerPreview, insurerCoverageNotice, insurerCoverageSummary, invoiceCollectionNotice } from '../apps/web/src/insurer-sync';
import { fetchInvoices, type BlueCrossSyncStatus } from '../apps/web/src/worker';

test('interrupted sign-in and missing diagnostic do not assert expiration or credential rejection', () => {
  for (const authReason of ['login-incomplete', undefined] as const) {
    const status = { state: 'login-required' as const, authReason };
    const detail = insurerSyncMessage(status, null, false);
    const fallback = insurerSyncMessage(null, { status: 'login-required' }, false);
    assert.doesNotMatch(fallback, /expired|reconnect|incorrect|refused/i);
    assert.doesNotMatch(detail + insurerCoverageNotice(status), /expired|reconnect|incorrect|refused/i);
    assert.match(detail, /Saved claims remain available/);
    assert.equal(applicableInsurerPreview(status, { status: 'success', complete: true, new: 1 }), false);
  }
  assert.match(insurerSyncMessage({ state: 'login-required', authReason: 'login-incomplete' }, null, false), /outcome is uncertain.*retries are paused/);
});

test('legacy unknown-layout status does not assert an expired session or request a new sign-in', () => {
  const status = { state: 'login-required' as const, authReason: 'layout-changed' as const, lastSuccess: '2026-07-01T12:00:00Z' };
  const detail = insurerSyncMessage(status, null, false);
  const coverage = insurerCoverageNotice(status)!;
  assert.match(detail, /insurer page was not recognized.*history could not be collected/i);
  assert.match(detail, /Saved claims remain available/);
  assert.match(coverage, /history unavailable.*payments may be missing/i);
  assert.doesNotMatch(detail + coverage, /sign.in|session expired|reconnect/i);
  assert.equal(applicableInsurerPreview(status, { status: 'success', new: 1, complete: true }), false);
});

test('a complete ambiguous collection is reviewable evidence, not a failed or incomplete read', () => {
  const status = { state: 'idle' as const, lastSuccess: '2026-07-09T11:00:00Z', latestResult: { status: 'success' as const, applied: false, complete: true, autoImported: 0, pendingNew: 0, pendingChanged: 0, ambiguous: 1, errors: 0 } };
  const notice = insurerCoverageNotice(status, Date.parse('2026-07-09T12:00:00Z'))!;
  assert.match(notice, /Collection complete; 1 insurer record needs review/);
  assert.doesNotMatch(notice, /incomplete|payments may be missing/);
  assert.match(insurerSyncMessage(status, null, false), /collection complete/);
  assert.equal(applicableInsurerPreview(status, null), false);
  assert.match(insurerCoverageNotice(status, Date.parse('2026-07-12T12:00:00Z'))!, /out of date/);
  assert.match(insurerCoverageNotice({...status, latestResult: {...status.latestResult, complete: false}}, Date.parse('2026-07-09T12:00:00Z'))!, /incomplete/);
});

test('pending insurer records never imply missing previously saved payments or a positive payment', () => {
  const status = {state: 'idle' as const, lastSuccess:'2026-07-09T11:00:00Z', latestResult:{status:'success' as const, applied:false, complete:true, pendingNew:1, ambiguous:0, errors:0}};
  const notice = insurerCoverageNotice(status, Date.parse('2026-07-09T12:00:00Z'))!;
  assert.match(notice, /insurer records.*Previously saved payments remain available/);
  assert.doesNotMatch(notice, /^Collected payments/);
});

test('Gmail authorization failures explain missing recent invoices without exposing addresses', () => {
  const snapshot = { progress: {'synthetic@example.test': {error:'Gmail authorization expired or was rejected. Reconnect this account on the PC.'}}, error:'Some accounts are incomplete.', lastSuccess:'2026-07-01T12:00:00Z' };
  const notice = invoiceCollectionNotice(snapshot)!;
  assert.match(notice, /Gmail sign-in required.*1 account.*Recent invoices have not been collected/);
  assert.match(notice, /Saved invoices and insurer payments remain available/);
  assert.doesNotMatch(notice, /synthetic@example/);
  assert.equal(invoiceCollectionNotice({progress:{},error:'Temporary collection failure'}), 'Temporary collection failure');
  assert.equal(invoiceCollectionNotice({progress:{}}), null);
});
test('automatic additions refresh claims even when remaining changes still require explicit Apply', () => {
  const result = { status: 'success' as const, applied: false, complete: true, autoImported: 1, pendingNew: 0, pendingChanged: 1, new: 1, changed: 1, ambiguous: 0, errors: 0 };
  assert.equal(insurerCollectionNeedsRefresh(result), true);
  assert.match(insurerSyncMessage(null, result, false), /Saved 1 new insurer records automatically.*1 insurer records still need review/);
  assert.equal(applicableInsurerPreview(null, result), true);
});
test('a repeat with no new payments is current; a genuine preview never claims that data was saved', () => {
  const current = { status: 'success' as const, autoImported: 0, pendingNew: 0, pendingChanged: 0, unchanged: 7, complete: true };
  assert.equal(insurerCollectionNeedsRefresh(current), false);
  assert.match(insurerSyncMessage(null, current, false), /Up to date: 7/);
  const preview = { status: 'success' as const, applied: false, new: 1, changed: 0, complete: true };
  assert.equal(insurerCollectionNeedsRefresh(preview), false);
  assert.match(insurerSyncMessage(null, preview, false), /Preview:/);
  assert.equal(insurerCollectionNeedsRefresh({ status: 'login-required' }, true), false);
});
test('an ambiguous automatic collection never displays Up to date', () => {
  const result = { status: 'success' as const, applied: false, complete: true, autoImported: 0, pendingNew: 0, pendingChanged: 0, ambiguous: 1, errors: 0 };
  assert.match(insurerSyncMessage(null, result, false), /Automatic import paused/);
  assert.equal(applicableInsurerPreview(null, result), false);
});

test('saved claims expose failed, stale, auth-required and unavailable coverage with bounded retry progress', () => {
  const now=Date.parse('2026-07-09T12:00:00Z');
  assert.match(insurerCoverageNotice(null,now)!, /unavailable.*missing/);
  assert.match(insurerCoverageNotice({state:'login-required',lastSuccess:'2026-07-01T12:00:00Z'},now)!, /history unavailable/);
  assert.match(insurerCoverageNotice({state:'up-to-date',lastSuccess:'2026-07-01T12:00:00Z'},now)!, /out of date/);
  assert.equal(insurerCoverageNotice({state:'up-to-date',lastSuccess:'2026-07-09T11:00:00Z'},now),null);
  assert.match(insurerCoverageNotice({state:'error',retry:{attempt:3,maximum:3,state:'exhausted'}},now)!,/3 attempts/);
  assert.match(insurerSyncMessage({state:'syncing',retry:{attempt:1,maximum:3,state:'waiting'}},null,false), /Retrying.*2\/3/);
});


test('compact insurer captions distinguish completed review from incomplete, stale and unavailable coverage', () => {
  const now = Date.parse('2026-07-09T12:00:00Z');
  const complete: BlueCrossSyncStatus = { state: 'idle', lastSuccess: '2026-07-09T11:00:00Z', latestResult: { status: 'success', complete: true, applied: false, ambiguous: 1, errors: 0 } };
  assert.equal(insurerCoverageSummary(complete, now), 'rapprochements à vérifier');
  assert.equal(insurerCoverageSummary({ ...complete, latestResult: { ...complete.latestResult!, ambiguous: 0, pendingNew: 2 } }, now), 'résultats à examiner');
  assert.equal(insurerCoverageSummary({ ...complete, latestResult: { ...complete.latestResult!, complete: false } }, now), 'collecte incomplète');
  assert.equal(insurerCoverageSummary({ ...complete, latestResult: { ...complete.latestResult!, errors: 1 } }, now), 'collecte incomplète');
  assert.equal(insurerCoverageSummary({ state: 'error', lastSuccess: complete.lastSuccess }, now), 'collecte incomplète');
  assert.equal(insurerCoverageSummary(complete, now + 48 * 60 * 60_000), 'données anciennes');
  assert.equal(insurerCoverageSummary({ state: 'idle' }, now), 'lecture complète non confirmée');
  assert.equal(insurerCoverageSummary(null, now), 'état indisponible');
  assert.equal(insurerCoverageSummary({ state: 'syncing' }, now), 'lecture en cours');
  assert.equal(insurerCoverageSummary({ ...complete, latestResult: { ...complete.latestResult!, ambiguous: 0, applied: true } }, now), null);
});

test('compact insurer diagnostics do not turn uncertain history or a busy profile into rejected credentials', () => {
  const cases = [
    ['login-incomplete', 'connexion non confirmée'], ['layout-changed', 'historique indisponible'],
    [undefined, 'historique indisponible'], ['profile-selection-required', 'profil à sélectionner sur le PC'],
    ['profile-busy', 'profil occupé sur le PC'], ['cooldown', 'connexion en pause'],
  ] as const;
  for (const [authReason, expected] of cases) {
    const status = { state: 'login-required' as const, authReason };
    assert.equal(insurerCoverageSummary(status), expected);
    assert.doesNotMatch(insurerCoverageNotice(status)!, /Sign-in required|rejected|expired|reconnect/i);
  }
  const futureReason = { state: 'login-required', authReason: 'future-unknown-reason' } as unknown as BlueCrossSyncStatus;
  assert.equal(insurerCoverageSummary(futureReason), 'historique indisponible');
  assert.doesNotMatch(insurerCoverageNotice(futureReason)!, /Sign-in required|rejected|expired|reconnect/i);
  assert.equal(insurerCoverageSummary({ state: 'login-required', authReason: 'credentials-rejected' }), 'connexion refusée');
  assert.equal(insurerCoverageSummary({ state: 'login-required', authReason: 'human-required' }), 'vérification requise sur le PC');
  const busy = insurerCoverageNotice({ state: 'login-required', authReason: 'profile-busy' })!;
  assert.match(busy, /profile is unavailable.*review Sources.*interrupted lock/);
  assert.doesNotMatch(busy, /Another collection is using|wait for it to finish/i);
  const busyDetail = insurerSyncMessage({ state: "login-required", authReason: "profile-busy" }, null, false);
  assert.match(busyDetail, /profile is unavailable.*whether.*interrupted lock/);
  assert.doesNotMatch(busyDetail, /already open in another collection|wait for it to finish/i);
});

test('unsupported attachment failures explain interrupted mail collection without leaking retrieval diagnostics or requesting login', () => {
  const notice = invoiceCollectionNotice({ progress: {}, failure: { code: 'unsupported_attachment' }, error: 'PRIVATE_ATTACHMENT_NAME.pdf checkpoint raw-tool-diagnostics' })!;
  assert.match(notice, /Collecte interrompue.*pièce jointe Gmail.*source connectée/);
  assert.match(notice, /Vérifiez le document original dans Gmail.*dossiers enregistrés restent disponibles/);
  assert.doesNotMatch(notice, /PRIVATE_|checkpoint|raw-tool|connexion|sign-in|reconnect|expired|partielle/i);
});

test('durable held mail remains visibly partial after later retrieval succeeds and clears only with a resolved count', () => {
  const coverage = { since: '2026-07-01', complete: false, heldMessages: 2 };
  const held = invoiceCollectionNotice({ progress: {}, coverage, error: '2 raw-source checkpoint records held' })!;
  assert.match(held, /Collecte partielle : 2 messages Gmail restent à vérifier/);
  assert.doesNotMatch(held, /raw-source|checkpoint|connexion|sign-in|reconnect/i);
  assert.equal(invoiceCollectionNotice({ progress: {}, coverage }), held, 'A missing latest failure must not hide a persisted hold');
  assert.match(invoiceCollectionNotice({ progress: {}, coverage: { ...coverage, heldMessages: 1 } })!, /1 message Gmail reste à vérifier/);
  assert.equal(invoiceCollectionNotice({ progress: {}, coverage: { ...coverage, complete: true, heldMessages: 0 } }), null);
  for (const count of [-1, 1.5, NaN, Infinity]) assert.equal(invoiceCollectionNotice({ progress: {}, coverage: { ...coverage, heldMessages: count } }), null);
  for (const code of ['timeout_or_cancelled', 'unsupported_attachment'])
    assert.match(invoiceCollectionNotice({ progress: {}, coverage, failure: { code } })!, /2 messages.*dernière collecte a aussi été interrompue/);
  const authAndHold = invoiceCollectionNotice({ progress: { 'private@example.test': { error: 'invalid_grant' } }, coverage })!;
  assert.match(authAndHold, /Gmail sign-in required/);
  assert.match(authAndHold, /2 messages Gmail restent à vérifier/);
  assert.doesNotMatch(authAndHold, /private@example/);
});

test('invoice snapshot normalization retains held coverage and the failure code without copying diagnostic payloads', async t => {
  const config = { Endpoint: 'https://paired.example.test', ApiKey: 'synthetic-test-key' };
  let body: object = { coverage: { since: '2026-07-01', complete: false, heldMessages: 3 }, failure: { code: 'unsupported_attachment', diagnostics: { secret: 'PRIVATE_SENTINEL' } } };
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const snapshot = await fetchInvoices(config);
  assert.deepEqual(snapshot.coverage, { since: '2026-07-01', complete: false, heldMessages: 3 });
  assert.deepEqual(snapshot.failure, { code: 'unsupported_attachment' });
  assert.match(invoiceCollectionNotice(snapshot)!, /3 messages Gmail restent à vérifier/);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_SENTINEL/);
  body = {};
  const legacy = await fetchInvoices(config);
  assert.equal(legacy.failure, undefined);
  assert.equal(invoiceCollectionNotice(legacy), null);
});
