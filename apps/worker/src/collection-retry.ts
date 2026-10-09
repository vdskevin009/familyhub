export type CollectionRetry = { attempt: number; maximum: number; state: "reading" | "waiting" | "complete" | "incomplete" | "authentication-required" | "exhausted"; nextAttemptAt?: string };
type Result = { status: string; collection?: { complete: boolean; warnings: string[] } };
const transientWarning = /detail navigation failed|claims pagination failed|claims page \d+ was incomplete|pagination was interrupted/i;
const transientError = /timeout|timed out|net::ERR_(?:CONNECTION|NETWORK|INTERNET|TIMED_OUT)|ECONNRESET|ETIMEDOUT|fetch failed/i;

/** Retry only read-only collection after its browser/lock is released. Never replay apply or an HTTP POST. */
export async function collectWithRetry<T extends Result>(read: () => Promise<T>, report: (status: CollectionRetry) => Promise<void>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), maximum = 3): Promise<T> {
  for (let attempt = 1; attempt <= maximum; attempt++) {
    await report({ attempt, maximum, state: "reading" });
    let result: T | undefined;
    let failure: unknown;
    try { result = await read(); } catch (error) { failure = error; }
    if (result?.status === "login-required") {
      await report({ attempt, maximum, state: "authentication-required" }); return result;
    }
    const warnings = result?.collection?.warnings ?? [];
    const retryable = failure instanceof Error ? transientError.test(failure.message) && !/auth|sign.in|session expired|credential|challenge/i.test(failure.message)
      : result?.collection?.complete === false && warnings.length > 0 && warnings.every(warning => transientWarning.test(warning));
    if (!retryable || attempt === maximum) {
      await report({ attempt, maximum, state: retryable ? "exhausted" : result?.collection?.complete ? "complete" : "incomplete" });
      if (failure) throw failure;
      return result!;
    }
    const delay = attempt === 1 ? 2000 : 8000;
    await report({ attempt, maximum, state: "waiting", nextAttemptAt: new Date(Date.now() + delay).toISOString() });
    await wait(delay);
  }
  throw new Error("Collection retry limit is invalid.");
}
