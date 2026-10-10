import { automaticInsurerPaymentsEnabled, automaticInsurerCollectionRequested } from "./insurer-payment-intake.js";
import { hasPortalCredentials } from "./portal-login.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import { SavingsResearch, codexSavingsRunner } from "./savings-research.js";
import { SavingsLibrary, SavingsConflict } from "./savings-library.js";
import { FinanceLibrary, FinanceConflict } from "./finance-library.js";
import { GroceryStore, GroceryConflict } from "./grocery-store.js";
import { GroceryError } from "./grocery-model.js";
import { extractGrocery } from "./grocery-extraction.js";
import { GroceryPlanningStore } from "./grocery-planning-store.js";
import { GroceryResearch } from "./grocery-research.js";
import { importConnectorMessage, claimPreparation } from "./invoices.js";
import { parseLoginRecoveryRequest } from "./portal-login-recovery.js";
import { portalReconnectStatus, startPortalReconnect } from "./portal-reconnect.js";
import { openClaimBrowser, inspectClaimStep, fillClaimStep, claimSessionExpense, closeClaimBrowser } from "./claim-browser.js";
import { initializeInvoices, initializeBlueCrossStatus, getBlueCrossStatus, syncBlueCrossPortal, initializeDesjardinsStatus, getDesjardinsStatus, syncDesjardinsPortal, backfillDesjardinsPayments, invoiceSnapshot, collectInvoices, correctInvoice, updateInvoiceStatus, undoInvoiceDecision, invoiceAttachment, importBlueCrossMessages, setDocumentsIgnored, setExpenseIgnored, setManualMatch, setMatchDecision, setReimbursementWorkflowStatus, setUnmatchedIgnored } from "./invoices.js";

type WorkerTaskType = "general" | "meal-plan" | "research" | "financial-review" | "admin-classify";
type WorkerTask = {
  id: string;
  type: WorkerTaskType;
  status: "queued" | "running" | "complete" | "failed";
  prompt: string;
  result?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
};
type ResearchWatch = {
  Id: string;
  Query: string;
  TargetPrice?: number | null;
  Sources: string;
  Auto: boolean;
  CadenceHours: number;
  LastRunAt?: string;
  LastResult?: string;
  LastResultAt?: string;
};
type PersistedState = { watches: ResearchWatch[] };

const version = "2.23.5";
const host = process.env.FAMILYHUB_WORKER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.FAMILYHUB_WORKER_PORT || "4713");
const stateDir = process.env.FAMILYHUB_WORKER_DATA?.trim() || join(homedir(), ".familyhub-worker");
const keyPath = join(stateDir, "pairing-key.txt");
const statePath = join(stateDir, "state.json");
const allowedOrigins = new Set(
  (process.env.FAMILYHUB_ALLOWED_ORIGINS ||
    "https://vdskevin009.github.io,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);

const tasks = new Map<string, WorkerTask>();
const codex = new Codex({ codexPathOverride: process.env.FAMILYHUB_CODEX_PATH || undefined });
const savingsDirectory = join(stateDir, "savings");
const savingsLibrary = new SavingsLibrary(join(savingsDirectory, "household-contracts.json"));
const financeLibrary = new FinanceLibrary(join(stateDir, "finances"));
const groceryStore = new GroceryStore(join(stateDir, "groceries"), extractGrocery);
const groceryPlanning = new GroceryPlanningStore(join(stateDir, "groceries"));
const groceryResearch = new GroceryResearch(join(stateDir, "groceries"));
const researchDirectory = join(savingsDirectory, "public-research");
const savingsResearch = new SavingsResearch(join(savingsDirectory, "jobs"), codexSavingsRunner(codex, researchDirectory));
let pairingKey = "";
let persisted: PersistedState = { watches: [] };
let schedulerBusy = false;

async function ensureState(): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  try {
    pairingKey = (await readFile(keyPath, "utf8")).trim();
  } catch {
    pairingKey = randomBytes(32).toString("base64url");
    await writeFile(keyPath, pairingKey + "\n", { encoding: "utf8", mode: 0o600 });
  }
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<PersistedState>;
    persisted = { watches: Array.isArray(parsed.watches) ? parsed.watches : [] };
  } catch {
    await saveState();
  }
}

async function saveState(): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(persisted, null, 2), "utf8");
}

function json(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  if (origin && allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function isAuthorized(request: IncomingMessage): boolean {
  const supplied = request.headers["x-familyhub-key"];
  if (typeof supplied !== "string" || !pairingKey) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(pairingKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson<T>(request: IncomingMessage, maxBytes = 100_000): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

async function runCodex(prompt: string): Promise<string> {
  const thread = codex.startThread({ sandboxMode: "read-only", approvalPolicy: "never", skipGitRepoCheck: true });
  const result = await thread.run(prompt);
  return result.finalResponse?.trim() || "Codex completed the task without a text response.";
}

function normalizeTaskType(value: unknown): WorkerTaskType {
  return value === "meal-plan" || value === "research" || value === "financial-review" || value === "admin-classify"
    ? value
    : "general";
}

async function executeTask(task: WorkerTask): Promise<void> {
  task.status = "running";
  try {
    const guardrail = [
      "You are running as the private FamilyHub local worker.",
      "Be concise, practical and transparent about uncertainty.",
      "Never claim you completed an external action unless the prompt includes evidence that it actually completed.",
      "Do not invent current prices, listings, emails, files, bank data or web results.",
      "If a requested capability is unavailable in this local Codex environment, say so clearly."
    ].join("\n");
    task.result = await runCodex(guardrail + "\n\nTASK TYPE: " + task.type + "\n\n" + task.prompt);
    task.status = "complete";
  } catch (error) {
    task.status = "failed";
    task.error = error instanceof Error ? error.message : "Unknown Codex worker error.";
  } finally {
    task.completedAt = new Date().toISOString();
  }
}

function watchPrompt(watch: ResearchWatch): string {
  const target = watch.TargetPrice == null ? "No target price was set." : "Target price: CAD " + watch.TargetPrice.toFixed(2) + ".";
  return [
    "Research this saved FamilyHub opportunity watch.",
    "Query: " + watch.Query,
    target,
    "Requested sources or constraints: " + (watch.Sources || "Web"),
    "Use only web/network capabilities actually available to this local Codex session.",
    "Return a short dated summary with concrete leads and source names/URLs when verifiable.",
    "If you cannot access a requested source or live data, state that instead of guessing.",
    "Do not purchase, message sellers, sign in to services, or submit forms."
  ].join("\n");
}

async function executeWatch(watch: ResearchWatch): Promise<{ result: string; completedAt: string }> {
  const result = await runCodex(watchPrompt(watch));
  const completedAt = new Date().toISOString();
  watch.LastRunAt = completedAt;
  watch.LastResultAt = completedAt;
  watch.LastResult = result;
  await saveState();
  return { result, completedAt };
}

async function runDueWatches(): Promise<void> {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const now = Date.now();
    for (const watch of persisted.watches) {
      if (!watch.Auto) continue;
      const cadenceMs = Math.max(1, watch.CadenceHours || 24) * 3_600_000;
      const last = watch.LastRunAt ? Date.parse(watch.LastRunAt) : 0;
      if (!last || now - last >= cadenceMs) {
        try { await executeWatch(watch); }
        catch (error) {
          console.error("Automatic watch failed:", watch.Query, error);
          watch.LastRunAt = new Date().toISOString();
          await saveState();
        }
      }
    }
  } finally {
    schedulerBusy = false;
  }
}

function pathParts(urlValue: string | undefined): string[] {
  const url = new URL(urlValue || "/", "http://familyhub.local");
  return url.pathname.split("/").filter(Boolean);
}

const server = createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
  if (request.method === "OPTIONS") {
    if (origin && allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "content-type,x-familyhub-key");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.statusCode = 204;
    response.end();
    return;
  }

  if (origin && !allowedOrigins.has(origin)) {
    json(response, 403, { error: "Origin is not allowed." });
    return;
  }
  if (!isAuthorized(request)) {
    json(response, 401, { error: "Invalid FamilyHub pairing key." }, origin);
    return;
  }

  const parts = pathParts(request.url);
  try {
    if (parts[0] === "groceries") {
      if (parts.length === 2 && parts[1] === "research" && request.method === "POST") { json(response, 200, await groceryResearch.run(await readJson(request)), origin); return; }
      if (parts.length === 1 && request.method === "GET") { json(response, 200, await groceryStore.list(), origin); return; }
      if (parts.length === 2 && parts[1] === "planning") {
        if (request.method === "GET") { json(response, 200, await groceryPlanning.read(), origin); return; }
        if (request.method === "POST") { json(response, 200, await groceryPlanning.save(await readJson(request)), origin); return; }
      }
      if (parts.length === 2 && parts[1] === "import" && request.method === "POST") { json(response, 200, await groceryStore.import(await readJson(request, 30_000_000)), origin); return; }
      if (parts.length === 3 && request.method === "POST") {
        const body = await readJson(request) as Record<string, unknown>;
        if (parts[2] === "review") { json(response, 200, await groceryStore.review(parts[1], body), origin); return; }
        if (parts[2] === "extract") { json(response, 200, await groceryStore.extract(parts[1], body), origin); return; }
        if (parts[2] === "duplicate") { json(response, 200, await groceryStore.linkDuplicate(parts[1], body), origin); return; }
      }
      if (parts.length === 4 && parts[2] === "sources" && request.method === "GET") { const source = await groceryStore.source(parts[1], parts[3]); if (!source) { json(response, 404, { error: "Source introuvable." }, origin); return; } json(response, 200, source, origin); return; }
    }
    if (parts[0] === "finances") {
      if (parts.length === 1 && request.method === "GET") { json(response, 200, await financeLibrary.read(), origin); return; }
      if (parts.length === 2 && parts[1] === "import" && request.method === "POST") { json(response, 200, await financeLibrary.import(await readJson(request, 20_000_000)), origin); return; }
      if (parts.length === 2 && parts[1] === "decision" && request.method === "POST") { json(response, 200, await financeLibrary.decide(await readJson(request)), origin); return; }
    }
    if (parts[0] === "savings" && parts[1] === "contracts") {
      if (parts.length === 2 && request.method === "GET") { json(response, 200, await savingsLibrary.list(), origin); return; }
      if (parts.length === 3 && parts[2] === "import" && request.method === "POST") { json(response, 200, await savingsLibrary.import(await readJson(request, 30_000_000)), origin); return; }
      if (parts.length === 3 && request.method === "POST") { json(response, 200, await savingsLibrary.update(parts[2], await readJson(request, 30_000_000)), origin); return; }
    }
    if (parts[0] === "savings" && parts[1] === "documents" && parts.length === 3 && request.method === "GET") {
      const document = await savingsLibrary.document(parts[2]);
      json(response, document ? 200 : 404, document ?? { error: "Shared Savings document not found." }, origin); return;
    }
    if (parts[0] === "savings" && parts[1] === "research") {
      if (parts.length === 2 && request.method === "GET") {
        const load = async (name: string) => {
          try { return JSON.parse(await readFile(join(savingsDirectory, name), "utf8")); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; return { outcome: "status-unavailable" }; }
        };
        json(response, 200, { jobs: savingsResearch.latest(), schedule: await load("schedule.json"), daily: await load("daily-status.json") }, origin); return;
      }
      if (parts.length === 3 && parts[2] === "daily" && request.method === "POST") {
        const body = await readJson<{ contractId?: unknown }>(request);
        const contract = (await savingsLibrary.list()).records.find(record => record.contract.id === body.contractId)?.contract;
        if (!contract) throw new Error("Share this contract with the paired PC before daily research.");
        if ((await invoiceSnapshot()).busy || [getBlueCrossStatus(), getDesjardinsStatus()].some(status => status.state === "syncing") || ["bluecross", "desjardins"].some(name => portalReconnectStatus(name as "bluecross" | "desjardins")?.state === "running")) throw new Error("The PC is collecting documents. Research was not started.");
        const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        json(response, 202, await savingsResearch.startDaily(contract, date), origin); return;
      }
      if (parts.length === 2 && request.method === "POST") {
        json(response, 202, await savingsResearch.start(await readJson(request)), origin); return;
      }
      if (parts.length === 3 && request.method === "GET") {
        const job = savingsResearch.get(parts[2]);
        json(response, job ? 200 : 404, job || { error: "Savings comparison not found on this PC." }, origin); return;
      }
    }
    if (parts[0] === "claim-preparation" && request.method === "POST" && parts.length === 2) {
      const body = await readJson<{ expenseId?: unknown; insurer?: unknown; historyReviewed?: unknown; warningsReviewed?: unknown; sessionId?: unknown; revision?: unknown; values?: unknown; attachment?: unknown; uploadConfirmed?: unknown }>(request);
      if (parts[1] === "preview") { json(response, 200, claimPreparation(body.expenseId, body.insurer), origin); return; }
      if (parts[1] === "open") { json(response, 200, await openClaimBrowser(claimPreparation(body.expenseId, body.insurer), body.historyReviewed, body.warningsReviewed), origin); return; }
      if (parts[1] === "inspect") { json(response, 200, await inspectClaimStep(body.sessionId), origin); return; }
      if (parts[1] === "close") { json(response, 200, await closeClaimBrowser(body.sessionId), origin); return; }
      if (parts[1] === "fill") {
        const previous = claimSessionExpense(body.sessionId);
        const fresh = claimPreparation(previous.expenseId, previous.insurer);
        if (fresh.blocked || JSON.stringify(fresh.fields) !== JSON.stringify(previous.fields) || JSON.stringify(fresh.conflicts) !== JSON.stringify(previous.conflicts)) throw new Error("The invoice or duplicate evidence changed. Prepare the claim again.");
        if (body.attachment != null && previous.insurer === "blue-cross" && body.uploadConfirmed !== true) throw new Error("Confirm uploading this original PDF to the permanent Blue Cross claims record.");
        json(response, 200, await fillClaimStep(body.sessionId, body.revision, body.values, body.attachment, invoiceAttachment), origin); return;
      }
      throw new Error("Unknown preparation action. Submission is not supported.");
    }
    if ((parts[0] === "desjardins" || parts[0] === "bluecross") && parts[1] === "recover-login" && parts.length === 2) {
      const insurer = parts[0];
      if (request.method === "GET") { json(response, 200, portalReconnectStatus(insurer) ?? { state: "idle" }, origin); return; }
      if (request.method === "POST") {
        const recovery = parseLoginRecoveryRequest(await readJson(request));
        if (getBlueCrossStatus().state === "syncing" || getDesjardinsStatus().state === "syncing") throw new Error("An insurer collection is already running.");
        const autoImportNew = await automaticInsurerPaymentsEnabled();
        json(response, 202, startPortalReconnect(insurer, () => insurer === "desjardins"
          ? syncDesjardinsPortal(false, false, undefined, autoImportNew, recovery)
          : syncBlueCrossPortal(false, false, undefined, autoImportNew, recovery)), origin); return;
      }
    }
    if ((parts[0] === "desjardins" || parts[0] === "bluecross") && parts[1] === "reconnect" && parts.length === 2) {
      const insurer = parts[0];
      if (request.method === "GET") {
        json(response, 200, portalReconnectStatus(insurer) ?? { state: "idle" }, origin); return;
      }
      if (request.method === "POST") {
        const body = await readJson<{ interactive?: unknown }>(request);
        if (body.interactive !== true) throw new Error("Confirm opening the insurer sign-in window on the PC.");
        if (getBlueCrossStatus().state === "syncing" || getDesjardinsStatus().state === "syncing")
          throw new Error("An insurer collection is already running.");
        const autoImportNew = await automaticInsurerPaymentsEnabled();
        json(response, 202, startPortalReconnect(insurer, () => insurer === "desjardins"
          ? syncDesjardinsPortal(false, true, undefined, autoImportNew) : syncBlueCrossPortal(false, true, undefined, autoImportNew)), origin); return;
      }
    }
    if (parts[0] === "desjardins" && parts[1] === "status" && parts.length === 2 && request.method === "GET") {
      const { previewSnapshot: _previewSnapshot, ...status } = getDesjardinsStatus();
      json(response, 200, { ...status, loginConfigured: await hasPortalCredentials("desjardins"), autoImportNewPaymentsEnabled: await automaticInsurerPaymentsEnabled() }, origin); return;
    }
    if (parts[0] === "desjardins" && parts[1] === "sync" && parts.length === 2 && request.method === "POST") {
      const body = await readJson<{ apply?: unknown; autoImportNewPayments?: unknown }>(request);
      if (typeof body.apply !== "boolean") throw new Error("Provide a boolean apply flag.");
      const autoImportNew = await automaticInsurerCollectionRequested(body.apply, body.autoImportNewPayments);
      const result = await syncDesjardinsPortal(body.apply, false, undefined, autoImportNew);
      if (result.status === "login-required") { json(response, 200, result, origin); return; }
      const { snapshotPath: _snapshotPath, backup: _backup, ...publicResult } = result;
      json(response, 200, publicResult, origin); return;
    }
    if (parts[0] === "desjardins" && parts[1] === "backfill" && parts.length === 2 && request.method === "POST") {
      const body = await readJson<{ evidence?: unknown; apply?: unknown }>(request);
      const { backup: _backup, ...result } = await backfillDesjardinsPayments(body.evidence, body.apply);
      json(response, 200, result, origin); return;
    }
    if (parts[0] === "bluecross" && parts[1] === "status" && parts.length === 2 && request.method === "GET") {
      json(response, 200, { ...getBlueCrossStatus(), loginConfigured: await hasPortalCredentials("bluecross"), autoImportNewPaymentsEnabled: await automaticInsurerPaymentsEnabled() }, origin); return;
    }
    if (parts[0] === "bluecross" && parts[1] === "sync" && parts.length === 2 && request.method === "POST") {
      const body = await readJson<{ apply?: unknown; autoImportNewPayments?: unknown }>(request);
      if (typeof body.apply !== "boolean") throw new Error("Provide a boolean apply flag.");
      const autoImportNew = await automaticInsurerCollectionRequested(body.apply, body.autoImportNewPayments);
      const result = await syncBlueCrossPortal(body.apply, false, undefined, autoImportNew);
      // Private snapshot and backup paths are intentionally never sent to the PWA.
      if (result.status === "login-required") { json(response, 200, result, origin); return; }
      const { snapshotPath: _snapshotPath, backup: _backup, ...publicResult } = result;
      json(response, 200, publicResult, origin); return;
    }
    if (parts[0] === "invoices") {
      if (request.method === "POST" && parts.length === 2 && parts[1] === "import-connector") {
        const body = await readJson<{ message?: unknown; apply?: unknown }>(request, 28_000_000);
        json(response, 200, await importConnectorMessage(body.message, body.apply), origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "documents" && parts[2] === "ignore") {
        const body = await readJson<{ documentIds?: unknown; ignored?: unknown }>(request);
        await setDocumentsIgnored(body.documentIds, body.ignored);
        json(response, 200, { saved: true }, origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "expenses" && parts[2] === "ignore") {
        const body = await readJson<{ documentIds?: unknown; ignored?: unknown }>(request);
        await setExpenseIgnored(body.documentIds, body.ignored);
        json(response, 200, { saved: true }, origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "matches" && parts[2] === "decision") {
        const body = await readJson<{ reimbursementId?: unknown; expenseId?: unknown; decision?: unknown }>(request);
        await setMatchDecision(body.reimbursementId, body.expenseId, body.decision);
        json(response, 200, { saved: true }, origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "matches" && parts[2] === "manual") {
        const body = await readJson<{ reimbursementId?: unknown; expenseId?: unknown; confirmedServiceDate?: unknown }>(request);
        await setManualMatch(body.reimbursementId, body.expenseId, body.confirmedServiceDate);
        json(response, 200, { saved: true }, origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "unmatched" && parts[2] === "ignore") {
        const body = await readJson<{ reimbursementId?: unknown; ignored?: unknown }>(request);
        await setUnmatchedIgnored(body.reimbursementId, body.ignored);
        json(response, 200, { saved: true }, origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "workflow" && parts[2] === "status") {
        const body = await readJson<{ expenseId?: unknown; status?: unknown }>(request);
        await setReimbursementWorkflowStatus(body.expenseId, body.status);
        json(response, 200, { saved: true }, origin); return;
      }
      if (request.method === "POST" && parts.length === 2 && parts[1] === "import-bluecross") {
        const body = await readJson<{ email?: unknown; messageIds?: unknown; apply?: unknown }>(request);
        json(response, 200, await importBlueCrossMessages(body.email, body.messageIds, body.apply ?? false), origin); return;
      }
      if (request.method === "GET" && parts.length === 1) {
        json(response, 200, await invoiceSnapshot(), origin); return;
      }
      if (request.method === "POST" && parts.length === 2 && parts[1] === "collect") {
        const snapshot = await invoiceSnapshot();
        if (snapshot.setupRequired) { json(response, 409, { error: "Connect Gmail on the PC before collecting." }, origin); return; }
        if (snapshot.busy) { json(response, 409, { error: "Collection already running." }, origin); return; }
        void collectInvoices().catch(() => { /* Error is available through the authenticated status endpoint. */ });
        json(response, 202, { status: "running" }, origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[2] === "correction") {
        const body = await readJson<{ kind?: unknown }>(request);
        json(response, 200, await correctInvoice(parts[1], body.kind), origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[2] === "status") {
        const body = await readJson<{ status?: unknown }>(request);
        json(response, 200, await updateInvoiceStatus(parts[1], body.status), origin); return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "decisions" && parts[2] === "undo") {
        const body = await readJson<{ decisionId?: string }>(request);
        json(response, 200, await undoInvoiceDecision(String(body.decisionId || "")), origin); return;
      }
      if (request.method === "GET" && parts.length === 4 && parts[2] === "attachments") {
        const file = await invoiceAttachment(parts[1], decodeURIComponent(parts[3]));
        if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin"); response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(file.name));
        response.end(file.bytes); return;
      }
    }
    if (request.method === "GET" && parts.length === 1 && parts[0] === "health") {
      json(response, 200, { status: "ok", codex: "sdk-ready", version, capabilities: ["grocery-receipts-v1", "grocery-planning-v1"] }, origin);
      return;
    }

    if (request.method === "POST" && parts.length === 1 && parts[0] === "tasks") {
      const body = await readJson<{ type?: WorkerTaskType; prompt?: string }>(request);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) throw new Error("Task prompt is required.");
      if (prompt.length > 60_000) throw new Error("Task prompt is too large.");
      const task: WorkerTask = {
        id: randomUUID(),
        type: normalizeTaskType(body.type),
        status: "queued",
        prompt,
        createdAt: new Date().toISOString()
      };
      tasks.set(task.id, task);
      void executeTask(task);
      json(response, 202, task, origin);
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "tasks") {
      const task = tasks.get(parts[1]);
      if (!task) { json(response, 404, { error: "Task not found." }, origin); return; }
      json(response, 200, task, origin);
      return;
    }

    if (request.method === "POST" && parts.length === 1 && parts[0] === "watches") {
      const watch = await readJson<ResearchWatch>(request);
      if (!watch.Id || !watch.Query?.trim()) throw new Error("Watch id and query are required.");
      const sanitized: ResearchWatch = {
        Id: String(watch.Id).slice(0, 120),
        Query: String(watch.Query).trim().slice(0, 1000),
        TargetPrice: watch.TargetPrice == null ? null : Number(watch.TargetPrice),
        Sources: String(watch.Sources || "Web").slice(0, 2000),
        Auto: Boolean(watch.Auto),
        CadenceHours: Math.max(1, Math.min(24 * 30, Number(watch.CadenceHours || 24))),
        LastRunAt: watch.LastRunAt,
        LastResult: watch.LastResult?.slice(0, 30_000),
        LastResultAt: watch.LastResultAt
      };
      const index = persisted.watches.findIndex(item => item.Id === sanitized.Id);
      if (index >= 0) persisted.watches[index] = sanitized;
      else persisted.watches.push(sanitized);
      await saveState();
      json(response, 200, sanitized, origin);
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[0] === "watches") {
      const watch = persisted.watches.find(item => item.Id === parts[1]);
      if (!watch) { json(response, 404, { error: "Watch not found." }, origin); return; }
      json(response, 200, watch, origin);
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[0] === "watches" && parts[2] === "run") {
      const watch = persisted.watches.find(item => item.Id === parts[1]);
      if (!watch) { json(response, 404, { error: "Watch not found." }, origin); return; }
      json(response, 200, await executeWatch(watch), origin);
      return;
    }

    json(response, 404, { error: "Endpoint not found." }, origin);
  } catch (error) {
    const grocery = parts[0] === "groceries";
    json(response, error instanceof SavingsConflict || error instanceof FinanceConflict || error instanceof GroceryConflict ? 409 : 400, { error: grocery && !(error instanceof GroceryError) ? "Action Courses indisponible. Les données restent conservées ; actualisez avant de réessayer." : error instanceof Error ? error.message : "Request failed." }, origin);
  }
});

await ensureState();
await mkdir(researchDirectory, { recursive: true });
await savingsResearch.initialize();
await initializeInvoices();
await initializeBlueCrossStatus();
await initializeDesjardinsStatus();
server.listen(port, host, () => {
  console.log("");
  console.log("FamilyHub local worker");
  console.log("----------------------");
  console.log("Listening: http://" + host + ":" + port);
  console.log("Pairing key stored locally at " + keyPath);
  console.log("Allowed origins: " + [...allowedOrigins].join(", "));
  console.log("");
  console.log("Keep this terminal private. The key is stored at " + keyPath);
});
setInterval(() => void runDueWatches(), 15 * 60_000);
void runDueWatches();
