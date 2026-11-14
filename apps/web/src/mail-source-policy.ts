/** A remembered routing restriction, never a credential or source of mail evidence.
 * Only authenticated worker snapshots may update these per-account selections.
 */
const key = "familyhub.mail-source-policy.v1";
type Modes = Record<string, "plugin">;
type Source = { email: string; sourceMode?: "plugin" | "legacy" };
const email = (value: unknown): value is string => typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
const storageWarning = "Mail source preferences could not be verified or saved. Browser Gmail retrieval is disabled for this session; paired documents remain available.";

/** Build-only cutover gate. Invalid values fail closed. Changing it requires rebuild/deployment. */
export function mailBuildMode(mode: unknown): "legacy" | "plugin-only" {
  if (mode === undefined || mode === "") return "legacy";
  if (mode === "plugin-only") return mode;
  throw new Error("Mail retrieval build configuration is invalid. Use the paired PC; browser Gmail fallback is disabled.");
}
export function assertBrowserMailBuildMode(mode: unknown): void {
  if (mailBuildMode(mode) === "plugin-only") throw new Error("This FamilyHub build uses the Gmail plugin. Pair and connect the PC to retrieve mail; browser Gmail fallback is disabled.");
}
/** One browser-session policy. A storage failure latches all uncertain mailbox reads
 * closed for this session, independently of whether paired invoice display continues.
 */
export function createMailSourcePolicy(storage: () => Pick<Storage, "getItem" | "setItem"> = () => localStorage) {
  let uncertain = false;
  const knownPlugin = new Set<string>();
  function read(): Modes {
    try {
      const raw = storage().getItem(key);
      if (raw === null) return {};
      if (raw.length > 16_384) throw new Error();
      const saved = JSON.parse(raw);
      if (saved?.schema !== 1 || !saved.accounts || typeof saved.accounts !== "object" || Array.isArray(saved.accounts)
        || Object.entries(saved.accounts).some(([account, mode]) => !email(account) || account !== account.toLowerCase() || mode !== "plugin")) throw new Error();
      return saved.accounts;
    } catch { uncertain = true; throw new Error(storageWarning); }
  }
  function remember(accounts: readonly Source[]): void {
    const explicit = accounts.filter(account => account.sourceMode === "plugin" || account.sourceMode === "legacy");
    if (!explicit.length) return; // Older workers cannot remove a known plugin restriction.
    try {
      for (const account of explicit) if (account.sourceMode === "plugin" && email(account.email)) knownPlugin.add(account.email.toLowerCase());
      const modes = read();
      for (const account of explicit) {
        if (!email(account.email)) throw new Error();
        const normalized = account.email.toLowerCase();
        if (account.sourceMode === "plugin") modes[normalized] = "plugin";
        else delete modes[normalized];
      }
      storage().setItem(key, JSON.stringify({ schema: 1, accounts: modes }));
      for (const account of explicit) if (account.sourceMode === "legacy") knownPlugin.delete(account.email.toLowerCase());
      // Do not clear uncertainty: previously unreadable entries may include other accounts.
    } catch { uncertain = true; throw new Error(storageWarning); }
  }
  function assertAllowed(account: string): void {
    assertBrowserMailBuildMode(import.meta.env?.VITE_MAIL_RETRIEVAL_MODE);
    if (!email(account)) throw new Error("Invalid mail source identity.");
    if (uncertain) throw new Error(storageWarning);
    if (knownPlugin.has(account.toLowerCase()) || read()[account.toLowerCase()] === "plugin") throw new Error("This mailbox uses the Gmail plugin. Reconnect the paired PC; browser Gmail fallback is disabled.");
  }
  return { remember, assertAllowed, warning: () => uncertain ? storageWarning : undefined };
}
const browserPolicy = createMailSourcePolicy();
export const rememberMailSources = browserPolicy.remember;
export const assertBrowserMailAllowed = browserPolicy.assertAllowed;
export const mailSourcePolicyWarning = browserPolicy.warning;
