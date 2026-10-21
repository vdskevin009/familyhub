# Mortgage implementation handoff

Branch: `feat/mortgage-observations`, based on main `072d1cb`. Local checkout: `C:\Users\kevin\Documents\Codex\2026-10-20\task-2\familyhub-mortgage`. No edits to the Achats checkout. No push, PR, merge, deployment, installed-worker update/restart, scheduler creation or lender action.

## Delivered

* A real Mortgage tab in React navigation, with four public product observations, exact-date comparison periods, explicit collection/eligibility limits, dated private quote variants and optional negotiation scenarios. Current payment reduction and horizon interest savings are separate. Fixed-payment variable quote illustrations abstain until the contractual payment/terms are known.
* Dedicated validated immutable worker storage, fixed baseline pointer, GET read/preflight, bounded authenticated POST ingestion and an operational one-shot validation/preflight/apply helper. This is a supported local write path, not a mocked backend or automatic source scraper.
* Actual initial source evidence supplied and independently verified by the parent is saved only in ignored `.private/mortgage/`: one October 20 Vancouver baseline snapshot and three dated October 16 quotes, with source/control caveats. The observation's capture precision is explicitly one minute. No earlier dates were manufactured. These local files are not in Git and have not been ingested into the household's installed worker.

## Validation evidence

All tests use synthetic inputs and isolated temporary worker directories. Browser requests are intercepted; no real provider, lender, household worker or private source is contacted by acceptance tests.

| Check | Outcome / evidence |
| --- | --- |
| Dependency installation | Passed in isolated checkout; `npm install --ignore-scripts`, 0 reported vulnerabilities. Cached dependencies were initially copied; a normal install completed with the authorized Windows workspace-link permission. No generated lockfile is included. |
| Both TypeScript workspace checks | Passed, `npm run typecheck`; `artifacts/mortgage/typecheck.log`. |
| Full PWA + worker build | Passed, `npm run build`; `artifacts/mortgage/build.log`. Existing nonfatal Vite bundle-size warning remains. |
| Mortgage model/storage and real isolated HTTP/CLI | 15 passed, `npm run test:mortgage`; `artifacts/mortgage/final-tests.log`. |
| Existing PWA/product checks | 5 metadata/theme + 88 product/UI tests passed, `npm run test:pwa`; `artifacts/mortgage/pwa.log`. |
| Mortgage built-PWA browser acceptance | Passed 320/390/768/1280px using installed Edge; `npm run test:mortgage:browser`; `artifacts/mortgage/browser.log`, `browser-report.json`, `overview-*.png`, `mortgage-*.png`. |
| Existing neutral theme/navigation regression | Passed 12 routes × 4 widths × 2 system color preferences, native-dialog focus/return, navigation/history and retained synthetic state; `artifacts/mortgage/theme-browser.log`. |
| Retained .NET regression | Not run: `dotnet` is unavailable on this PC; attempted required command is recorded in the handoff. CI still retains the check. |
| Lint | No repository lint script is defined. |

Focused acceptance covers strict four-product schema; observed vs unavailable/partial/failed states; explicit control verification; source/eligibility limits; duplicate/concurrent/reordered canonical writes; conflicts; frozen baseline despite later attempts; corrupt storage failing closed; exact dates and calendar-month clamping; Vancouver midnight and historical DST; filter drift; separate dated quote variants; per-quote absolute-spread scenarios; zero-rate/monthly/Canadian semiannual calculations; independent discounted-cash-flow and balance checks; and the FCAC published 5% payment/interest example.

The HTTP/CLI check uses a real temporary localhost worker, confirms pairing and origin refusal, 32 KB body bounds, 409 conflict, no-store responses, read-only preflight/dry-run, duplicate apply, restart persistence and an unrelated-file sentinel. The first sandbox run could not rename within Windows' virtualized temporary directory or reach the test worker; the final acceptance uses the ordinary permitted Temp directory and an isolated authorized test process. A Windows Node immediate-exit assertion exposed by CLI preflight was fixed by allowing graceful shutdown; the final CLI test passes.

The Mortgage browser walk covers complete/partial/failed/empty/error states, refresh recovery, keyboard checkbox use, quote detail disclosure, absent fixed-payment cash-flow claims, no document overflow, all seven tabs in one mobile row, Refresh clear of the notification control, leaving while a read is pending, repeated reopen and Back/Forward, preserved unrelated localStorage and zero writes/external-provider requests. Rendered text/button/focus contrast is measured in the browser report. Screenshots were visually inspected; the table has a visible scroll instruction and a focusable labelled scrolling region.

## Interface review scope

Only the Mortgage flow and its new navigation registration were reviewed using the available accessibility/layout/writing/typography/color/UI references. Existing FamilyHub tokens and density are retained. Native controls, labels, semantic headings and table headers, polite status updates, visible focus and static state labels are used. The feature adds no motion. Visual inspection caught and fixed mobile navigation wrapping and Refresh collision. The inherited app chrome and source text were not restyled. Screen-reader walkthrough, physical phone and 200% browser zoom are **not verified**; synthetic widths and keyboard checks do not establish them.

## Access / release blockers

The installed household worker has **not** been changed or restarted. Its actual private endpoint/key configuration has not been authenticated by this task (the default `~/.familyhub-worker/pairing-key.txt` is absent). No production route preflight, real daily write or natural scheduled run is claimed. The source routes are verified on isolated local workers only.

The parent must obtain separate release authorization, integrate this branch with Achats, build/restart the existing worker preserving its runtime authentication and private data, publish the PWA as authorized, and run the read-only preflight in `MORTGAGE.md` before activating its single owned daily automation. Then ingest the retained private initial files through the supported endpoint, inspect the actual view and read back evidence counts/baseline. Do not copy private quotes or pairing material into Git, issue comments or public screenshots. No new public network exposure is needed or authorized.

No dedicated open Mortgage issue was found in the read-only repository search; its returned Finances issue #162 concerns a different feature. A stable local requirement FH-MORTGAGE-001 and this reviewable implementation are recorded. Creating/publishing issue tracking or a draft PR is deferred to the parent under the explicit no-publication boundary.

## Shared-file integration

The parent should combine with Achats `1bae9197b14b2bc632b657eaa06c15e6a570041c`, preserving its changes. Potential shared-file conflicts: `package.json`, `apps/worker/src/index.ts`, `REQUIREMENTS.md`, `docs/ARCHITECTURE.md`. Mortgage also adds two CI test steps. Keep Achats' worker version/capability and source classification; Mortgage independently adds `mortgage-evidence-v1`, its own store/routes/conflict handling. Navigation edits are in `App.tsx`, `types.ts`, `domain.ts`; Achats did not edit those files. CSS adjusts the seven-tab mobile grid with enough specificity to preserve one row.

New feature modules: `apps/worker/src/mortgage-model.ts`, `mortgage-store.ts`; `apps/web/src/mortgage-api.ts`, `mortgage.css`, `views/MortgageView.tsx`; `scripts/mortgage-ingest.mjs`; model/HTTP/CLI fixtures/tests and the Mortgage browser script. Full ingestion schema, durability/backup/lock recovery, source profile and calculation assumptions are in `MORTGAGE.md`.

## Combined release follow-up

The original local-only report above is retained as preparation history. Kevin subsequently authorized combined Achats/Mortgage publication and deployment. The combined source uses worker2.26.10, records financial assumptions privately instead of shipping household defaults, and adds a16th focused test. The clean release branch is based directly on current main; the earlier local-only commits are not published. See ACHATS-MORTGAGE-RELEASE.md and Issue236 for current combined verification and release evidence. No daily scheduler is created by this executor.
