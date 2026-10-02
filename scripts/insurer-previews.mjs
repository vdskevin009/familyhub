import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// This client never applies financial data and never retries a POST.
export async function runPreviews(request) {
  const results = [];
  for (const insurer of ['bluecross', 'desjardins']) {
    const inbox = await request('/invoices');
    const states = await Promise.all(['bluecross', 'desjardins'].map(async name => {
      const status = await request(`/${name}/status`);
      const reconnect = await request(`/${name}/reconnect`);
      return status.state === 'syncing' || reconnect.state === 'running';
    }));
    if (inbox.busy || states.some(Boolean)) {
      results.push({ insurer, outcome: 'worker-busy' });
      break;
    }
    try {
      await request(`/${insurer}/sync`, { apply: false });
    } catch {
      // A timed-out request may still be collecting. Do not replay or start
      // another insurer after an uncertain transport failure.
      results.push({ insurer, outcome: 'request-failed-no-retry' });
      break;
    }
    const status = await request(`/${insurer}/status`);
    const complete = status.latestResult?.complete === true && status.latestResult.errors === 0 && status.latestResult.ambiguous === 0;
    results.push({ insurer, outcome: complete && !['error', 'login-required', 'syncing'].includes(status.state)
      ? 'preview-complete' : 'attention-required', state: status.state });
  }
  return { attemptedAt: new Date().toISOString(), apply: false, results,
    success: results.length === 2 && results.every(result => result.outcome === 'preview-complete') };
}

async function main() {
  const data = process.env.FAMILYHUB_WORKER_DATA;
  const port = Number(process.env.FAMILYHUB_WORKER_PORT || 4713);
  if (!data || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid runner configuration.');
  const key = (await readFile(join(data, 'pairing-key.txt'), 'utf8')).trim();
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-familyhub-key': key, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(body ? 15 * 60 * 1000 : 10000)
    });
    if (!response.ok) throw new Error('Worker request failed.');
    return response.json();
  };
  let report;
  try {
    const health = await request('/health');
    const [major, minor, patch] = String(health.version).split('.').map(Number);
    if (!(major > 2 || major === 2 && (minor > 16 || minor === 16 && patch >= 1))) throw new Error('Update worker.');
    report = await runPreviews(request);
  } catch {
    report = { attemptedAt: new Date().toISOString(), apply: false, success: false, results: [], outcome: 'worker-unavailable' };
  }
  const file = join(data, 'insurer-automation-status.json');
  await writeFile(`${file}.tmp`, JSON.stringify(report, null, 2));
  await rename(`${file}.tmp`, file);
  console.log(JSON.stringify(report));
  process.exitCode = report.success ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Insurer preview runner failed. Check the local worker status.'); process.exitCode = 1; });
}
