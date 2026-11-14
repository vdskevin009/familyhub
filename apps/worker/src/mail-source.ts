import type { credentials, accessToken, gmail } from "./gmail-client.js";

export type MailAccount = Readonly<{ email: string; label: string }>;
export type MailSession = { read<T>(path: string): Promise<T> };
/** Source identities and read sessions, with no OAuth fields in the consumer contract. */
export class MailAuthorizationError extends Error {}
export type MailSource = { preflight?(account: MailAccount, paths: readonly string[]): Promise<void>; transport?: "plugin-batch"; accounts(): Promise<MailAccount[]>; open(account: MailAccount): Promise<MailSession> };
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
