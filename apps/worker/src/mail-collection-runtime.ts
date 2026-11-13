import { OriginalPreparationRequiredError } from "./attachment-preparation.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, dataDirectory } from "./private-store.js";
import { credentials } from "./gmail-client.js";
import { readMailSourcePolicy, rememberPluginSelection, type PluginMailAccount } from "./mail-source-policy.js";
import { createPluginBatchTransport, type PluginBatch } from "./gmail-plugin-batch.js";
import { createMailAttachmentCache, type MailAttachmentSource } from "./mail-attachment-cache.js";
import { preparedPluginMailSource } from "./prepared-plugin-mail-source.js";
import { collectInvoices, invoiceCollectionPlan, importBlueCrossMessages } from "./invoices.js";
import type { GroceryCollection } from "./grocery-collection.js";
import type { RawMail } from "./gmail-client.js";
export type PluginRetrievalRequest = { account: string; linkId: string; queries: readonly { q: string; maxResults: number }[]; messageIds?: readonly string[] };
export type PluginBatchRunner = (request: PluginRetrievalRequest, options: { signal: AbortSignal }) => Promise<PluginBatch>;
export type PluginOriginalRequest = { account: string; linkId: string; expected: MailAttachmentSource };
export type PluginOriginalRunner = (request: PluginOriginalRequest, options: { signal: AbortSignal }) => Promise<Buffer>;
type Domain = "invoices" | "groceries" | "attachment" | "bluecross";
type Attempt = { lastAttempt?: string; error?: string };
type RuntimeState = { schema: 1; running?: Domain; attempts: Partial<Record<Domain, Attempt>> };
type Dependencies = {
  directory?: string; grocery: GroceryCollection; runner?: PluginBatchRunner; originalRunner?: PluginOriginalRunner; timeoutMs?: number;
  now?: () => Date; collectInvoices?: typeof collectInvoices; invoicePlan?: typeof invoiceCollectionPlan;
  importBlueCross?: typeof importBlueCrossMessages; writeStatus?: typeof atomicJson;
};
/** One worker-owned lifecycle for manual and scheduled triggers; no source policy is written here. */
export class MailCollectionRuntime {
  private directory: string;
  private state: RuntimeState = { schema: 1, attempts: {} };
  private ready: Promise<void>;
  private active?: { domain: Domain; controller: AbortController; applying: boolean };
  private mode: "legacy" | "plugin" = "legacy";
  private policyError?: string;
  private statusUnreadable = false;
  private now: () => Date;
  private runner: PluginBatchRunner;
  private originalRunner: PluginOriginalRunner;
  constructor(private deps: Dependencies) {
    this.directory = deps.directory || dataDirectory; this.now = deps.now || (() => new Date());
    this.runner = deps.runner || (async (request, options) => (await import("./gmail-plugin-runner.js")).collectGmailPluginBatch(request, options));
    this.originalRunner = deps.originalRunner || (async (request, options) => (await import("./gmail-plugin-runner.js")).collectGmailPluginOriginal(request, options));
    this.ready = this.load();
  }
  private async load() {
    try {
      const text = await readFile(join(this.directory, "mail-runtime-status.json"), "utf8");
      if (Buffer.byteLength(text) > 16_384) throw new Error();
      const saved = JSON.parse(text) as RuntimeState;
      if (saved.schema !== 1 || !saved.attempts || typeof saved.attempts !== "object" || Array.isArray(saved.attempts) || !Object.keys(saved.attempts).every(key => ["invoices", "groceries", "attachment", "bluecross"].includes(key)) || saved.running && !["invoices", "groceries", "attachment", "bluecross"].includes(saved.running)) throw new Error();
      this.state = { schema: 1, attempts: {} };
      for (const domain of ["invoices", "groceries", "attachment", "bluecross"] as const) {
        const attempt = saved.attempts[domain];
        if (attempt && (typeof attempt !== "object" || Array.isArray(attempt) || attempt.lastAttempt !== undefined && (typeof attempt.lastAttempt !== "string" || !Number.isFinite(Date.parse(attempt.lastAttempt))) || attempt.error !== undefined && typeof attempt.error !== "string")) throw new Error();
        if (attempt) this.state.attempts[domain] = { lastAttempt: attempt.lastAttempt, ...(attempt.error ? { error: "Previous mail retrieval was incomplete; retry from its saved source window." } : {}) };
      }
      if (saved.running) this.state.attempts[saved.running] = { ...this.state.attempts[saved.running], error: "Previous mail retrieval was interrupted; coverage was not established." };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { this.statusUnreadable = true; this.policyError = "Mail runtime status is unavailable; inspect the private worker state before retrying."; } }
  }
  private async policy() {
    try { const policy = await readMailSourcePolicy(this.directory); if (policy.mode === "plugin") await rememberPluginSelection(this.directory); this.mode = policy.mode; if (!this.statusUnreadable) this.policyError = undefined; return policy; }
    catch { this.mode = "plugin"; this.policyError = "Mail source policy is invalid or unavailable. No direct Gmail fallback was used."; throw new Error(this.policyError); }
  }
  async accounts() {
    await this.ready;
    const policy = await this.policy();
    if (policy.mode === "plugin") return policy.accounts.map(({ email, label }) => ({ email, label, sourceMode: "plugin" as const }));
    return (await credentials()).accounts.map(({ email, label }) => ({ email, label, sourceMode: "legacy" as const }));
  }
  status() {
    return { busy: !!this.active, sourceMode: this.mode, lastAttempt: this.state.attempts.invoices?.lastAttempt,
      error: this.policyError || this.state.attempts.invoices?.error };
  }
  isBusy() { return !!this.active; }
  /** Cancels retrieval only. An applying collector retains its existing atomic/manual-authority semantics. */
  cancel(): boolean { if (!this.active || this.active.applying) return false; this.active.controller.abort(); return true; }
  private async save() { await (this.deps.writeStatus || atomicJson)(join(this.directory, "mail-runtime-status.json"), this.state); }
  private async run<T>(domain: Domain, action: (signal: AbortSignal, applying: () => void) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
    if (this.active) throw new Error("A mail operation is already running. Read its status before retrying.");
    const active = { domain, controller: new AbortController(), applying: false }; this.active = active;
    const externalAbort = () => { if (!active.applying) active.controller.abort(); };
    externalSignal?.addEventListener("abort", externalAbort, { once: true }); if (externalSignal?.aborted) externalAbort();
    const timer = setTimeout(() => { if (!active.applying) active.controller.abort(); }, this.deps.timeoutMs ?? 12 * 60_000); timer.unref();
    let writable = false;
    try {
      await this.ready;
      if (this.statusUnreadable) throw new Error(this.policyError);
      writable = true;

      this.state.running = domain; this.state.attempts[domain] = { lastAttempt: this.now().toISOString() }; await this.save();
      const result = await action(active.controller.signal, () => { active.controller.signal.throwIfAborted(); active.applying = true; clearTimeout(timer); });
      return result;
    } catch {
      this.state.attempts[domain] = { ...this.state.attempts[domain], error: active.applying ? "Mail application did not finish cleanly. Some verified pages may already be saved; inspect current collection status before retrying." : "Mail retrieval did not complete. Collector checkpoints were not advanced by this attempt; inspect source status before retrying." };
      throw new Error(this.state.attempts[domain]!.error);
    } finally {
      clearTimeout(timer); externalSignal?.removeEventListener("abort", externalAbort); this.state.running = undefined;
      try { if (writable) await this.save(); } catch { this.state.attempts[domain] = { ...this.state.attempts[domain], error: "Mail operation status could not be saved. Its result is unverified; inspect current collector state before retrying." }; throw new Error(this.state.attempts[domain]!.error); } finally { this.active = undefined; }
    }
  }
  private async unchanged(policy: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    if (JSON.stringify(await this.policy()) !== JSON.stringify(policy)) throw new Error("Mail source selection changed during retrieval.");
  }
  private async batch(account: PluginMailAccount, queries: readonly { q: string; maxResults: number }[], messageIds: readonly string[], signal: AbortSignal): Promise<PluginBatch> {
    signal.throwIfAborted();
    const batch = await this.runner({ account: account.email, linkId: account.linkId, queries, messageIds }, { signal });
    signal.throwIfAborted(); createPluginBatchTransport(batch, account.email);
    return batch;
  }
  /** Save ALL original leaves, including sources skipped by classification/manual-authority guards. */
  private async cacheBatch(batch: PluginBatch, signal: AbortSignal) {
    const cache = createMailAttachmentCache(join(this.directory, "mail-attachments"));
    const originals = new Map(batch.attachments.map(a => [JSON.stringify([a.messageId, a.attachmentId]), a]));
    for (const message of batch.messages) {
      const walk = async (part: NonNullable<RawMail["payload"]>): Promise<void> => {
        signal.throwIfAborted();
        if (part.body?.attachmentId) {
          const original = originals.get(JSON.stringify([message.id, part.body.attachmentId]));
          if (!original || typeof part.filename !== "string" || !part.mimeType) throw new Error("Original attachment evidence is incomplete.");
          const expected = { account: batch.account, messageId: message.id, attachmentId: part.body.attachmentId, filename: part.filename, mimeType: part.mimeType, size: original.size };
          await cache.save(expected, { ...expected, bytes: Buffer.from(original.data, "base64url") });
        }
        for (const child of part.parts || []) await walk(child);
      };
      await walk(message.payload!);
    }
  }
  async collectInvoices() {
    return this.run("invoices", async (signal, applying) => {
      const policy = await this.policy();
      if (policy.mode === "legacy") { applying(); return (this.deps.collectInvoices || collectInvoices)(); }
      const at = Math.floor(this.now().getTime() / 1000), makePlan = this.deps.invoicePlan || invoiceCollectionPlan;
      const plans = policy.accounts.map(a => makePlan(a.email, at)), inputs = [];
      for (let i = 0; i < policy.accounts.length; i++) {
        const account = policy.accounts[i], plan = plans[i];
        const queries = [plan.incremental, ...(plan.repair ? [plan.repair.request] : []), ...(plan.history ? [plan.history.request] : [])];
        const batch = await this.batch(account, queries.map(({ q, maxResults }) => ({ q, maxResults })), [...new Set([...plan.upgradeMessageIds, ...plan.retryMessageIds])], signal);
        inputs.push({ account, batch });
      }
      await this.unchanged(policy, signal);
      for (const input of inputs) await this.cacheBatch(input.batch, signal);
      await this.unchanged(policy, signal); applying(); await (this.deps.collectInvoices || collectInvoices)({ source: preparedPluginMailSource(inputs), plans });
    });
  }
  async collectGroceries() {
    return this.run("groceries", async (signal, applying) => {
      const policy = await this.policy();
      if (policy.mode === "legacy") { applying(); return this.deps.grocery.collect(); }
      const at = Math.floor(this.now().getTime() / 1000), plans = [], inputs = [];
      for (const account of policy.accounts) {
        const plan = await this.deps.grocery.plan(account.email, at); plans.push(plan);
        const batch = await this.batch(account, [{ q: plan.request.q, maxResults: plan.request.maxResults }], [], signal); inputs.push({ account, batch });
      }
      await this.unchanged(policy, signal);
      for (const input of inputs) await this.cacheBatch(input.batch, signal);
      await this.unchanged(policy, signal); applying(); return this.deps.grocery.collect({ source: preparedPluginMailSource(inputs), plans });
    });
  }
  async groceryStatus() {
    await this.ready; const current = await this.deps.grocery.status(), attempt = this.state.attempts.groceries;
    return { ...current, busy: !!this.active || current.busy, lastAttempt: attempt?.lastAttempt || current.lastAttempt,
      ...(attempt?.error || this.policyError ? { incomplete: true, error: "gmail-unavailable" as const } : {}) };
  }
  async importBlueCross(email: unknown, messageIds: unknown, apply: unknown, options: { signal?: AbortSignal; onApplying?: () => Promise<void> } = {}) {
    if (typeof email !== "string" || !Array.isArray(messageIds) || !messageIds.length || messageIds.length > 10 || messageIds.some(id => typeof id !== "string" || !/^[a-f0-9]{8,40}$/i.test(id)) || typeof apply !== "boolean") throw new Error("Provide an exact account and bounded source message IDs.");
    return this.run("bluecross", async (signal, applying) => {
      const policy = await this.policy();
      const beforeApply = async () => { await this.unchanged(policy, signal); await options.onApplying?.(); signal.throwIfAborted(); applying(); };
      if (policy.mode === "legacy") return (this.deps.importBlueCross || importBlueCrossMessages)(email, messageIds, apply, { signal, beforeApply });
      const account = policy.accounts.find(a => a.email === email.toLowerCase()); if (!account) throw new Error("Source account is not configured for the Gmail plugin.");
      const batch = await this.batch(account, [], messageIds, signal); await this.unchanged(policy, signal); await this.cacheBatch(batch, signal); await this.unchanged(policy, signal);
      return (this.deps.importBlueCross || importBlueCrossMessages)(email, messageIds, apply, { source: preparedPluginMailSource([{ account, batch }]), signal, beforeApply });
    }, options.signal);
  }
  async attachment(expected: MailAttachmentSource, options: { signal?: AbortSignal; cacheOnly?: boolean } = {}): Promise<Buffer | undefined> {
    options.signal?.throwIfAborted(); await this.ready;
    const cache = createMailAttachmentCache(join(this.directory, "mail-attachments"));
    try { const bytes = await cache.readSource(expected); options.signal?.throwIfAborted(); return bytes; } catch { /* Missing/corrupt original can only be retrieved from its exact configured source. */ }
    options.signal?.throwIfAborted(); const policy = await this.policy();
    if (policy.mode === "legacy") return undefined;
    const account = policy.accounts.find(a => a.email === expected.account); if (!account) throw new Error("Source account is not configured for the Gmail plugin.");
    if (options.cacheOnly) throw new OriginalPreparationRequiredError();
    return this.run("attachment", async (signal, applying) => {
      await this.unchanged(policy, signal);
      const bytes = await this.originalRunner({ account: account.email, linkId: account.linkId, expected }, { signal });
      await this.unchanged(policy, signal); await cache.save(expected, { ...expected, bytes }); await this.unchanged(policy, signal); applying();
      return cache.readSource(expected);
    }, options.signal);
  }
}
