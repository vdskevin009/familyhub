import type { credentials, accessToken, gmail } from "./gmail-client.js";

export type MailAccount = Readonly<{ email: string; label: string }>;
export type MailSession = { read<T>(path: string): Promise<T> };
export type HeldMailOriginal = { attachmentId: string; filename: string; mimeType: string; size: number; reason: "unsupported_attachment" };
export type HeldMailMessage = { messageId: string; attachments: HeldMailOriginal[]; queries: string[] };
/** Exact source evidence exists, but its originals are unavailable through this connector. */
export class HeldMailSourceError extends Error {
  constructor(readonly messageId: string) { super("Source message is held until its original attachments are available."); }
}
export function validHeldOriginal(value: unknown): value is HeldMailOriginal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.attachmentId === "string" && /^[A-Za-z0-9_-]{1,1500}$/.test(v.attachmentId)
    && typeof v.filename === "string" && v.filename.length <= 255 && !/[\x00-\x1f\x7f]/.test(v.filename)
    && typeof v.mimeType === "string" && v.mimeType.length <= 200 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(v.mimeType)
    && !/^multipart\//i.test(v.mimeType) && (v.filename.length > 0 || !/^text\//i.test(v.mimeType))
    && Number.isSafeInteger(v.size) && Number(v.size) >= 0 && Number(v.size) <= 20_000_000 && v.reason === "unsupported_attachment";
}
/** Source identities and read sessions, with no OAuth fields in the consumer contract. */
export class MailAuthorizationError extends Error {}
export type MailSource = { held?(account: MailAccount): Promise<HeldMailMessage[]>; preflight?(account: MailAccount, paths: readonly string[]): Promise<void>; transport?: "plugin-batch"; accounts(): Promise<MailAccount[]>; open(account: MailAccount): Promise<MailSession> };
type LegacyDependencies = { credentials: typeof credentials; accessToken: typeof accessToken; gmail: typeof gmail };

/** The direct path retains its existing authorization/refresh behavior behind this adapter. */
export function legacyMailSource(deps: LegacyDependencies, now: () => number = Date.now): MailSource {
  let connected: Awaited<ReturnType<typeof credentials>>["accounts"] = [];
  return {
    async accounts() {
      connected = (await deps.credentials()).accounts;
      return connected.map(({ email, label }) => ({ email, label }));
    },
    async open(identity) {
      const account = connected.find(account => account.email === identity.email && account.label === identity.label);
      if (!account) throw new Error("Source account is not connected.");
      let token = await deps.accessToken(account), tokenAt = now();
      return { async read<T>(path: string): Promise<T> {
        if (now() - tokenAt > 50 * 60_000) { try { token = await deps.accessToken(account); tokenAt = now(); } catch { throw new MailAuthorizationError("Gmail authorization unavailable."); } }
        return deps.gmail<T>(token, path);
      } };
    },
  };
}
