import { AgentReview, CleanupSuggestion, ReconciliationCase, ReimbursementItem, ReimbursementWorkflowStatus, ResearchWatch, UnmatchedReimbursement, WorkerConfig, WorkerTask, WorkerTaskType } from "./types";
import type { PublicBaseline, SavingsJob } from "./savings";
import type { SavingsContract } from "./savings";
import type { SharedLibrary, SharedDocument } from "../../worker/src/savings-sharing-model";
export type SharedResearch = { jobs: SavingsJob[]; schedule: { enabled?: boolean; at?: string; timeZone?: string } | null; daily: { attemptedAt?: string; completedAt?: string; outcome?: string; results?: { outcome: string }[] } | null };
export function fetchSharedResearch(config: WorkerConfig): Promise<SharedResearch> { return request(config, "/savings/research"); }
export async function fetchNotifications(config: WorkerConfig): Promise<import("../../worker/src/notification-library").NotificationSnapshot> {
  const health = await testWorker(config);
  if (!workerVersionAtLeast(health.version, "2.24.0")) throw new Error("Les notifications nécessitent le worker PC 2.24.0 ou ultérieur. Les données et catégories enregistrées restent disponibles.");
  return request(config, "/notifications");
}
export const updateNotifications = (config: WorkerConfig, body: object) => request<import("../../worker/src/notification-library").NotificationSnapshot>(config, "/notifications", { method: "POST", body: JSON.stringify(body) });
export function fetchSharedSavings(config: WorkerConfig): Promise<SharedLibrary> { return request(config, "/savings/contracts"); }
export function fetchSharedSavingsDocument(config: WorkerConfig, id: string): Promise<SharedDocument> { return request(config, `/savings/documents/${encodeURIComponent(id)}`); }
async function requireInsuranceSupport(config: WorkerConfig, contracts: SavingsContract[]) {
  if (!contracts.some(c => c.insuranceReference)) return;
  const health = await request<{ capabilities?: string[] }>(config, "/health");
  if (!health.capabilities?.includes("insurance-reference-v1")) throw new Error("Mettez à jour le worker PC pour conserver le référentiel assurances. Aucun contrat n'a été modifié.");
}
export async function importSharedSavings(config: WorkerConfig, contracts: SavingsContract[], documents: SharedDocument[]): Promise<SharedLibrary> {
  await requireInsuranceSupport(config, contracts);
  return request(config, "/savings/contracts/import", { method: "POST", body: JSON.stringify({ contracts, documents }) });
}
export async function updateSharedSavings(config: WorkerConfig, contract: SavingsContract, expectedRevision: string, documents: SharedDocument[]): Promise<SharedLibrary> {
  await requireInsuranceSupport(config, [contract]);
  return request(config, `/savings/contracts/${encodeURIComponent(contract.id)}`, { method: "POST", body: JSON.stringify({ contract, expectedRevision, documents }) });
}

export async function startSavingsResearch(config: WorkerConfig, body: { contractId: string; baselineKey: string; baseline: PublicBaseline }): Promise<SavingsJob> {
  const health = await testWorker(config);
  if (!workerVersionAtLeast(health.version, "2.19.0")) throw new Error("Savings research needs PC worker 2.19.0 or later. Update and restart the existing PC worker; saved contracts remain available.");
  return request(config, "/savings/research", { method: "POST", body: JSON.stringify(body) });
}
export async function fetchSavingsResearch(config: WorkerConfig, id: string): Promise<SavingsJob> {
  return request(config, `/savings/research/${encodeURIComponent(id)}`);
}

export const manualReconciliationWorkerVersion = "2.8.0";
export const bulkDocumentWorkerVersion = "2.11.0";
export type ClaimPreparation = {
  expenseId: string; insurer: "blue-cross" | "desjardins"; portalUrl: string; blocked: boolean; submitAllowed: false;
  preparationUrl?: string;
  coordination?: { required: boolean; ready: boolean; primaryInsurer: string | null; message: string | null; importedStatementAvailable?: boolean; ownerConfirmationRevision?: number;
    ownerConfirmation?: { insurer: "desjardins" | "blue-cross"; amount: number; reason: string; at: string; revision: number; provenance: "owner-confirmed" } | null };
  fields: { patient: string | null; provider: string | null; practitioner: string | null; serviceDate: string | null; originalAmount: number | null; service: string | null; invoiceNumber: string | null; otherInsurance?: string | null; otherInsurancePaid?: number | null };
  otherInsurer?: string; currency?: string | null; reviewableWarnings?: string[];
  missing: string[]; conflicts: string[];
  attachments: { documentId: string; attachmentId: string; name: string }[];
  sourceEmails: { account: string; messageId: string }[];
  duplicate: { status: string; scope: string; checkedAt: string; records: { id: string; reference: string | null; service: string | null; status: string }[] };
};
export type ClaimStep = { status: string; revision: string; submitAllowed: false; portalStage?: "expense-summary" | "claim-kind" | "member-home";
  authReason?: string;
  confirmedPractitioner?: { scope: string; value: string | null; revision: number };
  confirmedIllness?: { scope: string; value: string | null; revision: number; source: "invoice" | "default" | null; defaultScope: string; defaultValue: string | null; defaultRevision: number }; answerWarning?: string;
  serviceChoices?: { available: boolean; scopeComplete: boolean; warning: string | null };
  fields: { key: string; label: string; type: string; kind: string | null; suggested: string | null; suggestionSource?: string; suggestionReason?: string; optional?: boolean; options: { value: string; label: string }[] }[] };
export type ClaimVerification = { revision: string; readyForManualNext: boolean; scope: string;
  preparedForReview?: boolean;
  expenseSummary?: { matches: boolean; patient: string; benefit: string; practitioner: string; service: string; date: string; amount: string; illness: string } | null;
  receiptUploadAvailable?: boolean;
  fields: { key: string; label: string; value: string; optionLabel?: string; actual: string | null; status: "match" | "mismatch" | "unreadable" | "not-filled" }[];
  attachment: { name: string; status: "verified" | "unverified" | "failed"; selected?: boolean; blocked?: boolean } | null };
export type PreparedClaim = { preparation: ClaimPreparation; sessionId?: string; step: ClaimStep; verification?: ClaimVerification; warning?: string; submitAllowed: false };
export async function claimAction<T>(config: WorkerConfig, action: "window" | "practitioner-answer" | "retry-receipt" | "invoice-answer" | "validate" | "prepare" | "resume" | "correct" | "preview" | "open" | "inspect" | "fill" | "close" | "forget-service-choices" | "suggest-service" | "verify" | "confirm-adjudication", body: object): Promise<T> {
  if (action !== "close") {
    const health = await testWorker(config);
    if (action === "practitioner-answer" && !workerVersionAtLeast(health.version, "2.26.8")) throw new Error("Invoice-specific practitioner answers need the updated PC worker.");
    if (action === "retry-receipt" && !workerVersionAtLeast(health.version, "2.26.6")) throw new Error("Receipt recovery needs the updated PC worker. Do not retry through another action.");
    if (action === "invoice-answer" && !workerVersionAtLeast(health.version, "2.26.2")) throw new Error("Saving invoice-specific answers requires PC worker 2.26.2 or later.");
    if (!workerVersionAtLeast(health.version, "2.26.0")) {
      throw new Error(`Your PC worker is ${health.version || "an older version"}. Autonomous claim preparation requires worker 2.26.0 or later. Update and restart the existing FamilyHub worker, then reopen this panel.`);
    }
  }
  // Saved-session login, dependent portal postbacks and receipt verification can
  // legitimately outlast the old three-minute client deadline. Never replay a
  // preparation request when its response is lost: the PC may still be working.
  const preparesPortal = ["prepare", "resume", "correct", "open", "fill", "retry-receipt"].includes(action);
  try {
    return await request<T>(config, `/claim-preparation/${action}`, { method: "POST", body: JSON.stringify(body) }, preparesPortal ? 15 * 60_000 : 180_000);
  } catch (error) {
    if (preparesPortal && error instanceof Error && error.message.startsWith("Cannot reach your FamilyHub PC.")) {
      throw new Error("The preparation response was not received. Your PC may still be preparing the claim or attaching its receipt. Check the existing insurer window before continuing; do not restart preparation or upload the receipt again. No final submission was requested.");
    }
    throw error;
  }
}

export function workerVersionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string) => value.split(".").map(part => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const required = parse(minimum);
  for (let index = 0; index < Math.max(current.length, required.length); index++) {
    const left = current[index] ?? 0;
    const right = required[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

async function requireManualReconciliationWorker(config: WorkerConfig): Promise<void> {
  const health = await testWorker(config);
  if (!workerVersionAtLeast(health.version, manualReconciliationWorkerVersion)) {
    throw new Error(`Your PC worker is ${health.version || "an older version"}. Manual Match / Ignore requires worker ${manualReconciliationWorkerVersion} or later. Update and restart the FamilyHub worker on the PC, then refresh.`);
  }
}

function endpoint(config: WorkerConfig, path: string): string {
  const base = config.Endpoint.trim().replace(/\/$/, "");
  if (!base) throw new Error("Configure the FamilyHub worker endpoint first.");
  return base + path;
}

function headers(config: WorkerConfig): HeadersInit {
  if (!config.ApiKey.trim()) throw new Error("Enter the worker pairing key.");
  return {
    "Content-Type": "application/json",
    "x-familyhub-key": config.ApiKey.trim()
  };
}

async function request<T>(config: WorkerConfig, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const url = endpoint(config, path);
  const requestHeaders = { ...headers(config), ...(init.headers ?? {}) };
  let response: Response;
  try { response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    ...init,
    headers: requestHeaders
  }); } catch {
    throw new Error("Cannot reach your FamilyHub PC. Check that the PC worker and HTTPS connection are running, then verify the endpoint in Other → Settings & tools → Local AI. Temporary tunnel addresses change after a restart. Saved results are still available; refresh before retrying an unconfirmed change.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw Object.assign(new Error(body.error || `Worker request failed (${response.status}).`), { status: response.status });
  }
  return await response.json() as T;
}

export const fetchFinances = (config: WorkerConfig) => request<import("../../worker/src/finance-model").FinanceState>(config,"/finances");
export async function saveFinanceChange(config: WorkerConfig, body: object) {
  try { return await request<import("../../worker/src/finance-model").FinanceChangeResult>(config, "/finances/changes", { method: "POST", body: JSON.stringify(body) }); }
  catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) throw new Error("La modification rapide nécessite le worker PC 2.25.0 ou ultérieur. Aucune décision n'a été modifiée.");
    if (status === undefined) throw new Error("Enregistrement non confirmé : connexion au PC interrompue. Votre brouillon est conservé. Réessayez la même action; elle ne sera pas appliquée deux fois.");
    throw error;
  }
}
export const saveFinanceDecision = (config: WorkerConfig, id: string, expectedRevision: string, decision: import("../../worker/src/finance-model").FinanceDecision) => request<import("../../worker/src/finance-model").FinanceState>(config,"/finances/decision",{ method:"POST",body:JSON.stringify({id,expectedRevision,decision}) });
export const importFinances = (config: WorkerConfig, bundle: unknown, expectedRevision: string, apply = false) => request<{ state?: import("../../worker/src/finance-model").FinanceState; added:number; possibleDuplicates:number; accounts?:number; from?:string; to?:string; revision?:string; alreadyImported?:boolean }>(config,"/finances/import",{ method:"POST",body:JSON.stringify({bundle,expectedRevision,apply}) },60_000);

export type BlueCrossSyncResult = { autoImported?: number; pendingNew?: number; pendingChanged?: number; status: "success" | "login-required"; applied?: boolean; found?: number; new?: number;
  changed?: number; unchanged?: number; ambiguous?: number; duplicates?: number; errors?: number; complete?: boolean;
  loginRequired?: boolean; warnings?: string[]; matched?: number; unmatched?: number };
export type BlueCrossSyncStatus = { retry?: { attempt: number; maximum: number; state: "reading" | "waiting" | "complete" | "incomplete" | "authentication-required" | "exhausted"; nextAttemptAt?: string }; autoImportNewPaymentsEnabled?: boolean; loginConfigured?: boolean; authReason?: "not-configured" | "credentials-unavailable" | "credentials-rejected" | "human-required" | "layout-changed" | "cooldown" | "profile-busy"; lastAttempt?: string; lastSuccess?: string; lastAppliedAt?: string; latestResult?: BlueCrossSyncResult; found?: number;
  state: "idle" | "syncing" | "login-required" | "error" | "up-to-date"; error?: string };
export function fetchBlueCrossStatus(config: WorkerConfig): Promise<BlueCrossSyncStatus> {
  return request(config, "/bluecross/status");
}
export function syncBlueCross(config: WorkerConfig, apply: boolean): Promise<BlueCrossSyncResult> {
  return request(config, "/bluecross/sync", { method: "POST", body: JSON.stringify({ apply }) }, 6 * 60_000);
}

export type DesjardinsSyncResult = BlueCrossSyncResult;
export type PortalReconnect = { state: "idle" | "running" | "success" | "login-required" | "error"; startedAt?: string; result?: BlueCrossSyncResult; error?: string };
export async function reconnectPortal(config: WorkerConfig, insurer: "bluecross" | "desjardins"): Promise<PortalReconnect> {
  const health = await testWorker(config);
  if (!workerVersionAtLeast(health.version, "2.14.0")) throw new Error("Update the PC worker to 2.14.0 to reconnect from FamilyHub.");
  return request(config, `/${insurer}/reconnect`, { method: "POST", body: JSON.stringify({ interactive: true }) });
}
export function fetchPortalReconnect(config: WorkerConfig, insurer: "bluecross" | "desjardins"): Promise<PortalReconnect> {
  return request(config, `/${insurer}/reconnect`);
}
export type DesjardinsSyncStatus = BlueCrossSyncStatus & { previewAt?: string; applicable?: boolean; lastRecoveryAt?: string; recoveredRows?: number };
export function fetchDesjardinsStatus(config: WorkerConfig): Promise<DesjardinsSyncStatus> {
  return request(config, "/desjardins/status");
}
export function syncDesjardins(config: WorkerConfig, apply: boolean): Promise<DesjardinsSyncResult> {
  return request(config, "/desjardins/sync", { method: "POST", body: JSON.stringify({ apply }) }, 6 * 60_000);
}

export type InvoiceSnapshot = {
  items: ReimbursementItem[]; busy: boolean; setupRequired: boolean;
  reconciliations: ReconciliationCase[]; cleanupSuggestions: CleanupSuggestion[];
  importantMail: ReimbursementItem[];
  unmatchedReimbursements: UnmatchedReimbursement[];
  ignoredUnmatchedReimbursements: UnmatchedReimbursement[];
  agentReviews?: AgentReview[];
  ignoredExpenses?: ReconciliationCase[];
  coverage?: { since: string; complete: boolean };
  diagnostics?: { totalExpenses: number; fullyReimbursed: number; waitingPrimary: number; waitingSecondary: number; patientBalance: number; needsAttention: number; unmatchedInsurerRecords: number; duplicateCandidates: number; missingServiceDates: number; unknownMembers: number; patientAsProvider: number; amountsReconstructed: number; insurerPaymentsOverBilled: number; contradictoryEvidence: number; averageMatchConfidence: number };
  learning: { decisions: number; undoable: Array<{ id: string; itemId: string; type: string; at: string }> };
  accounts: { email: string; label: string }[];
  progress: Record<string, { error?: string; window?: unknown; lastSuccess?: string }>;
  lastAttempt?: string; lastSuccess?: string; error?: string;
};
export async function fetchInvoices(config: WorkerConfig): Promise<InvoiceSnapshot> {
  const raw = await request<Partial<InvoiceSnapshot>>(config, "/invoices");
  const learning = raw.learning && typeof raw.learning === "object"
    ? {
        decisions: Number(raw.learning.decisions || 0),
        undoable: Array.isArray(raw.learning.undoable) ? raw.learning.undoable : []
      }
    : { decisions: 0, undoable: [] };

  return {
    items: Array.isArray(raw.items) ? raw.items : [],
    busy: Boolean(raw.busy),
    setupRequired: Boolean(raw.setupRequired),
    reconciliations: Array.isArray(raw.reconciliations) ? raw.reconciliations : [],
    cleanupSuggestions: Array.isArray(raw.cleanupSuggestions) ? raw.cleanupSuggestions : [],
    importantMail: Array.isArray(raw.importantMail) ? raw.importantMail : [],
    unmatchedReimbursements: Array.isArray(raw.unmatchedReimbursements) ? raw.unmatchedReimbursements : [],
    ignoredUnmatchedReimbursements: Array.isArray(raw.ignoredUnmatchedReimbursements) ? raw.ignoredUnmatchedReimbursements : [],
    agentReviews: Array.isArray(raw.agentReviews) ? raw.agentReviews : [],
    ignoredExpenses: Array.isArray(raw.ignoredExpenses) ? raw.ignoredExpenses : [],
    coverage: raw.coverage,
    diagnostics: raw.diagnostics,
    learning,
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    progress: raw.progress && typeof raw.progress === "object" ? raw.progress : {},
    lastAttempt: raw.lastAttempt,
    lastSuccess: raw.lastSuccess,
    error: raw.error
  };
}
export function collectInvoices(config: WorkerConfig): Promise<{ status: string }> {
  return request(config, "/invoices/collect", { method: "POST" });
}
export function correctInvoice(config: WorkerConfig, id: string, kind: string): Promise<ReimbursementItem> {
  return request(config, `/invoices/${encodeURIComponent(id)}/correction`, { method: "POST", body: JSON.stringify({ kind }) });
}
export function saveInvoiceStatus(config: WorkerConfig, id: string, status: number): Promise<ReimbursementItem> {
  return request(config, `/invoices/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });
}
export function setExpenseIgnored(config: WorkerConfig, documentIds: string[], ignored: boolean): Promise<{ saved: boolean }> {
  return request(config, "/invoices/expenses/ignore", { method: "POST", body: JSON.stringify({ documentIds, ignored }) });
}
export async function setDocumentsIgnored(config: WorkerConfig, documentIds: string[], ignored: boolean): Promise<{ saved: boolean }> {
  const health = await testWorker(config);
  if (!workerVersionAtLeast(health.version, bulkDocumentWorkerVersion)) {
    throw new Error(`Your PC worker is ${health.version || "an older version"}. Bulk document status changes require worker ${bulkDocumentWorkerVersion} or later. Update and restart the FamilyHub worker on the PC, then refresh.`);
  }
  return request(config, "/invoices/documents/ignore", { method: "POST", body: JSON.stringify({ documentIds, ignored }) });
}
export function setMatchDecision(config: WorkerConfig, reimbursementId: string, expenseId: string, decision: "confirmed" | "rejected"): Promise<{ saved: boolean }> {
  return request(config, "/invoices/matches/decision", { method: "POST", body: JSON.stringify({ reimbursementId, expenseId, decision }) });
}
export async function setManualMatch(config: WorkerConfig, reimbursementId: string, expenseId: string, confirmedServiceDate?: string): Promise<{ saved: boolean }> {
  await requireManualReconciliationWorker(config);
  if (confirmedServiceDate && !workerVersionAtLeast((await testWorker(config)).version, "2.13.0"))
    throw new Error("Confirming a missing service date requires PC worker 2.13.0 or later. Update the worker and refresh.");
  return request(config, "/invoices/matches/manual", { method: "POST", body: JSON.stringify({ reimbursementId, expenseId, ...(confirmedServiceDate ? { confirmedServiceDate } : {}) }) });
}
export async function setUnmatchedIgnored(config: WorkerConfig, reimbursementId: string, ignored: boolean): Promise<{ saved: boolean }> {
  await requireManualReconciliationWorker(config);
  return request(config, "/invoices/unmatched/ignore", { method: "POST", body: JSON.stringify({ reimbursementId, ignored }) });
}
export function setReimbursementWorkflowStatus(config: WorkerConfig, expenseId: string, status: ReimbursementWorkflowStatus | "automatic"): Promise<{ saved: boolean }> {
  return request(config, "/invoices/workflow/status", { method: "POST", body: JSON.stringify({ expenseId, status }) });
}
export function undoInvoiceDecision(config: WorkerConfig, decisionId: string): Promise<ReimbursementItem> {
  return request(config, "/invoices/decisions/undo", { method: "POST", body: JSON.stringify({ decisionId }) });
}
type AttachmentSource = Pick<ReimbursementItem, "Id" | "Attachments">;
async function workerAttachmentBlob(config: WorkerConfig, item: AttachmentSource, index: number): Promise<{ blob: Blob; fileName: string }> {
  const attachment = item.Attachments[index];
  if (!attachment) throw new Error("Attachment not found.");
  const response = await fetch(endpoint(config, `/invoices/${encodeURIComponent(item.Id)}/attachments/${encodeURIComponent(attachment.Id)}`), {
    headers: headers(config), signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || "Attachment retrieval failed.");
  }
  const bytes = await response.arrayBuffer();
  return {
    blob: new Blob([bytes], { type: /\.pdf$/i.test(attachment.FileName) ? "application/pdf" : attachment.MimeType || "application/octet-stream" }),
    fileName: attachment.FileName
  };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Open a private worker attachment from a direct user gesture.
 * The blank viewer is created before the authenticated fetch so mobile popup blockers
 * do not treat the final PDF navigation as an unsolicited async popup.
 * If the browser blocks the viewer, fall back to a normal download.
 */
export async function viewWorkerAttachment(config: WorkerConfig, item: AttachmentSource, index: number): Promise<void> {
  const attachment = item.Attachments[index];
  if (!attachment) throw new Error("Attachment not found.");
  const viewer = window.open("", "_blank");
  if (viewer) {
    viewer.opener = null;
    try {
      viewer.document.title = "Loading invoice…";
      viewer.document.body.textContent = "Loading invoice…";
    } catch { /* Navigation below is still sufficient. */ }
  }
  try {
    const { blob, fileName } = await workerAttachmentBlob(config, item, index);
    if (!viewer) {
      downloadBlob(blob, fileName);
      return;
    }
    const url = URL.createObjectURL(blob);
    viewer.location.replace(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (error) {
    if (viewer) viewer.close();
    throw error;
  }
}

export async function downloadWorkerAttachment(config: WorkerConfig, item: AttachmentSource, index: number): Promise<void> {
  const { blob, fileName } = await workerAttachmentBlob(config, item, index);
  downloadBlob(blob, fileName);
}

export async function testWorker(config: WorkerConfig): Promise<{ status: string; codex: string; version: string }> {
  return request(config, "/health");
}

export async function submitWorkerTask(config: WorkerConfig, type: WorkerTaskType, prompt: string): Promise<WorkerTask> {
  return request<WorkerTask>(config, "/tasks", {
    method: "POST",
    body: JSON.stringify({ type, prompt })
  });
}

export async function getWorkerTask(config: WorkerConfig, id: string): Promise<WorkerTask> {
  return request<WorkerTask>(config, `/tasks/${encodeURIComponent(id)}`);
}

export async function runWorkerTask(config: WorkerConfig, type: WorkerTaskType, prompt: string, timeoutMs = 120_000): Promise<WorkerTask> {
  let task = await submitWorkerTask(config, type, prompt);
  const started = Date.now();
  while (task.status === "queued" || task.status === "running") {
    if (Date.now() - started > timeoutMs) throw new Error("The worker is still processing this request. You can try again in a moment.");
    await new Promise(resolve => window.setTimeout(resolve, 1200));
    task = await getWorkerTask(config, task.id);
  }
  if (task.status === "failed") throw new Error(task.error || "The worker task failed.");
  return task;
}

export async function syncResearchWatch(config: WorkerConfig, watch: ResearchWatch): Promise<void> {
  await request(config, "/watches", {
    method: "POST",
    body: JSON.stringify(watch)
  });
}

export async function runResearchWatch(config: WorkerConfig, watch: ResearchWatch): Promise<{ result: string; completedAt: string }> {
  return request(config, `/watches/${encodeURIComponent(watch.Id)}/run`, { method: "POST" });
}

export async function fetchResearchWatch(config: WorkerConfig, id: string): Promise<ResearchWatch | null> {
  try { return await request<ResearchWatch>(config, `/watches/${encodeURIComponent(id)}`); }
  catch { return null; }
}
