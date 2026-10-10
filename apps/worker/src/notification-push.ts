import { createECDH, ECDH } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import webpush from "web-push";
import { loadPrivate, savePrivate } from "./private-store.js";

export type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
const subject = "https://vdskevin009.github.io/familyhub/";
function keyBytes(value: unknown, length: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Clé Web Push invalide.");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) throw new Error("Clé Web Push invalide.");
  return bytes;
}
/** Narrow browser push-service destinations; never follow a redirect to an arbitrary host. */
export function validateSubscription(value: unknown): PushSubscriptionData {
  const input = value as Partial<PushSubscriptionData> | null;
  if (!input || typeof input.endpoint !== "string" || input.endpoint.length > 4096 || !input.keys) throw new Error("Abonnement Web Push invalide.");
  let url: URL;
  try { url = new URL(input.endpoint); } catch { throw new Error("Destination Web Push invalide."); }
  const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com"].includes(url.hostname) || /^(?:[a-z0-9-]+\.)+push\.apple\.com$/.test(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) throw new Error("Destination Web Push non prise en charge.");
  const point = keyBytes(input.keys.p256dh, 65);
  keyBytes(input.keys.auth, 16);
  try { ECDH.convertKey(point, "prime256v1"); } catch { throw new Error("Clé Web Push invalide."); }
  return { endpoint: url.href, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}
export function validateVapid(value: VapidConfig): VapidConfig {
  const privateBytes = keyBytes(value.privateKey, 32), publicBytes = keyBytes(value.publicKey, 65);
  const curve = createECDH("prime256v1");
  curve.setPrivateKey(privateBytes);
  if (!curve.getPublicKey().equals(publicBytes) || value.subject !== subject) throw new Error("Configuration Web Push FamilyHub invalide.");
  return { ...value };
}
export class PushConfiguration {
  constructor(private directory: string) {}
  async read(): Promise<VapidConfig | null> {
    const publicKey = process.env.FAMILYHUB_PUSH_PUBLIC_KEY, privateKey = process.env.FAMILYHUB_PUSH_PRIVATE_KEY;
    if (publicKey || privateKey) return validateVapid({ publicKey: publicKey ?? "", privateKey: privateKey ?? "", subject });
    try { return validateVapid(await loadPrivate<VapidConfig>(join(this.directory, "notifications-vapid.private.json"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Configuration Web Push indisponible sur ce PC. Aucune clé n’a été remplacée."); }
  }
  /** Explicit operator setup only. Never called by startup, polling or an HTTP request. */
  async createAfterApproval(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = join(this.directory, "notifications-vapid.setup.lock");
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); }
    catch { throw new Error("Configuration Web Push déjà en cours ou verrouillée. Aucune clé remplacée."); }
    try {
      // The second check is under an exclusive process lock: concurrent setup cannot rotate identity.
      if (await this.read()) throw new Error("Web Push est déjà configuré; aucune clé remplacée.");
      const keys = webpush.generateVAPIDKeys();
      await savePrivate(join(this.directory, "notifications-vapid.private.json"), { ...keys, subject });
    } finally { await lock.close(); await unlink(lockPath); }
  }
}
export type PushOutcome = "accepted" | "expired" | "failed" | "unconfirmed";
export async function sendPush(subscription: PushSubscriptionData, eventId: string, config: VapidConfig, transport: typeof fetch = fetch): Promise<PushOutcome> {
  const destination = validateSubscription(subscription);
  if (!/^[a-f0-9]{64}$/.test(eventId)) throw new Error("Identifiant de notification invalide.");
  const request = webpush.generateRequestDetails(destination, JSON.stringify({ eventId }), { TTL: 3600, urgency: "normal", vapidDetails: validateVapid(config), contentEncoding: "aes128gcm" });
  try {
    const result = await transport(request.endpoint, { method: "POST", headers: request.headers as Record<string, string>, body: request.body as unknown as BodyInit, redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (result.status === 404 || result.status === 410) return "expired";
    return result.ok ? "accepted" : "failed";
  } catch { return "unconfirmed"; } // A lost response cannot prove rejection. Never replay it automatically.
}
