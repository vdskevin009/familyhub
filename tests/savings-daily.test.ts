import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SavingsResearch } from "../apps/worker/src/savings-research.ts";
import { newContract, baselineKey } from "../apps/worker/src/savings-model.ts";
import { prepareSharedReviews, mergeResearchReviews } from "../apps/web/src/savings-results.ts";
import { runDaily } from "../scripts/savings-daily.mjs";

test("daily starts serialize, restrict private input and survive completed/interrupted restart without replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fh-daily-"));
  let calls = 0;
  const contract = { ...newContract("telecom", "daily-contract"), provider: "TELUS", name: "PRIVATE_NAME", needs: "PRIVATE_NEEDS", notes: "PRIVATE_NOTES", updatedAt: new Date().toISOString() };
  const runner = async (prompt: string) => { calls++; assert.doesNotMatch(prompt, /PRIVATE_NAME|PRIVATE_NEEDS|PRIVATE_NOTES|daily-contract/); return JSON.stringify({ summary: "Synthetic", missing: [], offers: [] }); };
  try {
    const research = new SavingsResearch(directory, runner); await research.initialize();
    const [first, duplicate] = await Promise.all([research.startDaily(contract, "2026-10-03"), research.startDaily(contract, "2026-10-03")]);
    assert.equal(first.id, duplicate.id);
    for (let attempt = 0; first.status !== "complete" && attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(first.status, "complete"); assert.equal(calls, 1);
    const restarted = new SavingsResearch(directory, runner); await restarted.initialize();
    assert.equal((await restarted.startDaily({ ...contract, price: 80 }, "2026-10-03")).id, first.id);
    assert.equal(calls, 1);
    const pending = { ...first, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "running", scheduledDate: "2026-10-04", report: undefined };
    await writeFile(join(directory, pending.id + ".json"), JSON.stringify(pending));
    const interrupted = new SavingsResearch(directory, runner); await interrupted.initialize();
    const stopped = await interrupted.startDaily(contract, "2026-10-04");
    assert.equal(stopped.status, "failed"); assert.equal(calls, 1);
    assert.ok(interrupted.latest().some(job => job.id === first.id));
    const incoming = await prepareSharedReviews([first], [contract]);
    assert.equal(incoming[0].localKey, baselineKey(contract));
    assert.equal((await prepareSharedReviews([first], [{ ...contract, price: 99 }])).length, 0);
    const old = { ...incoming[0], decisions: { "0": "shortlist" as const } };
    const merged = mergeResearchReviews([old], incoming);
    assert.deepEqual(merged[0].decisions, old.decisions);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("daily client waits for each saved comparison, never replays an uncertain POST and stops on active research", async () => {
  const events: string[] = [], snapshots: unknown[] = [];
  const request = async (path: string, body?: { contractId: string }) => {
    events.push(path + (body ? ":" + body.contractId : ""));
    if (path === "/savings/contracts") return { records: [{ contract: { id: "one" } }, { contract: { id: "two" } }] };
    if (path === "/savings/research") return { jobs: [] };
    if (body) return { id: body.contractId, status: "running" };
    return { id: path.split("/").at(-1), status: "complete" };
  };
  const result = await runDaily(request, async (value: unknown) => { snapshots.push(structuredClone(value)); }, () => 0, async () => {});
  assert.equal(result.success, true);
  assert.ok(events.indexOf("/savings/research/one") < events.indexOf("/savings/research/daily:two"));
  let posts = 0;
  const failed = await runDaily(async (path: string, body?: unknown) => { if (body) { posts++; throw new Error("uncertain"); } return request(path); }, async () => {}, () => 0, async () => {});
  assert.equal(posts, 1); assert.equal(failed.outcome, "request-failed-no-retry");
  const busy = await runDaily(async (path: string, body?: unknown) => { assert.equal(body, undefined); return path === "/savings/research" ? { jobs: [{ status: "running" }] } : request(path); }, async () => {});
  assert.equal(busy.outcome, "research-busy"); assert.equal(busy.results.length, 0);
});

import { researchIntervalDays, reusableResearch } from "../apps/worker/src/savings-cadence.ts";
import { requestFailure } from "../scripts/savings-daily.mjs";
test("adaptive research cadence preserves explicit expiry, fingerprint changes and unknown renewal", () => {
  const now = new Date("2026-10-23T16:00:00Z"), contract = newContract("home-insurance", "cadence");
  assert.equal(researchIntervalDays(contract, now), 30);
  contract.renewal = "2026-12-18"; assert.equal(researchIntervalDays(contract, now), 7);
  contract.renewal = "2026-10-27"; assert.equal(researchIntervalDays(contract, now), 1);
  contract.renewal = "2026-02-30"; assert.equal(researchIntervalDays(contract, now), 30);
  const job: any = { id: "one", contractId: contract.id, baselineKey: "current", status: "complete", createdAt: "2026-10-22T16:00:00Z", completedAt: "2026-10-22T16:00:00Z", report: { offers: [], missing: [], summary: "No comparable current offers" } };
  assert.equal(reusableResearch(contract, "current", [job], now)?.id, "one");
  assert.equal(reusableResearch(contract, "changed", [job], now), undefined);
  assert.equal(reusableResearch(contract, "current", [{ ...job, status: "failed" }], now), undefined);
  assert.equal(reusableResearch(contract, "current", [{ ...job, completedAt: "2026-11-01T00:00:00Z" }], now), undefined);
  assert.equal(reusableResearch(contract, "current", [{ ...job, report: { offers: [{ validUntil: "2026-10-22" }] } }], now), undefined);
  contract.renewal = "2026-10-25"; assert.equal(reusableResearch(contract, "current", [job], now), undefined);
});
test("uncertain daily start is recovered only from a unique new dated job, never re-POSTed", async () => {
  const now = Date.parse("2026-10-23T16:00:00Z"); let posts = 0, reads = 0;
  const job = { id: "new", contractId: "one", scheduledDate: "2026-10-23", createdAt: new Date(now).toISOString(), status: "complete" };
  const run = async (matches: unknown[]) => runDaily(async (path: string, body?: unknown) => {
    if (body) { posts++; throw Object.assign(new Error("PRIVATE endpoint/key must not persist"), { name: "TimeoutError" }); }
    if (path === "/savings/contracts") return { records: [{ contract: { id: "one" } }] };
    return { jobs: ++reads % 2 === 1 ? [] : matches };
  }, async () => {}, () => now, async () => {});
  const recovered = await run([job]); assert.equal(recovered.success, true); assert.equal(recovered.results[0].recoveredByRead, true); assert.equal(posts, 1);
  const ambiguous = await run([job, { ...job, id: "another" }]); assert.equal(ambiguous.outcome, "request-failed-no-retry"); assert.equal(posts, 2);
  assert.deepEqual(ambiguous.failure, { kind: "timeout" }); assert.doesNotMatch(JSON.stringify(ambiguous), /PRIVATE/);
  assert.equal((await run([{ ...job, scheduledDate: "2026-10-22" }])).outcome, "request-failed-no-retry");
  assert.deepEqual(requestFailure({ status: 503, message: "PRIVATE" }), { kind: "http", status: 503 });
  assert.deepEqual(requestFailure({ cause: { code: "SECRET" } }), { kind: "unconfirmed" });
});
test("research reuse is counted distinctly and polling failures preserve a terminal diagnosis", async () => {
  const snapshots: any[] = [];
  const reused = await runDaily(async (path: string, body?: unknown) => path === "/savings/contracts" ? { records: [{ contract: { id: "one" } }] } : body ? { id: "one", status: "complete", dailyReused: true } : { jobs: [] }, async (v: any) => { snapshots.push(structuredClone(v)); });
  assert.equal(reused.success, true); assert.equal(reused.results[0].reused, true);
  const failed = await runDaily(async (path: string, body?: unknown) => {
    if (path === "/savings/contracts") return { records: [{ contract: { id: "one" } }] };
    if (body) return { id: "one", status: "running" };
    if (path === "/savings/research") return { jobs: [] };
    throw Object.assign(new Error("private"), { cause: { code: "ECONNRESET" } });
  }, async () => {}, () => 0, async () => {});
  assert.equal(failed.outcome, "connection-lost-no-retry"); assert.ok(failed.completedAt); assert.deepEqual(failed.failure, { kind: "connection", code: "ECONNRESET" });
});
