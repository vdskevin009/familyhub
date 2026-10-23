import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Persist a small allowlisted diagnosis; never error messages, request bodies or credentials.
export function requestFailure(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) return { kind: 'http', status: error.status };
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { kind: 'timeout' };
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'UND_ERR_SOCKET'].includes(error?.cause?.code)) return { kind: 'connection', code: error.cause.code };
  return { kind: 'unconfirmed' };
}
const pacificDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
// Use only the existing authenticated worker. One POST; recovery only reads a uniquely saved job.
export async function runDaily(request, persist, now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const report = { attemptedAt: new Date(now()).toISOString(), success: false, results: [], outcome: 'running' };
  const finish = async () => { report.completedAt = new Date(now()).toISOString(); await persist(report); return report; };
  await persist(report);
  try {
    const library = await request('/savings/contracts');
    const deadline = now() + 2 * 60 * 60 * 1000;
    for (const { contract } of library.records) {
      if (now() >= deadline) { report.outcome = 'batch-deadline'; break; }
      const recent = await request('/savings/research');
      if (recent.jobs.some(job => job.status === 'running' || job.status === 'queued')) { report.outcome = 'research-busy'; break; }
      let job;
      const started = now();
      try { job = await request('/savings/research/daily', { contractId: contract.id }); }
      catch (error) {
        report.failure = requestFailure(error);
        report.outcome = 'request-failed-no-retry';
        try {
          const saved = await request('/savings/research');
          const matches = saved.jobs.filter(candidate => candidate.contractId === contract.id
            && candidate.scheduledDate === pacificDate(started)
            && Date.parse(candidate.createdAt) >= started - 5000
            && !recent.jobs.some(previous => previous.id === candidate.id));
          if (matches.length === 1) { job = matches[0]; report.outcome = 'running'; }
        } catch { /* Preserve the first failure. No POST is replayed. */ }
        if (!job) break;
      }
      const result = { contractId: contract.id, jobId: job.id, outcome: job.status,
        ...(job.dailyReused ? { reused: true } : {}), ...(report.failure ? { recoveredByRead: true } : {}) };
      delete report.failure;
      report.results.push(result); await persist(report);
      while (job.status === 'running' || job.status === 'queued') {
        if (now() >= deadline) { report.outcome = 'research-still-running'; return finish(); }
        await wait(5000);
        try { job = await request(`/savings/research/${encodeURIComponent(job.id)}`); }
        catch (error) { report.failure = requestFailure(error); report.outcome = 'connection-lost-no-retry'; return finish(); }
      }
      result.outcome = job.status; await persist(report);
    }
  } catch (error) { report.failure = requestFailure(error); report.outcome = 'connection-lost-no-retry'; }
  if (report.outcome === 'running') report.outcome = report.results.length === 0 ? 'no-shared-contracts' : report.results.every(result => result.outcome === 'complete') ? 'complete' : 'attention-required';
  report.success = report.outcome === 'complete';
  return finish();
}
async function main() {
  const data = process.env.FAMILYHUB_WORKER_DATA, port = Number(process.env.FAMILYHUB_WORKER_PORT || 4713);
  if (!data || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid daily configuration.');
  const directory = join(data, 'savings'); await mkdir(directory, { recursive: true });
  const key = (await readFile(join(data, 'pairing-key.txt'), 'utf8')).trim();
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { 'x-familyhub-key': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    if (!response.ok) { const error = new Error('Worker request failed.'); error.status = response.status; throw error; }
    return response.json();
  };
  const file = join(directory, 'daily-status.json');
  const persist = async report => { await writeFile(file + '.tmp', JSON.stringify(report), { mode: 0o600 }); await rename(file + '.tmp', file); };
  let report;
  try {
    const health = await request('/health');
    const [major, minor] = String(health.version).split('.').map(Number);
    if (!(major > 2 || major === 2 && minor >= 21)) throw new Error('Update the existing worker.');
    report = await runDaily(request, persist);
  } catch (error) { report = { attemptedAt: new Date().toISOString(), success: false, results: [], outcome: 'worker-unavailable', failure: requestFailure(error) }; await persist(report); }
  console.log(JSON.stringify({ outcome: report.outcome, completed: report.results.filter(result => result.outcome === 'complete').length, reused: report.results.filter(result => result.reused).length, contracts: report.results.length }));
  process.exitCode = report.success ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Daily Savings runner failed. Check the paired PC status.'); process.exitCode = 1; });
