import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeInvoices, collectInvoices, correctInvoice, updateInvoiceStatus, invoiceAttachment } from '../../apps/worker/dist/invoices.js';
import { recordId } from '../../apps/worker/dist/invoice-model.js';
const path = join(process.env.FAMILYHUB_WORKER_DATA, 'invoices.json');
const read = async () => JSON.parse(await readFile(path, 'utf8'));
let fail = true; let calls = [];
const classification = { kind: 'receipt', confidence: .97, transaction: true, reimbursement: 'unknown', reason: 'Test', amount: 40, currency: 'CAD', category: 'health' };
const deps = {
  credentials: async () => ({ accounts: [{ email: 'test@example.test', label: 'Test', refreshToken: 'synthetic', clientId: 'synthetic', clientSecret: 'synthetic' }] }),
  accessToken: async () => 'synthetic',
  classify: async () => ({ result: classification, source: 'codex' }),
  gmail: async (_token, path) => {
    calls.push(path);
    if (path.startsWith('messages?')) return { messages: [{ id: 'one' }, { id: 'two' }] };
    if (path.includes('/two?') && fail) throw new Error('Synthetic transient failure');
    return { id: path.includes('/one?') ? 'one' : 'two', threadId: 'thread', internalDate: '1790000000000', payload: { headers: [{ name: 'Subject', value: 'Receipt #AB123' }], mimeType: 'text/plain', body: { data: Buffer.from('Total paid CAD 40').toString('base64url') }, parts: [{ mimeType: 'application/pdf', filename: 'test.pdf', body: { attachmentId: 'att', size: 100 } }] } };
  }
};
await initializeInvoices();
await collectInvoices(deps);
let saved = await read();
assert.equal(saved.items.length, 1); assert.ok(saved.accounts['test@example.test'].window); assert.equal(saved.accounts['test@example.test'].through, undefined);
assert.match(saved.accounts['test@example.test'].error, /Synthetic/);
await correctInvoice(recordId('test@example.test', 'one'), 'marketing');
fail = false; calls = [];
await collectInvoices(deps);
assert.equal(calls.filter(x => x.includes('/one?')).length, 0);
saved = await read(); assert.equal(saved.items.length, 2); assert.equal(saved.items[0].Status, 4); assert.ok(saved.lastSuccess);
await updateInvoiceStatus(recordId('test@example.test', 'two'), 2);
await collectInvoices(deps);
saved = await read(); assert.equal(saved.items[1].Status, 2);
await assert.rejects(() => updateInvoiceStatus(recordId('test@example.test', 'two'), 99));
await initializeInvoices(); // Simulate restart and retained index.
await collectInvoices(deps);
assert.equal((await read()).items.length, 2);
const file = await invoiceAttachment(recordId('test@example.test', 'two'), 'att', { ...deps, gmail: async (_token, path) => {
  assert.equal(path, 'messages/two/attachments/att'); return { data: Buffer.from('synthetic PDF bytes').toString('base64url') };
} });
assert.equal(file.bytes.toString(), 'synthetic PDF bytes'); assert.equal(file.name, 'test.pdf');
await assert.rejects(() => invoiceAttachment(recordId('test@example.test', 'two'), 'unknown', deps), /not found/);
await assert.rejects(() => invoiceAttachment(recordId('test@example.test', 'two'), 'att', { ...deps, credentials: async () => ({ accounts: [] }) }), /Reconnect/);
console.log('Recovery, deduplication and corrections verified with synthetic data.');
