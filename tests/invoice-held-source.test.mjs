import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scenarios = {
  progress: 'held invoices preserve verified coverage while new scans progress and bounded retries rotate',
  history: 'a held historical source survives restart and recovers with its original historical purpose',
  repair: 'held amount repair retains its purpose and never changes a manually protected sibling',
  pages: 'held sources retain real page continuation without a held-only loop',
  retry: 'a held unavailable classification retries once without duplicating its source record',
  state: 'malformed persisted holds and queue overflow fail closed before any ledger write',
  mixed_history: 'overlapping incremental and history purposes match available-source active eligibility',
  mixed_repair: 'overlapping incremental and repair purposes match available-source active eligibility',
  retry_unavailable: 'recovered held source preserves the existing classification retry budget when still unavailable',
  malformed: 'unsupported attachments cannot conceal malformed originals or weaken strict transports',
};

if (process.argv[2] !== '--fixture') {
  for (const [scenario, title] of Object.entries(scenarios)) test(title, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'familyhub-held-source-'));
    t.after(async () => {
      assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
      await rm(dir, { recursive: true, force: true });
    });
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture', scenario], {
      cwd: process.cwd(), env: { ...process.env, FAMILYHUB_WORKER_DATA: dir },
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  });
} else {
  const api = await import('../apps/worker/dist/invoices.js');
  const { preparedPluginMailSource } = await import('../apps/worker/dist/prepared-plugin-mail-source.js');
  const { createPluginBatchTransport } = await import('../apps/worker/dist/gmail-plugin-batch.js');
  const { toInvoice } = await import('../apps/worker/dist/invoice-model.js');
  const { normalizeMail } = await import('../apps/worker/dist/gmail-client.js');
  const account = { email: 'synthetic-held@example.test', label: 'Synthetic held source' };
  const at = 1793534400, previous = at - 10 * 86400;
  const previousSuccess = new Date(previous * 1000).toISOString();
  const path = join(process.env.FAMILYHUB_WORKER_DATA, 'invoices.json');
  const classification = { kind: 'receipt', confidence: .97, transaction: true, reimbursement: 'unknown',
    reason: 'Synthetic fixture', amount: 40, currency: 'CAD', category: 'travel', member: 'unknown',
    documentRole: 'other', insurer: null, serviceDate: null, billedAmount: 40, reimbursedAmount: null };
  const raw = (id, text = 'CAD 40.', subject = 'Synthetic receipt') => ({
    id, threadId: 'thread-' + id, internalDate: String(at * 1000), labelIds: ['INBOX'],
    payload: { mimeType: 'text/plain', filename: '', headers: [
      { name: 'From', value: 'billing@example.test' }, { name: 'Subject', value: subject },
    ], body: { size: Buffer.byteLength(text), data: Buffer.from(text).toString('base64url') } },
  });
  const held = id => {
    const message = raw(id), attachment = { attachmentId: 'calendar-' + id, filename: 'appointment.ics',
      mimeType: 'application/ics', size: 24, reason: 'unsupported_attachment' };
    message.payload = { mimeType: 'multipart/mixed', filename: '', headers: message.payload.headers,
      body: { size: 0 }, parts: [{ ...message.payload, headers: [] },
        { mimeType: attachment.mimeType, filename: attachment.filename, headers: [],
          readAttachmentSupported: false, body: { attachmentId: attachment.attachmentId, size: attachment.size } }] };
    return { message, hold: { messageId: id, attachments: [attachment] } };
  };
  const progress = extra => ({ transport: 'plugin-batch', through: previous, lastSuccess: previousSuccess,
    healthReceiptRepairVersion: 4, invoiceHistoryVersion: 1, invoiceHistoryThrough: previous, ...extra });
  const seed = async (items = [], p = progress()) => {
    await writeFile(path, JSON.stringify({ items, corrections: [], decisions: [], matchDecisions: [],
      unmatchedDecisions: [], workflowRecords: [], reviews: [], accounts: { [account.email]: p },
      lastSuccess: previousSuccess, opaqueExtension: { preserved: true } }));
    await api.initializeInvoices();
  };
  const saved = async () => JSON.parse(await readFile(path, 'utf8'));
  const planAt = time => api.invoiceCollectionPlan(account.email, time);
  const batchFor = (plan, { messages = [], holds = [], incremental = [], history = [], repair = [], pages } = {}) => {
    const query = (request, ids, actualPages) => ({ q: request.q, maxResults: request.maxResults, complete: true,
      pages: actualPages || [{ messageIds: ids }] });
    return { schema: 1, account: account.email, messages, attachments: [], ...(holds.length ? { heldMessages: holds } : {}),
      queries: [query(plan.incremental, incremental, pages), ...(plan.repair ? [query(plan.repair.request, repair)] : []),
        ...(plan.history ? [query(plan.history.request, history)] : [])] };
  };
  const forbidden = async () => { throw new Error('External credentials, network or classifier forbidden by fixture'); };
  const classify = async () => ({ result: classification, source: 'rules' });
  const run = async (plan, data, overrides = {}) => api.collectInvoices({
    credentials: forbidden, accessToken: forbidden, gmail: forbidden, classify, historicalClassify: classify,
    reviewer: async () => ({ explanation: 'Synthetic review only' }),
    now: () => new Date(plan.at * 1000), plans: [plan],
    source: preparedPluginMailSource([{ account, batch: batchFor(plan, data) }], { allowHeldMessages: true }),
    ...overrides,
  });
  api.configureInvoiceMailAccess({ accounts: async () => [{ ...account, sourceMode: 'plugin', collections: ['invoices'] }],
    status: () => ({ busy: false, sourceMode: 'plugin' }), attachment: forbidden });

  if (process.argv[3] === 'progress') {
    await seed();
    const originals = Array.from({ length: 12 }, (_, i) => held('held-' + String(i).padStart(2, '0')));
    const first = planAt(at);
    await run(first, { messages: [...originals.map(x => x.message), raw('supported-first')],
      holds: originals.map(x => x.hold), incremental: [...originals.map(x => x.hold.messageId), 'supported-first'] });
    let state = await saved(), p = state.accounts[account.email];
    assert.equal(p.heldMessages.length, 12);
    assert.equal(p.scannedThrough, at);
    assert.equal(p.through, previous);
    assert.equal(p.lastSuccess, previousSuccess);
    assert.equal(state.lastSuccess, previousSuccess);
    assert.deepEqual(state.items.map(x => x.SourceMessageId), ['supported-first']);
    assert.deepEqual(p.heldMessages.map(x => x.purposes), originals.map(() => ['incremental']));
    assert.equal((await api.invoiceSnapshot()).coverage.complete, false);
    assert.equal((await api.invoiceSnapshot()).continuationReady, false, 'holds alone must not cause an immediate continuation loop');
    const beforeRestart = structuredClone(p.heldMessages);
    await api.initializeInvoices(true);
    assert.deepEqual((await saved()).accounts[account.email].heldMessages, beforeRestart);
    const second = planAt(at + 86400);
    assert.equal(second.window.after, at - 2 * 86400, 'new mail scans use enumerated frontier, not blocked verified frontier');
    assert.equal(second.heldMessageIds.length, 10);
    const excluded = originals.filter(x => !second.heldMessageIds.includes(x.hold.messageId));
    assert.equal(excluded.length, 2);
    const retried = originals.filter(x => second.heldMessageIds.includes(x.hold.messageId));
    await run(second, { messages: [...retried.map(x => x.message), raw('supported-next-day')],
      holds: retried.map(x => x.hold), incremental: ['supported-next-day'] });
    state = await saved(); p = state.accounts[account.email];
    assert.equal(p.heldMessages.length, 12);
    assert.equal(p.scannedThrough, at + 86400);
    assert.equal(p.through, previous);
    assert.equal(state.lastSuccess, previousSuccess);
    assert.deepEqual(state.items.map(x => x.SourceMessageId).sort(), ['supported-first', 'supported-next-day']);
    assert.deepEqual(planAt(at + 2 * 86400).heldMessageIds.slice(0, 2), excluded.map(x => x.hold.messageId));
    assert.equal((await api.invoiceSnapshot()).continuationReady, false);
    assert.deepEqual(state.opaqueExtension, { preserved: true });
  } else if (process.argv[3] === 'history') {
    await seed([], progress({ invoiceHistoryVersion: undefined, invoiceHistoryThrough: undefined }));
    const original = held('held-history'), first = planAt(at);
    await run(first, { messages: [original.message, raw('current')],
      holds: [original.hold], incremental: ['current'], history: ['held-history'] });
    let state = await saved(), p = state.accounts[account.email];
    assert.equal(p.invoiceHistoryVersion, 1, 'completed enumeration can be recorded independently');
    assert.equal(p.historyScannedThrough, at);
    assert.equal(p.invoiceHistoryThrough, undefined, 'held historical evidence is not certified coverage');
    assert.deepEqual(p.heldMessages[0].purposes, ['history']);
    assert.equal(p.through, previous);
    assert.equal(state.lastSuccess, previousSuccess);
    await api.initializeInvoices(true);
    const second = planAt(at + 86400);
    assert.equal(second.history, undefined);
    assert.deepEqual(second.heldMessageIds, ['held-history']);
    let historical = 0, ordinary = 0;
    await run(second, { messages: [raw('held-history')] }, {
      classify: async () => { ordinary++; return classify(); },
      historicalClassify: async () => { historical++; return classify(); },
    });
    state = await saved(); p = state.accounts[account.email];
    assert.equal(historical, 1); assert.equal(ordinary, 0);
    assert.equal(state.items.find(x => x.SourceMessageId === 'held-history').HistoricalCandidate, true);
    assert.equal(p.heldMessages?.length || 0, 0);
    assert.equal(p.invoiceHistoryThrough, at);
    assert.equal(p.through, at + 86400);
    assert.equal(state.lastSuccess, new Date((at + 86400) * 1000).toISOString());
    assert.equal((await api.invoiceSnapshot()).coverage.complete, true);
    assert.equal((await api.invoiceSnapshot()).continuationReady, false);
  } else if (process.argv[3] === 'repair') {
    const receiptText = 'Invoice #SYNTHETIC-P01. Service date: 2026-09-17. SEPTEMBER 17, 2026 - 1:15PM, RMT - FOLLOW UP MASSAGE (60 MINUTES) $142.86 $7.14 $150.00\nDESJARDINS INSURANCE (TELUS eClaims) Massage therapy Amount not covered: $38.00 -$112.00\nTOTAL $38.00';
    const receipt = id => raw(id, receiptText, 'Your Receipt - QubeCore Sports & Rehab');
    const item = id => {
      const parsed = toInvoice(normalizeMail(receipt(id)), account.email, account.label, {
        ...classification, category: 'health', member: 'Kevin', documentRole: 'expense',
        serviceDate: '2026-09-17', billedAmount: 150, amount: 150,
      }, 'rules');
      return { ...parsed, BilledAmount: 38, DetectedAmount: 38,
        Healthcare: { ...parsed.Healthcare, OriginalBilledAmount: 38, InsurerPayments: {} } };
    };
    await seed([item('repair-held'), item('manual-held')], progress({ healthReceiptRepairVersion: 0 }));
    await api.correctInvoice((await saved()).items.find(x => x.SourceMessageId === 'manual-held').Id, 'receipt');
    const manualBefore = structuredClone((await saved()).items.find(x => x.SourceMessageId === 'manual-held'));
    const holds = ['repair-held', 'manual-held'].map(held), first = planAt(at);
    await run(first, { messages: holds.map(x => x.message), holds: holds.map(x => x.hold),
      repair: holds.map(x => x.hold.messageId) }, { classify: forbidden, historicalClassify: forbidden });
    let state = await saved(), p = state.accounts[account.email];
    assert.equal(p.healthReceiptRepairVersion, 4);
    assert.equal(p.heldMessages.length, 2, 'manual skip cannot hide a held source');
    for (const entry of p.heldMessages) assert.ok(entry.purposes.includes('repair'));
    assert.deepEqual(state.items.find(x => x.SourceMessageId === 'manual-held'), manualBefore);
    assert.equal(state.items.find(x => x.SourceMessageId === 'repair-held').BilledAmount, 38);
    await api.initializeInvoices(true);
    const second = planAt(at + 86400);
    assert.equal(second.repair, undefined);
    await run(second, { messages: [receipt('repair-held'), receipt('manual-held')] }, { classify: forbidden, historicalClassify: forbidden });
    state = await saved();
    const repaired = state.items.find(x => x.SourceMessageId === 'repair-held');
    assert.equal(repaired.BilledAmount, 150, 'retry must execute saved amount repair even though the current item needs no upgrade');
    assert.equal(repaired.Healthcare.InsurerPayments.desjardins, 112);
    assert.deepEqual(state.items.find(x => x.SourceMessageId === 'manual-held'), manualBefore);
    assert.equal(state.accounts[account.email].heldMessages?.length || 0, 0);
  } else if (process.argv[3] === 'pages') {
    await seed();
    const original = held('held-last-page'), first = planAt(at);
    const pages = [{ messageIds: ['first-page'], nextPageToken: 'page-2' },
      { pageToken: 'page-2', messageIds: ['second-page'], nextPageToken: 'page-3' },
      { pageToken: 'page-3', messageIds: ['held-last-page'] }];
    const data = { messages: [raw('first-page'), raw('second-page'), original.message],
      holds: [original.hold], pages };
    await run(first, data);
    let state = await saved(), p = state.accounts[account.email];
    assert.equal(p.window.page, 'page-3');
    assert.equal(p.through, previous);
    assert.equal(p.heldMessages[0].messageId, 'held-last-page', 'all validated holds must persist before any page cursor advances');
    assert.equal((await api.invoiceSnapshot()).continuationReady, true, 'unfinished pages still justify continuation');
    await api.initializeInvoices(true);
    const second = planAt(at + 1000);
    assert.equal(second.window.page, 'page-3');
    await run(second, data);
    state = await saved(); p = state.accounts[account.email];
    assert.equal(p.window, undefined);
    assert.equal(p.scannedThrough, at);
    assert.equal(p.through, previous);
    assert.equal(state.items.length, 2);
    assert.equal((await api.invoiceSnapshot()).continuationReady, false, 'exhausted enumeration does not spin on its hold');
  } else if (process.argv[3] === 'retry') {
    const unavailable = toInvoice(normalizeMail(raw('held-unavailable')), account.email, account.label,
      { ...classification, member: 'Kevin' }, 'unavailable');
    await seed([unavailable]);
    const original = held('held-unavailable'), first = planAt(at);
    assert.ok(first.retryMessageIds.includes('held-unavailable'));
    await run(first, { messages: [original.message], holds: [original.hold] });
    let state = await saved();
    assert.ok(state.accounts[account.email].heldMessages[0].purposes.includes('retry'));
    assert.equal(state.items[0].ClassificationSource, 'unavailable');
    await api.initializeInvoices(true);
    const second = planAt(at + 86400);
    let calls = 0;
    await run(second, { messages: [raw('held-unavailable')] }, {
      classify: async () => { calls++; return { result: { ...classification, member: 'Kevin' }, source: 'rules' }; },
    });
    state = await saved();
    assert.equal(calls, 1);
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].ClassificationSource, 'rules');
    assert.equal(state.accounts[account.email].heldMessages?.length || 0, 0);
  } else if (process.argv[3] === 'state') {
    await seed();
    const baseline = await saved();
    const original = held('held-state').hold;
    const persisted = { ...original, firstSeen: previousSuccess, lastAttempt: previousSuccess, purposes: ['incremental'] };
    for (const mutate of [
      entry => { entry.messageId = 123; },
      entry => { entry.lastAttempt = 'not-a-timestamp'; },
      entry => { entry.purposes = ['invented-purpose']; },
      entry => { entry.attachments[0].size = -1; },
    ]) {
      const state = structuredClone(baseline), entry = structuredClone(persisted);
      mutate(entry); state.accounts[account.email].heldMessages = [entry];
      const bytes = JSON.stringify(state); await writeFile(path, bytes);
      await assert.rejects(api.initializeInvoices(true), /unreadable/);
      assert.equal(await readFile(path, 'utf8'), bytes, 'malformed durable holds must not be silently dropped or rewritten');
    }
    const full = structuredClone(baseline);
    full.accounts[account.email].heldMessages = Array.from({ length: 1000 }, (_, i) => ({
      ...structuredClone(persisted), messageId: 'queue-' + String(i).padStart(4, '0'),
    }));
    await writeFile(path, JSON.stringify(full)); await api.initializeInvoices(true);
    const plan = planAt(at), candidates = plan.heldMessageIds.map(held), extra = held('queue-overflow');
    const before = await readFile(path, 'utf8');
    await assert.rejects(run(plan, { messages: [...candidates.map(x => x.message), extra.message],
      holds: [...candidates.map(x => x.hold), extra.hold], incremental: ['queue-overflow'] }), /invalid/);
    assert.equal(await readFile(path, 'utf8'), before, 'queue overflow must abort before any checkpoint, item or hold write');
  } else if (process.argv[3].startsWith('mixed_')) {
    const purpose = process.argv[3] === 'mixed_history' ? 'history' : 'repair';
    const initial = purpose === 'history'
      ? progress({ invoiceHistoryVersion: undefined, invoiceHistoryThrough: undefined })
      : progress({ healthReceiptRepairVersion: 0 });
    const id = 'overlap-' + purpose, ordinary = { ...classification, category: 'health',
      documentRole: 'expense', member: 'Kevin', serviceDate: '2026-09-17' };
    const available = raw(id), pending = held(id), calls = [];
    const classifiers = {
      classify: async () => { calls.push('incremental'); return { result: ordinary, source: 'rules' }; },
      historicalClassify: async (...args) => { calls.push('historical'); return api.classifyHistorical(...args); },
    };
    const projection = item => ({ source: item.SourceMessageId, historical: !!item.HistoricalCandidate,
      role: item.DocumentRole, category: item.Category, member: item.Member, billed: item.BilledAmount,
      classification: item.ClassificationSource });
    await seed([], initial);
    const baselinePlan = planAt(at);
    await run(baselinePlan, { messages: [available], incremental: [id], [purpose]: [id] }, classifiers);
    const baseline = projection((await saved()).items.find(item => item.SourceMessageId === id));
    const baselineCalls = [...calls];
    assert.equal(baseline.historical, false, 'available overlapping source enters the active invoice path');
    assert.deepEqual(baselineCalls, ['incremental']);
    calls.length = 0;
    await seed([], initial);
    const heldPlan = planAt(at);
    await run(heldPlan, { messages: [pending.message], holds: [pending.hold], incremental: [id], [purpose]: [id] }, classifiers);
    const state = await saved();
    assert.deepEqual(new Set(state.accounts[account.email].heldMessages[0].purposes), new Set(['incremental', purpose]));
    assert.equal(state.items.length, 0);
    await api.initializeInvoices(true);
    const retryPlan = planAt(at + 86400);
    await run(retryPlan, { messages: [available] }, classifiers);
    const recovered = (await saved()).items.find(item => item.SourceMessageId === id);
    assert.deepEqual(projection(recovered), baseline, 'holding a source must not change active versus historical eligibility');
    assert.deepEqual(calls, baselineCalls, 'overlapping purpose order must match the available-source pipeline');
  } else if (process.argv[3] === 'retry_unavailable') {
    const id = 'retry-still-unavailable';
    const result = { ...classification, member: 'Kevin' };
    const item = toInvoice(normalizeMail(raw(id)), account.email, account.label, result, 'unavailable');
    let calls = 0;
    const classifyUnavailable = async () => { calls++; return { result, source: 'unavailable' }; };
    await seed([item]);
    await run(planAt(at), { messages: [raw(id)] }, { classify: classifyUnavailable });
    const baselineCalls = calls;
    assert.equal(baselineCalls, 1, 'the existing ordinary retry stage attempts this source once');
    calls = 0;
    await seed([item]);
    const pending = held(id);
    await run(planAt(at), { messages: [pending.message], holds: [pending.hold] }, { classify: classifyUnavailable });
    assert.equal(calls, 0);
    await api.initializeInvoices(true);
    await run(planAt(at + 86400), { messages: [raw(id)] }, { classify: classifyUnavailable });
    assert.equal(calls, baselineCalls, 'recovered held source must not gain another retry from the ordinary loop');
    const state = await saved();
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].ClassificationSource, 'unavailable');
    assert.equal(state.accounts[account.email].heldMessages?.length || 0, 0, 'available originals leave the source hold and retain ordinary classifier retry eligibility');
  } else if (process.argv[3] === 'malformed') {
    await seed();
    const before = await readFile(path, 'utf8'), plan = planAt(at), original = held('held-malformed');
    const good = batchFor(plan, { messages: [original.message], holds: [original.hold], incremental: ['held-malformed'] });
    assert.throws(() => createPluginBatchTransport(good, account.email));
    assert.throws(() => preparedPluginMailSource([{ account, batch: good }]));
    const invalid = structuredClone(good);
    invalid.messages[0].payload.parts[0].body = { size: 7, data: 'not*base64' };
    assert.throws(() => preparedPluginMailSource([{ account, batch: invalid }], { allowHeldMessages: true }));
    const mismatched = structuredClone(good);
    mismatched.heldMessages[0].attachments[0].size++;
    assert.throws(() => preparedPluginMailSource([{ account, batch: mismatched }], { allowHeldMessages: true }));
    const duplicate = structuredClone(good);
    duplicate.heldMessages.push(structuredClone(duplicate.heldMessages[0]));
    assert.throws(() => preparedPluginMailSource([{ account, batch: duplicate }], { allowHeldMessages: true }));
    const truncated = structuredClone(good);
    truncated.queries[0].pages[0].nextPageToken = 'missing-next-page';
    assert.throws(() => preparedPluginMailSource([{ account, batch: truncated }], { allowHeldMessages: true }));
    assert.equal(await readFile(path, 'utf8'), before);
  } else throw new Error('Unknown synthetic fixture');
}
