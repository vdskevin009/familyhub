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
