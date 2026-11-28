# Contribution goal rings · committee validation

Approved product change, separate from the device appearance option and from contribution-source repair. Reconciled with main `e64ffc939368884f304cd141c26a290f32f49842`, which already includes device appearance (#326). No production, account, import, worker, schema or release changes.

## What to review

* **Confirmed only.** Show one two-colour donut per scheme when the explicit positive personal target, source date, coverage and attribution are supported. The visible centre includes the percent. Above the target, cap the plotted arc (not the centre number). Avoid rounding very small nonzero values to zero or near-target values to attainment. Show identified amount, the target and the remaining contribution before future estimates.
* **Honest fallback.** Do not turn an unknown source, a missing target, partial coverage, or unconfirmed attribution into zero or a completed goal. Keep identified amounts where known. Inferred amounts, unallocated transfers, schedules, source limitations and forecasts stay in the existing details, and forecast effort retains its separate definition.
* **Purposeful motion.** No visual progression on first load, same values, changed goal or after an unverified gap. Animate only confirmed changes to the arc for the same target; reduced-motion clients get none. Screen-reader accessible progress and exact labels do not animate. The existing details sheet keeps its keyboard trap, Escape and focus return; the refresh control remains focused while pending.
* **Release gate.** The current authoritative worker emits `status: "partial"`, `sourceFreshness: "unknown"` and `sourceAsOf: null`. It does not make an affirmative completeness claim. The UI's completed examples are fictional forward-compatibility fixtures; the current worker will show the honest partial presentation, not a live donut. Future activation requires a separate evidence-backed source implementation and actual acceptance. Do not treat this as a contribution reconciliation or infer a missing payment.

## How to verify

On this candidate, use `npm run build`, `npm run typecheck`, `node apps/web/tests/contributions-browser.mjs` and `node apps/web/tests/dark-domain-browser.mjs` with the project's Playwright browser. Both browser checks run in CI. The fictional worker only accepts reads. The Contributions check covers confirmed, incomplete, unknown, verified zero, near/at/above goal, refresh, focus, navigation and reduced motion. The appearance check measures visible SVG arc and text contrast in both themes, verifies a partial plan has no ring, and uses the real Appearance control and system preference to change the ring's palette without changing its data. Evidence stays local under `output/playwright`.
