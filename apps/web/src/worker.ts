import { ResearchWatch, WorkerConfig, WorkerTask, WorkerTaskType } from "./types";

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
    ...init,
    headers: { ...headers(config), ...(init.headers ?? {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Worker request failed (${response.status}).`);
  }
  return await response.json() as T;
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
