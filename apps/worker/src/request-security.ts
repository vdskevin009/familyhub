import type { IncomingMessage, ServerResponse } from "node:http";

type Kind = "invalid-auth" | "authorized" | "preflight";
type Bucket = { since: number; count: number };

/** Non-persistent, bounded protection for the localhost worker behind HTTPS proxies.
 * Never logs IPs, keys, URLs or request bodies. Limits are per source within a minute.
 * An invalid-key flood must not lock out legitimate requests with the right key.
 */
export class WorkerRequestThrottle {
  private readonly buckets: Record<Kind, Map<string, Bucket>> = {
    "invalid-auth": new Map(),
    authorized: new Map(),
    preflight: new Map()
  };
  private readonly thresholds: Record<Kind, number> = {
    "invalid-auth": 96,
    authorized: 300,
    preflight: 180
  };
  constructor(private readonly now: () => number = Date.now) {}

  allowed(kind: Kind, request: IncomingMessage): boolean {
    const buckets = this.buckets[kind];
    const source = workerRequestSource(request);
    const now = this.now();
    const current = buckets.get(source);
    const next = !current || now - current.since >= 60_000
      ? { since: now, count: 1 }
      : { since: current.since, count: current.count + 1 };
    // Insertion-order eviction keeps memory bounded under address rotation.
    buckets.delete(source);
    buckets.set(source, next);
    if (buckets.size > 1024) buckets.delete(buckets.keys().next().value!);
    return next.count <= this.thresholds[kind];
  }
}

/** Use the actual TCP peer only. A forwarded header can be spoofed by
 * arbitrary HTTP clients, so it cannot be trusted as an abuse-control key.
 * ngrok connects to this worker on loopback, deliberately sharing the limit
 * across that tunnel. Invalid credentials and authorized calls use separate
 * buckets so invalid-key traffic does not block legitimate pairing.
 */
export function workerRequestSource(request: IncomingMessage): string {
  return request.socket.remoteAddress || "unknown";
}

export function addWorkerSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}
