import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { claimBlockingReasons, claimMissingAmountReason } from "../src/claim-block-reasons";
import { Notice } from "../src/ui/primitives";
import type { ClaimPreparation } from "../src/worker";
const conflict = "OriginalBilledAmount differs from direct-insurance arithmetic (200 vs 80).";
const base = { insurer: "blue-cross", blocked: true, conflicts: [conflict], reviewableWarnings: [], duplicate: { status: "not-verified", records: [] } } as unknown as ClaimPreparation;
test("a financial conflict is described precisely without claiming a target-insurer duplicate", () => {
  const reasons = claimBlockingReasons(base);
  assert.equal(reasons.length, 1);assert.match(reasons[0], /Conflicting source/);assert.doesNotMatch(reasons[0], /recorded|duplicate|Desjardins/);
  const html = renderToStaticMarkup(createElement(Notice, { error: true, children: conflict }));
  assert.match(html, /app-notice error/);assert.match(html, /role="alert"/);assert.doesNotMatch(html, /check-circle|app-notice success/);
});
test("real recorded or possible target-insurer claims retain explicit blockers in either direction", () => {
  for (const [insurer, label] of [["blue-cross", "Blue Cross"], ["desjardins", "Desjardins"]] as const) {
    for (const status of ["recorded", "possible"]) {
      const reasons = claimBlockingReasons({ ...base, insurer, conflicts: [], duplicate: { ...base.duplicate, status } });
      assert.equal(reasons.length, 1);assert.ok(reasons[0].includes(label));assert.match(reasons[0], /Check/);
    }
  }
  assert.deepEqual(claimBlockingReasons({ ...base, blocked: false, conflicts: [] }), []);
});
test("reviewable warnings do not acquire a green success icon or fabricate a blocker", () => {
  const dossier = { ...base, blocked: false, reviewableWarnings: [conflict] };
  assert.deepEqual(claimBlockingReasons(dossier), []);
  const html = renderToStaticMarkup(createElement(Notice, { warning: true, children: conflict }));
  assert.match(html, /app-notice warning/);assert.match(html, /triangle/);assert.doesNotMatch(html, /check-circle|app-notice success/);
  assert.equal(claimBlockingReasons({ ...dossier, blocked: true }).length, 1);
});
test("missing gross is explained as missing evidence, not an insurer duplicate", () => {
  const dossier = { ...base, blocked: false, conflicts: [], missing: ["originalAmount"] };
  assert.match(claimMissingAmountReason(dossier)!, /original gross expense is unknown/);
  assert.deepEqual(claimBlockingReasons(dossier), []);
});
