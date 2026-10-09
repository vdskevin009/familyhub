import test from 'node:test';
import assert from 'node:assert/strict';
import { insurerSyncMessage, insurerCollectionNeedsRefresh, applicableInsurerPreview, insurerCoverageNotice } from '../apps/web/src/insurer-sync';
test('automatic additions refresh claims even when remaining changes still require explicit Apply', () => {
  const result = { status: 'success' as const, applied: false, complete: true, autoImported: 1, pendingNew: 0, pendingChanged: 1, new: 1, changed: 1, ambiguous: 0, errors: 0 };
  assert.equal(insurerCollectionNeedsRefresh(result), true);
  assert.match(insurerSyncMessage(null, result, false), /Saved 1 new payments automatically.*1 insurer records still need review/);
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
  assert.match(insurerCoverageNotice({state:'login-required',lastSuccess:'2026-07-01T12:00:00Z'},now)!, /Sign-in required/);
  assert.match(insurerCoverageNotice({state:'up-to-date',lastSuccess:'2026-07-01T12:00:00Z'},now)!, /out of date/);
  assert.equal(insurerCoverageNotice({state:'up-to-date',lastSuccess:'2026-07-09T11:00:00Z'},now),null);
  assert.match(insurerCoverageNotice({state:'error',retry:{attempt:3,maximum:3,state:'exhausted'}},now)!,/3 attempts/);
  assert.match(insurerSyncMessage({state:'syncing',retry:{attempt:1,maximum:3,state:'waiting'}},null,false), /Retrying.*2\/3/);
});
