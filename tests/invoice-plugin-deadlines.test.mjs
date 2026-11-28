import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { collectGmailPluginBatch } from '../apps/worker/dist/gmail-plugin-runner.js';
import { disabledCodeModeWarning } from '../apps/worker/dist/private-codex-isolation.js';

const account = 'fixture@example.test';
const linkId = 'link_fixture';
const request = { account, linkId, queries: [] };
const config = { config: { apps: {}, plugins: {}, mcp_servers: {}, model: 'gpt-fixture', service_tier: 'priority' }, layers: [{ name: { type: 'user' }, version: 'fixture' }] };

// Virtual elapsed time is advanced only where the substitute CLI would deliver
// a result. The collector itself creates all deadlines and chooses every command.
function boundedCli(t, scenario = {}) {
  let clock = 0;
  const timers = [];
  const configClosed = [];
  const calls = { config: 0, inventories: 0, gmail: 0, open: 0 };
  t.mock.method(AbortSignal, 'timeout', ms => {
    const timer = { controller: new AbortController(), at: clock + ms };
    timers.push(timer);
    return timer.controller.signal;
  });
  function advance(ms) {
    clock += ms;
    for (const timer of timers) if (timer.at <= clock && !timer.controller.signal.aborted) timer.controller.abort();
    if (scenario.cancelAt && clock >= scenario.cancelAt) scenario.controller.abort();
  }
  t.mock.method(childProcess, 'spawn', (binary, args) => {
    assert.equal(binary, process.execPath);
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    calls.open++;
    let closed = false;
    function close(code) {
      if (closed) return;
      closed = true;
      setImmediate(() => { calls.open--; child.emit('close', code); });
    }
    child.kill = () => close(null);
    function emit(value) { if (!closed) child.stdout.write(JSON.stringify(value) + '\n'); }
    if (args[0] === 'app-server') {
      calls.config++;
      configClosed.push(new Promise(resolve => child.once('close', resolve)));
      child.stdin.write = line => {
        const event = JSON.parse(line);
        if (event.id === 1) setImmediate(() => emit({ id: 1, result: {} }));
        if (event.id === 2) setImmediate(() => {
          const result = structuredClone(config);
          if (scenario.changedModelAfter && calls.config === 2) result.config.model = 'gpt-other';
          emit({ id: 2, result });
        });
      };
      child.stdin.end = () => close(0);
    } else if (args[0] === 'plugin') {
      assert.deepEqual(args, ['plugin', 'list', '--json', '-c', 'features.hooks=false']);
      const index = calls.inventories++;
      child.stdin.end = () => configClosed[index].then(() => setImmediate(() => {
        advance(scenario.inventoryMs?.[index] ?? 5_000);
        if (closed) return;
        if (scenario.errorAt === index) return close(1);
        const version = scenario.changedAfter && index === 1 ? '2' : '1';
        const rows = [{ pluginId: 'gmail@openai-curated-remote', installed: true, enabled: true, version }];
        emit(scenario.unknownAt === index ? { available: [] } : { installed: rows });
        close(0);
      }));
    } else {
      assert.equal(args[0], 'exec');
      assert.ok(args.includes('read-only') && args.includes('features.hooks=false'));
      child.stdin.end = prompt => setImmediate(() => {
        assert.match(prompt, /Execute exactly one Gmail get_profile/);
        calls.gmail++;
        advance(scenario.callMs ?? 20_000);
        if (closed) return;
        if (scenario.rejectedEvent) {
          emit({ type: 'thread.started' });
          emit(scenario.rejectedEvent);
          return close(1);
        }
        for (const event of scenario.preamble || []) emit(event);
        if (scenario.noTool) { emit({ type: 'turn.completed' }); return close(0); }
        const base = { id: 'fixture', type: 'mcp_tool_call', server: 'codex_apps', tool: 'gmail.get_profile', arguments: { link_id: linkId } };
        emit({ type: 'item.started', item: { ...base, status: 'in_progress' } });
        emit({ type: 'item.completed', item: { ...base, status: 'completed', error: null, result: { structured_content: { email: account } } } });
        emit({ type: 'turn.completed' });
        close(0);
      });
    }
    return child;
  });
  syncBuiltinESMExports();
  const old = process.env.FAMILYHUB_CODEX_PATH;
  process.env.FAMILYHUB_CODEX_PATH = process.execPath;
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (old === undefined) delete process.env.FAMILYHUB_CODEX_PATH;
    else process.env.FAMILYHUB_CODEX_PATH = old;
  });
  return calls;
}

test('invoice reads admit a slow complete inventory before and after the same Gmail read', async t => {
  const calls = boundedCli(t, { inventoryMs: [109_000, 95_000] });
  const batch = await collectGmailPluginBatch(request, { allowHeldMessages: true });
  assert.equal(batch.account, account);
  assert.deepEqual(batch.messages, []);
  assert.deepEqual(calls, { config: 2, inventories: 2, gmail: 1, open: 0 });
});

for (const [label, scenario, stage, code, count] of [
  ['inventory over its limit', { inventoryMs: [130_000] }, 'isolation_before', 'metadata_unavailable', 0],
  ['unavailable inventory process', { errorAt: 0 }, 'isolation_before', 'metadata_unavailable', 0],
  ['unknown inventory shape', { unknownAt: 0 }, 'isolation_before', 'invalid_evidence', 0],
  ['inventory changed after Gmail returned', { changedAfter: true }, 'isolation_after', 'configuration_changed', 1],
  ['unknown final inventory', { unknownAt: 1 }, 'isolation_after', 'invalid_evidence', 1],
  ['Gmail call over its own limit', { callMs: 130_000 }, 'tool_evidence', 'timeout_or_cancelled', 1],
]) test('invoice rejects ' + label, async t => {
  const calls = boundedCli(t, scenario);
  await assert.rejects(collectGmailPluginBatch(request, { allowHeldMessages: true }), e => e.code === code && e.stage === stage);
  assert.equal(calls.gmail, count);
  assert.equal(calls.open, 0);
});

test('the enclosing collection cancellation still discards unverified results', async t => {
  const controller = new AbortController();
  const calls = boundedCli(t, { controller, cancelAt: 50_000, inventoryMs: [5_000, 30_000] });
  await assert.rejects(collectGmailPluginBatch(request, { allowHeldMessages: true, signal: controller.signal }), e => e.stage === 'isolation_after');
  assert.equal(calls.gmail, 1);
  assert.equal(calls.open, 0);
});

test('other batch consumers retain the existing metadata deadline', async t => {
  const calls = boundedCli(t, { inventoryMs: [90_000] });
  await assert.rejects(collectGmailPluginBatch(request), e => e.code === 'metadata_unavailable' && e.stage === 'isolation_before');
  assert.equal(calls.gmail, 0);
  assert.equal(calls.open, 0);
});

for (const [flag, rejectedEvent] of [
  ['disabledHostWarning', { type: 'item.completed', item: { type: 'error', message: disabledCodeModeWarning } }],
  ['unrecognizedItem', { type: 'item.completed', item: { type: 'unexpected', message: 'fictional-private-string' } }],
  ['runnerErrorEvent', { type: 'error', message: 'fictional-private-string' }],
  ['failedTurn', { type: 'turn.failed', error: { message: 'fictional-private-string' } }],
]) test('invoice records only the bounded rejection flag ' + flag, async t => {
  const calls = boundedCli(t, { rejectedEvent });
  await assert.rejects(collectGmailPluginBatch(request, { allowHeldMessages: true }), e => {
    assert.equal(e.code, 'invalid_evidence');
    assert.equal(e.stage, 'tool_evidence');
    assert.equal(e.diagnostics[flag], true);
    assert.equal(e.diagnostics.mcpItems, 0);
    assert.equal(e.diagnostics.completed, false);
    assert.doesNotMatch(JSON.stringify(e.diagnostics), /fictional-private-string|Code Mode is unavailable/);
    return true;
  });
  assert.equal(calls.open, 0);
});

const threadStart = { type: 'thread.started', thread_id: 'synthetic-thread' };
const turnStart = { type: 'turn.started' };
const tierText = 'Configured service tier `priority` is not advertised as supported for model `gpt-fixture` and will be omitted from requests.';
const tierNotice = { type: 'item.completed', item: { id: 'item-0', type: 'error', message: tierText } };

test('invoice profile survives the verified pre-turn tier notification and still requires a complete MCP result', async t => {
  const calls = boundedCli(t, { preamble: [threadStart, tierNotice, turnStart] });
  const batch = await collectGmailPluginBatch(request, { allowHeldMessages: true });
  assert.equal(batch.account, account);
  assert.deepEqual(batch.messages, []);
  assert.deepEqual(calls, { config: 2, inventories: 2, gmail: 1, open: 0 });
});

for (const [name, preamble, noTool = false, invoice = true] of [
  ['missing thread', [tierNotice, turnStart]],
  ['unexpected thread envelope', [{ ...threadStart, error: true }, tierNotice, turnStart]],
  ['missing turn', [threadStart, tierNotice]],
  ['late notice', [threadStart, turnStart, tierNotice]],
  ['duplicate notice', [threadStart, tierNotice, tierNotice, turnStart]],
  ['different model', [threadStart, { ...tierNotice, item: { ...tierNotice.item, message: tierText.replace('gpt-fixture', 'gpt-other') } }, turnStart]],
  ['different tier', [threadStart, { ...tierNotice, item: { ...tierNotice.item, message: tierText.replace('priority', 'other') } }, turnStart]],
  ['HTTP metadata', [threadStart, { ...tierNotice, item: { ...tierNotice.item, status_code: 403 } }, turnStart]],
  ['unknown second item', [threadStart, tierNotice, { type: 'item.completed', item: { id: 'item-1', type: 'error', message: 'synthetic unknown' } }, turnStart]],
  ['no MCP evidence', [threadStart, tierNotice, turnStart], true],
  ['other consumers', [threadStart, tierNotice, turnStart], false, false],
]) test('the Claims tier notice never validates ' + name, async t => {
  const calls = boundedCli(t, { preamble, noTool });
  await assert.rejects(collectGmailPluginBatch(request, { allowHeldMessages: invoice }), e => e.code === 'invalid_evidence' && e.stage === 'tool_evidence');
  assert.equal(calls.open, 0);
});

for (const [flag, event] of [
  ['failedTurn', { type: 'turn.failed' }],
  ['runnerErrorEvent', { type: 'error' }],
  ['disabledHostWarning', { type: 'item.completed', item: { id: 'item-1', type: 'error', message: disabledCodeModeWarning } }],
]) test('a second startup failure retains the bounded ' + flag + ' diagnosis', async t => {
  boundedCli(t, { preamble: [threadStart, tierNotice, event] });
  await assert.rejects(collectGmailPluginBatch(request, { allowHeldMessages: true }), e => e.code === 'invalid_evidence'
    && e.diagnostics.tierNoticeSeen && e.diagnostics[flag] && e.diagnostics.mcpItems === 0);
});

test('a changed tier notice binding after the profile rejects the result', async t => {
  boundedCli(t, { preamble: [threadStart, tierNotice, turnStart], changedModelAfter: true });
  await assert.rejects(collectGmailPluginBatch(request, { allowHeldMessages: true }), e => e.code === 'configuration_changed' && e.stage === 'isolation_after');
});
