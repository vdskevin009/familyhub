import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'familyhub-desjardins-'));
process.env.FAMILYHUB_WORKER_DATA = dir;
const { initializeInvoices, initializeDesjardinsStatus, invoiceSnapshot, syncDesjardinsPortal, getDesjardinsStatus, updateInvoiceStatus } = await import('../apps/worker/dist/invoices.js');
const { desjardinsSnapshotDirectory } = await import('../apps/worker/dist/desjardins-collector.js');
const { desjardinsIdentity } = await import('../apps/worker/dist/desjardins.js');

test('real invoice workflow previews without edits, then applies once from a private snapshot', async () => {
  try {
    await initializeInvoices(true);
    await initializeDesjardinsStatus();
    const at = new Date().toISOString();
    const collection = { collectedAt: at, collectorVersion: 1, pageCount: 1, warnings: [], complete: true,
      rows: [{ member: 'Kevin', serviceDate: '2026-09-10', service: 'Physiotherapy', submitted: 100, paid: 80,
        statementDate: '2026-09-12', sourceClaimId: 'synthetic-claim',
        identity: desjardinsIdentity('synthetic-claim', null, 1), needsReview: false }] };
    await mkdir(desjardinsSnapshotDirectory, { recursive: true });
    const path = join(desjardinsSnapshotDirectory, 'synthetic-preview.json');
    const file = await open(path, 'wx');
    try { await file.writeFile(JSON.stringify(collection)); } finally { await file.close(); }
    const preview = await syncDesjardinsPortal(false, false, async () => ({ status: 'success', collection, snapshotPath: path }));
    assert.deepEqual([preview.new, preview.unchanged, preview.applied], [1, 0, false]);
    assert.equal((await invoiceSnapshot()).items.length, 0);
    assert.equal(getDesjardinsStatus().applicable, true);
    const first = await syncDesjardinsPortal(true);
    assert.deepEqual([first.new, first.unchanged, first.applied], [1, 0, true]);
    assert.equal(getDesjardinsStatus().latestResult.applied, true);
    const appliedAt = getDesjardinsStatus().lastAppliedAt;
    assert.ok(appliedAt);
    await initializeDesjardinsStatus();
    assert.equal(getDesjardinsStatus().latestResult.applied, true, 'applied status survives reload');
    assert.equal('snapshotPath' in getDesjardinsStatus().latestResult, false);
    assert.equal((await invoiceSnapshot()).items.length, 1);
    assert.ok(first.backup);
    assert.equal(JSON.parse(await readFile(join(dir, first.backup), 'utf8')).items.length, 0);
    await updateInvoiceStatus((await invoiceSnapshot()).items[0].Id, 3);
    const manualBytes = await readFile(join(dir, 'invoices.json'));
    const repeatPreview = await syncDesjardinsPortal(false, false, async () => ({ status: 'success', collection, snapshotPath: path }));
    assert.deepEqual([repeatPreview.new, repeatPreview.unchanged], [0, 1]);
    assert.equal(getDesjardinsStatus().latestResult.applied, false);
    assert.equal(getDesjardinsStatus().latestResult.new, 0);
    assert.equal(getDesjardinsStatus().lastAppliedAt, appliedAt, 'later previews retain the saved-data refresh marker');
    const lastSuccess = getDesjardinsStatus().lastSuccess;
    const login = await syncDesjardinsPortal(false, false, async () => ({ status: 'login-required', authReason: 'human-required' }));
    assert.equal(getDesjardinsStatus().lastSuccess, lastSuccess);
    assert.equal(getDesjardinsStatus().authReason, 'human-required');
    assert.deepEqual(await readFile(join(dir, 'invoices.json')), manualBytes);
    assert.equal(login.status, 'login-required');
    assert.equal(getDesjardinsStatus().applicable, false);
    assert.equal(getDesjardinsStatus().latestResult, undefined, 'failed login cannot retain a stale successful preview');
    await syncDesjardinsPortal(false, false, async () => ({ status: 'success', collection, snapshotPath: path }));
    const repeat = await syncDesjardinsPortal(true);
    assert.deepEqual([repeat.new, repeat.changed, repeat.unchanged], [0, 0, 1]);
    assert.deepEqual(await readFile(join(dir, 'invoices.json')), manualBytes);
    assert.equal((await invoiceSnapshot()).items[0].Status, 3);
    assert.ok((await invoiceSnapshot()).items[0].LastDecisionId);
    const partial = { ...collection, collectedAt: new Date().toISOString(), complete: false, warnings: ['A later claims page was unavailable.'] };
    const partialPath = join(desjardinsSnapshotDirectory, 'synthetic-partial.json');
    const partialFile = await open(partialPath, 'wx');
    try { await partialFile.writeFile(JSON.stringify(partial)); } finally { await partialFile.close(); }
    await syncDesjardinsPortal(false, false, async () => ({ status: 'success', collection: partial, snapshotPath: partialPath }));
    assert.equal(getDesjardinsStatus().applicable, false);
    await assert.rejects(syncDesjardinsPortal(true), /incomplete or ambiguous/);
    assert.deepEqual(await readFile(join(dir, 'invoices.json')), manualBytes);
  } finally {
    if (resolve(dir).startsWith(resolve(tmpdir()) + '\\') || resolve(dir).startsWith(resolve(tmpdir()) + '/'))
      await rm(dir, { recursive: true, force: true });
  }
});
