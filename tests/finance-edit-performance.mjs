/** Reproducible synthetic measurement, not a claim about phone/tunnel latency. */
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { categoryFixture } from "./finance-category-fixture.mjs";
import { FinanceLibrary } from "../apps/worker/dist/finance-library.js";
const dir = await mkdtemp(join(tmpdir(), "fh-category-perf-"));
try {
    const bundle = categoryFixture(), template = bundle.bankActivities[0];
    bundle.bankActivities = Array.from({ length: 1823 }, (_, n) => ({ ...template, id: `synthetic-${n}`, sourceRowId: `synthetic-${n}`, matchingFingerprint: `synthetic-${n}`, descriptionOriginal: `SYNTHETIC MERCHANT ${n % 150}` }));
    const results = {};
    for (const mode of ["full-state", "delta"]) {
        const lib = new FinanceLibrary(join(dir, mode)); let s = (await lib.import({ bundle, apply: true, expectedRevision: "empty" })).state;
        const timings = [], parseTimings = [], sizes = [];
        for (let n = 0; n < 24; n++) {
            const start = performance.now(), request = { expectedRevision: s.revision, id: `synthetic-${n}`, decision: { nature: "expense", category: "groceries", note: "Synthetic measured choice" } };
            const result = mode === "delta" ? await lib.change({ ...request, kind: "decision", requestId: randomUUID() }) : await lib.decide(request);
            const serialized = JSON.stringify(result), beforeParse = performance.now(); JSON.parse(serialized);
            if (n >= 4) { timings.push(beforeParse - start); parseTimings.push(performance.now() - beforeParse); sizes.push(Buffer.byteLength(serialized)); }
            s = { ...s, revision: result.revision };
        }
        const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        results[mode] = { medianResponseBytes: median(sizes), medianReadValidateWriteSerializeMs: +median(timings).toFixed(2), medianParseMs: +median(parseTimings).toFixed(2) };
    }
    assert.ok(results.delta.medianResponseBytes < results["full-state"].medianResponseBytes / 50, "Single edits should not send the full ledger");
    const proof = { transactions: 1823, warmSamples: 20, synthetic: true, methodology: "Same synthetic history in two temporary libraries; 4 warm-up + 20 single edits. Timings include server disk read/validation/atomic write/serialization, exclude network and UI. No production mutation.", results, responseReductionPercent: +(100 * (1 - results.delta.medianResponseBytes / results["full-state"].medianResponseBytes)).toFixed(2) };
    await mkdir("output/playwright/finance-changes", { recursive: true }); await writeFile("output/playwright/finance-changes/performance.json", JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
} finally { await rm(dir, { recursive: true, force: true }); }
