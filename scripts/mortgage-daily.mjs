import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Existing worker and its durable daily reservation own the run. No new scheduler and no POST replay.
export async function runMortgageDaily(request, now = new Date()) {
  const health = await request('/health');
  if (!health.capabilities?.includes('mortgage-assistant-v1')) throw new Error('Mortgage assistant is not installed on the existing worker.');
  const before = await request('/mortgage');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  try {
    const result = await request('/mortgage/run-daily', {});
    return { outcome: 'complete', result };
  } catch {
    // An uncertain response is not permission to run again. A new saved report may be recovered read-only.
    try {
      const after = await request('/mortgage');
      const found = (after.reports ?? []).filter(r => r.localDate === date && !(before.reports ?? []).some(previous => previous.id === r.id));
      if (found.length === 1) return { outcome: 'recovered-by-read', result: found[0] };
    } catch { /* Preserve uncertainty; no repeated POST. */ }
    return { outcome: 'unconfirmed-no-retry', result: null };
  }
}
async function main() {
  const args = process.argv.slice(2), option = name => { const position = args.indexOf(name); return position >= 0 ? args[position + 1] : undefined; };
  const endpoint = new URL(option('--endpoint') ?? 'http://127.0.0.1:4713');
  if (!((endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) || endpoint.protocol === 'https:') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('Use the existing private worker endpoint.');
  const keyFile = option('--key-file'); if (!keyFile) throw new Error('An existing pairing key file is required.');
  const key = (await readFile(keyFile, 'utf8')).trim(); if (!key) throw new Error('Pairing key unavailable.');
  const request = async (path, body) => {
    const response = await fetch(new URL(path, endpoint), { method: body ? 'POST' : 'GET', redirect: 'error', headers: { 'x-familyhub-key': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(body ? 60000 : 10000) });
    if (!response.ok) throw new Error('Existing worker request failed.');
    return response.json();
  };
  const report = await runMortgageDaily(request);
  console.log(JSON.stringify({ outcome: report.outcome }));
  process.exitCode = report.outcome === 'unconfirmed-no-retry' ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Mortgage daily run unavailable. Inspect existing worker state before retrying.'); process.exitCode = 1; });
