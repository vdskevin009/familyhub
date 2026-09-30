type Insurer = "bluecross" | "desjardins";
type Result = { status: "success" | "login-required"; [key: string]: unknown };
type Job = { state: "running" | "success" | "login-required" | "error"; startedAt: string; result?: Result; error?: string };

// The HTTP request only starts the job. Authentication may take minutes, so
// polling must survive mobile disconnects and reverse-proxy request timeouts.
const jobs = new Map<Insurer, Job>();
export function portalReconnectStatus(insurer: Insurer): Job | undefined {
  const job = jobs.get(insurer);
  return job ? structuredClone(job) : undefined;
}
export function startPortalReconnect(insurer: Insurer, preview: () => Promise<Result>): Job {
  if ([...jobs.values()].some(job => job.state === "running"))
    throw new Error("An insurer reconnect is already running. Finish signing in on the PC first.");
  const job: Job = { state: "running", startedAt: new Date().toISOString() };
  jobs.set(insurer, job);
  void Promise.resolve().then(preview).then(result => {
    const { snapshotPath: _snapshotPath, backup: _backup, ...publicResult } = result;
    job.result = publicResult as Result;
    job.state = result.status;
  }).catch(() => {
    job.state = "error";
    job.error = "Reconnect did not complete. Check the insurer sync status and the PC browser, then try again.";
  });
  return structuredClone(job);
}
