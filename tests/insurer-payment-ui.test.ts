import test from 'node:test';
import assert from 'node:assert/strict';
import { insurerSyncMessage, insurerCollectionNeedsRefresh, applicableInsurerPreview } from '../apps/web/src/insurer-sync';
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

test('a Desjardins profile choice reports account selection and retains saved claims',()=>{const status={state:'login-required' as const,authReason:'profile-selection-required' as const,found:10};assert.match(insurerSyncMessage(status,null,false),/Choose the Desjardins account profile/);assert.equal(applicableInsurerPreview(status,null),false);});

test('an unknown login outcome never claims that a verification code was requested',()=>{const status={state:'login-required' as const,authReason:'login-incomplete' as const};const message=insurerSyncMessage(status,null,false);assert.match(message,/did not reach claim history/);assert.doesNotMatch(message,/complete verification/);assert.equal(applicableInsurerPreview(status,null),false);});
