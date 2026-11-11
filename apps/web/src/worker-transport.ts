import type { WorkerConfig } from "./types";

/**
 * ngrok free endpoints display an HTML interstitial to browser traffic.
 * The documented opt-out header is scoped to ngrok's assigned dev domains,
 * never to an arbitrary hostname containing the word "ngrok".
 *
 * The existing x-familyhub-key and exact-origin checks remain mandatory.
 * This helper never makes an endpoint public or changes worker pairing.
 */
export function isNgrokFreeEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint.trim());
    return url.protocol === "https:"
      && /^[a-z0-9-]+\.ngrok-free\.(?:app|dev)$/.test(url.hostname.toLowerCase())
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function workerRequestHeaders(
  config: Pick<WorkerConfig, "Endpoint" | "ApiKey">,
  json = true
): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-familyhub-key": config.ApiKey.trim(),
    ...(isNgrokFreeEndpoint(config.Endpoint) ? { "ngrok-skip-browser-warning": "1" } : {})
  };
}
