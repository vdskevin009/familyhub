import { AgentReview, CleanupSuggestion, ReconciliationCase, ReimbursementItem, ReimbursementWorkflowStatus, ResearchWatch, UnmatchedReimbursement, WorkerConfig, WorkerTask, WorkerTaskType } from "./types";

export const manualReconciliationWorkerVersion = "2.8.0";
export const bulkDocumentWorkerVersion = "2.11.0";
export type ClaimPreparation = {
  expenseId: string; insurer: "blue-cross" | "desjardins"; portalUrl: string; blocked: boolean; submitAllowed: false;
  fields: { patient: string | null; provider: string | null; practitioner: string | null; serviceDate: string | null; originalAmount: number | null; service: string | null; invoiceNumber: string | null; otherInsurance?: string | null; otherInsurancePaid?: number | null };
  otherInsurer?: string; currency?: string | null; reviewableWarnings?: string[];
  missing: string[]; conflicts: string[];
  attachments: { documentId: string; attachmentId: string; name: string }[];
  sourceEmails: { account: string; messageId: string }[];
  duplicate: { status: string; scope: string; checkedAt: string; records: { id: string; reference: string | null; service: string | null; status: string }[] };
};
export type ClaimStep = { status: string; revision: string; submitAllowed: false; fields: { key: string; label: string; type: string; kind: string | null; suggested: string | null; options: { value: string; label: string }[] }[] };
export async function claimAction<T>(config: WorkerConfig, action: "preview" | "open" | "inspect" | "fill" | "close", body: object): Promise<T> {
  if (action !== "close") {
    const health = await testWorker(config);
    if (!workerVersionAtLeast(health.version, "2.17.2")) {
      throw new Error(`Your PC worker is ${health.version || "an older version"}. Claim preparation requires worker 2.17.2 or later. Update and restart the FamilyHub worker on the PC, then reopen this panel.`);
    }
  }
  return request(config, `/claim-preparation/${action}`, { method: "POST", body: JSON.stringify(body) }, 90_000);
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
    throw new Error(body.error || `Worker request failed (${response.status}).`);
  }
  return await response.json() as T;
}

export type BlueCrossSyncResult = { status: "success" | "login-required"; applied?: boolean; found?: number; new?: number;
  changed?: number; unchanged?: number; ambiguous?: number; duplicates?: number; errors?: number; complete?: boolean;
  loginRequired?: boolean; warnings?: string[]; matched?: number; unmatched?: number };
export type BlueCrossSyncStatus = { loginConfigured?: boolean; authReason?: "not-configured" | "credentials-unavailable" | "credentials-rejected" | "human-required" | "layout-changed" | "cooldown" | "profile-busy"; lastAttempt?: string; lastSuccess?: string; lastAppliedAt?: string; latestResult?: BlueCrossSyncResult; found?: number;
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
export type DesjardinsSyncStatus = BlueCrossSyncStatus & { previewAt?: string; applicable?: boolean };
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
    blob: new Blob([bytes], { type: attachment.MimeType || "application/octet-stream" }),
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
