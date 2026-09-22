import { CleanupSuggestion, ReconciliationCase, ReimbursementItem, ResearchWatch, WorkerConfig, WorkerTask, WorkerTaskType } from "./types";

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

async function request<T>(config: WorkerConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint(config, path), {
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: { ...headers(config), ...(init.headers ?? {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Worker request failed (${response.status}).`);
  }
  return await response.json() as T;
}

export type InvoiceSnapshot = {
  items: ReimbursementItem[]; busy: boolean; setupRequired: boolean;
  reconciliations: ReconciliationCase[]; cleanupSuggestions: CleanupSuggestion[];
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
export function undoInvoiceDecision(config: WorkerConfig, decisionId: string): Promise<ReimbursementItem> {
  return request(config, "/invoices/decisions/undo", { method: "POST", body: JSON.stringify({ decisionId }) });
}
export async function downloadWorkerAttachment(config: WorkerConfig, item: ReimbursementItem, index: number): Promise<void> {
  const attachment = item.Attachments[index];
  if (!attachment) throw new Error("Attachment not found.");
  const response = await fetch(endpoint(config, `/invoices/${encodeURIComponent(item.Id)}/attachments/${encodeURIComponent(attachment.Id)}`), {
    headers: headers(config), signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || "Attachment download failed.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = attachment.FileName;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
