import { createPluginBatchTransport } from "./gmail-plugin-batch.js";
import { HeldMailSourceError, type MailAccount, type MailSource } from "./mail-source.js";

/** Internal/test composition only: preflight all batches before any collector can write. */
export function preparedPluginMailSource(inputs: ReadonlyArray<{ account: MailAccount; batch: unknown }>, options: { allowHeldMessages?: boolean } = {}): MailSource {
  if (!inputs.length || inputs.length > 16) throw new Error("Invalid prepared plugin account set.");
  const sources = inputs.map(({ account, batch }) => {
    if (typeof account.label !== "string" || account.label.length > 200) throw new Error("Invalid prepared plugin account label.");
    return { identity: { email: account.email, label: account.label }, transport: createPluginBatchTransport(batch, account.email, options) };
  });
  if (new Set(sources.map(source => source.identity.email)).size !== sources.length) throw new Error("Duplicate prepared plugin account.");
  return {
    transport: "plugin-batch",
    accounts: async () => sources.map(source => ({ ...source.identity })),
    async held(account) {
      const source = sources.find(source => source.identity.email === account.email && source.identity.label === account.label);
      if (!source) throw new Error("Prepared plugin source account does not match.");
      return structuredClone(source.transport.held);
    },
    async preflight(account, paths) {
      const source = sources.find(source => source.identity.email === account.email && source.identity.label === account.label);
      if (!source) throw new Error("Prepared plugin source account does not match.");
      for (const path of paths) {
        try { await source.transport.gmail(source.transport.token, path); }
        catch (error) { if (!(options.allowHeldMessages === true && error instanceof HeldMailSourceError)) throw error; }
      }
    },
    async open(account) {
      const source = sources.find(source => source.identity.email === account.email && source.identity.label === account.label);
      if (!source) throw new Error("Prepared plugin source account does not match.");
      return { read: <T>(path: string) => source.transport.gmail<T>(source.transport.token, path) };
    },
  };
}
