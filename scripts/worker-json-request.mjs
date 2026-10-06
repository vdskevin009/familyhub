import { request as httpRequest } from 'node:http';

/** Explicit total deadline, including response headers. Never retries or follows redirects. */
export function workerJsonRequest(port, key, path, body, timeoutMs = body ? 15 * 60_000 : 10_000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !/^\/(?:health|invoices|(?:bluecross|desjardins)\/(?:status|reconnect|sync))$/.test(path))
    return Promise.reject(new Error('Invalid local worker request.'));
  return new Promise((resolve, reject) => {
    const payload = body == null ? undefined : JSON.stringify(body);
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: payload ? 'POST' : 'GET', agent: false,
      headers: { 'x-familyhub-key': key, 'content-type': 'application/json', ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); finish(new Error('Worker request failed.')); return; }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', () => finish(new Error('Worker response failed.')));
      response.on('aborted', () => finish(new Error('Worker response interrupted.')));
      response.on('end', () => { try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new Error('Worker response was not valid JSON.')); } });
    });
    const timer = setTimeout(() => { finish(new Error('Worker request timed out.')); req.destroy(); }, timeoutMs);
    req.on('error', () => finish(new Error('Worker request failed.')));
    req.end(payload);
  });
}
