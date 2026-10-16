import assert from 'node:assert/strict';
import { test, mock, afterEach } from 'node:test';
import { claimAction } from '../src/worker.ts';
const config = { Endpoint: 'https://paired-pc.example', ApiKey: 'synthetic-test-only' };
afterEach(() => mock.restoreAll());
function transport() {
  let elapsed = 0;
  const timers: { deadline: number; controller: AbortController }[] = [];
  mock.method(AbortSignal, 'timeout', (delay: number) => {
    const controller = new AbortController(); timers.push({ deadline: elapsed + delay, controller }); return controller.signal;
  });
  const requests: string[] = [];
  let finish: (value: Response) => void = () => {};
  let requested: () => void = () => {};
  const started = new Promise<void>(resolve => { requested = resolve; });
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/health')) return new Response(JSON.stringify({ version: '2.26.8' }), { status: 200 });
    return new Promise<Response>((resolve, reject) => {
      finish = resolve;
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      requested();
    });
  });
  return { requests, started, finish: () => finish(new Response(JSON.stringify({ submitAllowed: false, step: { status: 'review' }, verification: { attachment: { status: 'verified' } } }), { status: 200 })), advance: (ms: number) => {
    elapsed += ms; for (const timer of timers) if (timer.deadline <= elapsed && !timer.controller.signal.aborted) timer.controller.abort(new DOMException('Timed out', 'TimeoutError'));
  } };
}
test('a four-minute preparation returns its verified upload without restarting after three minutes', async () => {
  const t = transport(); let settled = false;
  const pending = claimAction<any>(config, 'prepare', { expenseId: 'synthetic-invoice', insurer: 'blue-cross', prepareAuthorized: true }).finally(() => { settled = true; });
  await t.started; t.advance(180_001); await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  t.advance(59_999); t.finish(); const result = await pending;
  assert.equal(result.verification.attachment.status, 'verified'); assert.equal(result.submitAllowed, false);
  assert.equal(t.requests.filter(url => url.includes('/claim-preparation/')).length, 1);
});
test('an expired preparation response warns about ongoing work and never retries the POST', async () => {
  const t = transport();
  const pending = claimAction(config, 'prepare', { expenseId: 'synthetic-invoice', prepareAuthorized: true });
  const rejected = assert.rejects(pending, /PC may still be preparing.*do not restart preparation or upload the receipt again/i);
  await t.started; t.advance(15 * 60_000 + 1); await rejected;
  assert.equal(t.requests.filter(url => url.includes('/claim-preparation/')).length, 1);
});
test('ordinary read-only inspection retains its shorter bounded deadline', async () => {
  const t = transport(); const pending = claimAction(config, 'inspect', { sessionId: 'synthetic-session' });
  const rejected = assert.rejects(pending, /Cannot reach your FamilyHub PC/);
  await t.started; t.advance(180_001); await rejected;
  assert.equal(t.requests.filter(url => url.includes('/claim-preparation/')).length, 1);
});
