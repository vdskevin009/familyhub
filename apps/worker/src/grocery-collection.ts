import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { credentials, accessToken, gmail, type RawMail } from "./gmail-client.js";
import { atomicJson } from "./private-store.js";
import { validateReceipt } from "./grocery-model.js";
import { validateSource } from "./grocery-store.js";
import { parsePcExpressMail, PC_EXPRESS_GMAIL_QUERY, type PcExpressMessage } from "./pc-express-mail.js";

type Counts = { examined: number; imported: number; unchanged: number; conflicts: number };
type Window = { after: number; before: number; page?: string };
type Failure = "setup-required" | "authorization-unavailable" | "gmail-unavailable" | "source-review-required" | "invalid-page" | "storage-limit" | "store-unavailable" | "review-required";
type AccountState = { through?: number; window?: Window; lastAttempt?: string; lastSuccess?: string; error?: Failure;
  pending: PcExpressMessage[]; seen: Record<string, number>; counts: Counts };
type CollectionState = { schema: 1; accounts: Record<string, AccountState>; activeAccounts: string[];
  lastAttempt?: string; lastSuccess?: string; lastImportedAt?: string; error?: Failure };
export type GroceryCollectionStatus = { busy: boolean; incomplete: boolean; lastAttempt?: string; lastSuccess?: string; lastImportedAt?: string; error?: Failure;
  counts: Counts; accounts: Array<{ account: string; active: boolean; lastAttempt?: string; lastSuccess?: string; error?: Failure;
    through?: number; window?: { after: number; before: number }; pendingOrders: number; pendingMessages: number; counts: Counts }> };
export type GroceryCollectionStore = { importDeliveredConfirmation(messages: PcExpressMessage[]): Promise<{ outcome: "imported" | "unchanged" | "conflict" }> };
type Dependencies = { credentials: typeof credentials; accessToken: typeof accessToken; gmail: typeof gmail;
  parse: typeof parsePcExpressMail; now: () => Date; write: typeof atomicJson; maxPages: number; pageSize: number; maxPendingMessages: number };
const day = 86_400;
const maxAccounts = 16, maxSeen = 4000, maxPendingBytes = 20_000_000;
const maxStateBytes = 32_000_000;
const failures: Failure[] = ["setup-required", "authorization-unavailable", "gmail-unavailable", "source-review-required", "invalid-page", "storage-limit", "store-unavailable", "review-required"];
const counts = (): Counts => ({ examined: 0, imported: 0, unchanged: 0, conflicts: 0 });
const initial = (): CollectionState => ({ schema: 1, accounts: {}, activeAccounts: [] });
const initialAccount = (): AccountState => ({ pending: [], seen: {}, counts: counts() });
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const stamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const epoch = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const identity = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
class CollectionFailure extends Error { constructor(readonly code: Failure) { super(code); } }

/** Independent Gmail coverage and pending evidence; never reads or edits the invoice ledger. */
export class GroceryCollection {
  private busy = false;
  private runtimeError?: Failure;
  private runtimeAttempt?: string;
  private path: string;
  private dependencies: Dependencies;
  constructor(directory: string, private store: GroceryCollectionStore, overrides: Partial<Dependencies> = {}) {
    this.path = join(directory, "collection-status.json");
    this.dependencies = { credentials, accessToken, gmail, parse: parsePcExpressMail, now: () => new Date(), write: atomicJson,
      maxPages: 2, pageSize: 50, maxPendingMessages: 1000, ...overrides };
    const write = this.dependencies.write;
    this.dependencies.write = async (path, state) => {
      if (Buffer.byteLength(JSON.stringify(state)) > maxStateBytes) throw new CollectionFailure("storage-limit");
      await write(path, state);
    };
    if (!Number.isInteger(this.dependencies.maxPages) || this.dependencies.maxPages < 1 || this.dependencies.maxPages > 20
      || !Number.isInteger(this.dependencies.pageSize) || this.dependencies.pageSize < 1 || this.dependencies.pageSize > 50
      || !Number.isInteger(this.dependencies.maxPendingMessages) || this.dependencies.maxPendingMessages < 1 || this.dependencies.maxPendingMessages > 1000) throw new Error("Invalid grocery collection limits.");
  }
  private async read(): Promise<CollectionState> {
    try {
      const raw = await readFile(this.path, "utf8");
      if (Buffer.byteLength(raw) > maxStateBytes) throw new Error();
      const state: CollectionState = JSON.parse(raw);
      if (state.schema !== 1 || !object(state.accounts) || Object.keys(state.accounts).length > maxAccounts || !Array.isArray(state.activeAccounts)
        || state.activeAccounts.some(key => typeof key !== "string" || !Object.hasOwn(state.accounts, key))
        || new Set(state.activeAccounts).size !== state.activeAccounts.length) throw new Error();
      for (const key of ["lastAttempt", "lastSuccess", "lastImportedAt"] as const) if (state[key] !== undefined && !stamp(state[key])) throw new Error();
      if (state.error !== undefined && !failures.includes(state.error)) throw new Error();
      for (const [account, value] of Object.entries(state.accounts)) {
        if (!account || account.length > 320 || account !== account.toLowerCase() || !object(value) || !Array.isArray(value.pending)
          || value.pending.length > 1000 || !object(value.seen) || Object.keys(value.seen).length > maxSeen || !object(value.counts)) throw new Error();
        for (const count of Object.keys(counts()) as Array<keyof Counts>) if (!epoch(value.counts[count])) throw new Error();
        for (const key of ["lastAttempt", "lastSuccess"] as const) if (value[key] !== undefined && !stamp(value[key])) throw new Error();
        if (value.through !== undefined && !epoch(value.through) || value.error !== undefined && !failures.includes(value.error)) throw new Error();
        if (value.window && (!epoch(value.window.after) || !epoch(value.window.before) || value.window.after >= value.window.before
          || value.window.page !== undefined && (typeof value.window.page !== "string" || !value.window.page || value.window.page.length > 4096))) throw new Error();
        for (const [id, received] of Object.entries(value.seen)) if (!identity(id) || !epoch(received)) throw new Error();
        if (new Set(value.pending.map(message => message.messageId)).size !== value.pending.length) throw new Error();
        for (const message of value.pending) this.validateMessage(message, account);
        if (Buffer.byteLength(JSON.stringify(value.pending)) > maxPendingBytes) throw new Error();
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return initial();
      throw new Error("Grocery collection state is unreadable; it was preserved.");
    }
  }
  private validateMessage(message: PcExpressMessage, account: string) {
    if (!object(message) || message.accountId !== account || !identity(message.messageId) || !stamp(message.receivedAt)
      || typeof message.orderId !== "string" || !/^\d{15}$/.test(message.orderId) || !["confirmation", "delivered"].includes(message.kind)) throw new Error();
    const source = validateSource(message.source);
    if (source.hash !== message.source.hash) throw new Error();
    if (message.kind === "confirmation") {
      const receipt = validateReceipt(message.receipt);
      if (receipt.sourceType !== "confirmation" || receipt.reference !== message.orderId) throw new Error();
    } else if (message.receipt !== undefined) throw new Error();
  }
  private project(state: CollectionState): GroceryCollectionStatus {
    const accounts = Object.entries(state.accounts).map(([account, value]) => ({ account, active: state.activeAccounts.includes(account),
      lastAttempt: value.lastAttempt, lastSuccess: value.lastSuccess, error: value.error, through: value.through,
      window: value.window ? { after: value.window.after, before: value.window.before } : undefined,
      pendingOrders: new Set(value.pending.map(message => message.orderId)).size, pendingMessages: value.pending.length, counts: { ...value.counts } }));
    const active = accounts.filter(account => account.active), total = counts();
    for (const account of active) for (const key of Object.keys(total) as Array<keyof Counts>) total[key] += account.counts[key];
    return { busy: this.busy, incomplete: Boolean(this.runtimeError || state.error || active.some(account => account.error || account.window)),
      lastAttempt: this.runtimeAttempt || state.lastAttempt, lastSuccess: state.lastSuccess, lastImportedAt: state.lastImportedAt,
      error: this.runtimeError || state.error, counts: total, accounts };
  }
  /** Read only: does not initialize a file, refresh credentials, or retry collection. */
  async status(): Promise<GroceryCollectionStatus> { return this.project(await this.read()); }
  /** Cross-domain concurrency checks must not depend on reading the Courses store. */
  isBusy(): boolean { return this.busy; }
  async collect(): Promise<GroceryCollectionStatus> {
    if (this.busy) throw new Error("Grocery collection already running.");
    this.busy = true;
    try {
      this.runtimeError = undefined; this.runtimeAttempt = this.dependencies.now().toISOString();
      const state = await this.read(), deps = this.dependencies;
      state.lastAttempt = this.runtimeAttempt; state.error = undefined;
      let accounts: Awaited<ReturnType<typeof credentials>>["accounts"];
      try {
        accounts = (await deps.credentials()).accounts;
        if (!Array.isArray(accounts) || !accounts.length || accounts.length > maxAccounts
          || accounts.some(account => typeof account.email !== "string" || !account.email.trim() || account.email.length > 320)
          || new Set(accounts.map(account => account.email.trim().toLowerCase())).size !== accounts.length) throw new Error();
      } catch { state.error = "setup-required"; await deps.write(this.path, state); return { ...this.project(state), busy: false }; }
      const activeAccounts = accounts.map(account => account.email.trim().toLowerCase());
      if (new Set([...Object.keys(state.accounts), ...activeAccounts]).size > maxAccounts) throw new Error("Grocery account limit reached; existing evidence was preserved.");
      state.activeAccounts = activeAccounts;
      for (const key of activeAccounts) { state.accounts[key] ||= initialAccount(); state.accounts[key].counts = counts(); }
      await deps.write(this.path, state);
      for (const account of accounts) {
        const key = account.email.trim().toLowerCase(), progress = state.accounts[key];
        progress.lastAttempt = deps.now().toISOString(); progress.error = undefined;
        try {
          let token: string;
          try { token = await deps.accessToken(account); } catch { throw new CollectionFailure("authorization-unavailable"); }
          let tokenAt = deps.now().getTime();
          const call = async <T>(path: string): Promise<T> => {
            if (deps.now().getTime() - tokenAt > 50 * 60_000) {
              try { token = await deps.accessToken(account); tokenAt = deps.now().getTime(); } catch { throw new CollectionFailure("authorization-unavailable"); }
            }
            try { return await deps.gmail<T>(token, path); } catch { throw new CollectionFailure("gmail-unavailable"); }
          };
          if (!progress.window) {
            const before = Math.floor(deps.now().getTime() / 1000);
            progress.window = { after: Math.max(0, progress.through === undefined ? before - 30 * day : progress.through - 2 * day), before };
            await deps.write(this.path, state);
          }
          const window = progress.window;
          const pageTokens = new Set<string>();
          for (let page = 0; page < deps.maxPages; page++) {
            if (pageTokens.has(window.page || "")) throw new CollectionFailure("invalid-page");
            pageTokens.add(window.page || "");
            const query = `${PC_EXPRESS_GMAIL_QUERY} after:${window.after} before:${window.before} -in:sent -in:drafts -in:spam -in:trash`;
            const params = new URLSearchParams({ q: query, maxResults: String(deps.pageSize), ...(window.page ? { pageToken: window.page } : {}) });
            const list = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(`messages?${params}`);
            if (!object(list) || list.messages !== undefined && (!Array.isArray(list.messages) || list.messages.length > deps.pageSize || list.messages.some(message => !object(message) || !identity(message.id)))
              || list.nextPageToken !== undefined && (typeof list.nextPageToken !== "string" || !list.nextPageToken || list.nextPageToken.length > 4096 || list.nextPageToken === window.page)) throw new CollectionFailure("invalid-page");
            // Stage the entire page. A failed message leaves its page cursor and pending evidence unchanged.
            const pending = [...progress.pending], seen = { ...progress.seen };
            for (const { id } of list.messages || []) {
              if (Object.hasOwn(seen, id)) continue;
              const raw = await call<RawMail>(`messages/${encodeURIComponent(id)}?format=full`);
              if (raw.id !== id) throw new CollectionFailure("invalid-page");
              let message: PcExpressMessage | null;
              try { message = deps.parse(raw, key); if (message) { this.validateMessage(message, key); if (message.messageId !== id) throw new Error(); } }
              catch { throw new CollectionFailure("source-review-required"); }
              if (message) pending.push(message);
              seen[id] = window.before;
            }
            const retainedIds = new Set(pending.map(message => message.messageId));
            for (const [id, at] of Object.entries(seen)) if (at < window.before - 45 * day && !retainedIds.has(id)) delete seen[id];
            if (pending.length > deps.maxPendingMessages || Object.keys(seen).length > maxSeen || Buffer.byteLength(JSON.stringify(pending)) > maxPendingBytes) throw new CollectionFailure("storage-limit");
            const checkpoint = structuredClone(progress);
            progress.pending = pending; progress.seen = seen; progress.counts.examined += list.messages?.length || 0;
            if (list.nextPageToken) window.page = list.nextPageToken;
            else { progress.through = window.before; progress.window = undefined; }
            try { await deps.write(this.path, state); }
            catch (error) { Object.assign(progress, checkpoint); progress.through = checkpoint.through; progress.window = checkpoint.window; throw error instanceof CollectionFailure ? error : new CollectionFailure("store-unavailable"); }
            if (!list.nextPageToken) break;
          }
          // Never apply a pair until every page of its frozen coverage window has been processed.
          if (!progress.window) {
            for (const orderId of new Set(progress.pending.map(message => message.orderId))) {
              const messages = progress.pending.filter(message => message.orderId === orderId);
              if (!messages.some(message => message.kind === "confirmation") || !messages.some(message => message.kind === "delivered")) continue;
              if (messages.length !== 2 || messages.filter(message => message.kind === "confirmation").length !== 1
                || messages.find(message => message.kind === "delivered")!.receivedAt < messages.find(message => message.kind === "confirmation")!.receivedAt) {
                progress.counts.conflicts++; progress.error = "review-required";
                await deps.write(this.path, state); continue;
              }
              const checkpoint = structuredClone(progress), lastImportedAt = state.lastImportedAt;
              let result: Awaited<ReturnType<GroceryCollectionStore["importDeliveredConfirmation"]>>;
              try { result = await this.store.importDeliveredConfirmation(messages); } catch { throw new CollectionFailure("store-unavailable"); }
              if (!["imported", "unchanged", "conflict"].includes(result?.outcome)) throw new CollectionFailure("store-unavailable");
              if (result.outcome === "conflict") { progress.counts.conflicts++; progress.error = "review-required"; }
              else {
                progress.counts[result.outcome]++;
                if (result.outcome === "imported") state.lastImportedAt = deps.now().toISOString();
                progress.pending = progress.pending.filter(message => message.orderId !== orderId);
              }
              // If this write fails after import, the saved pending pair safely retries through store deduplication.
              try { await deps.write(this.path, state); }
              catch (error) { Object.assign(progress, checkpoint); state.lastImportedAt = lastImportedAt; throw error instanceof CollectionFailure ? error : new CollectionFailure("store-unavailable"); }
            }
            if (!progress.error) progress.lastSuccess = deps.now().toISOString();
          }
        } catch (error) { progress.error = error instanceof CollectionFailure ? error.code : "store-unavailable"; }
        await deps.write(this.path, state);
      }
      if (activeAccounts.every(key => !state.accounts[key].window && !state.accounts[key].error)) state.lastSuccess = deps.now().toISOString();
      await deps.write(this.path, state);
      return { ...this.project(state), busy: false };
    } catch (error) {
      this.runtimeError = error instanceof CollectionFailure ? error.code : "store-unavailable";
      throw new Error("Grocery collection could not complete; previous state was preserved.");
    } finally { this.busy = false; }
  }
}
