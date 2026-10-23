# Proactive assistant: implementation and acceptance

Tracks #256 / FH-PROACTIVE-001..005. The private product audit is deliberately not committed.

## Data and decisions

The Today projection reads the same paired invoice, Savings, Finances, Courses and Mortgage APIs used by their domain sections. It uses the existing claim normalization/open predicate and financial guards. Browser legacy totals are not an authoritative fallback. Each domain can fail independently. Retrieval time is distinct from source time; refreshing the screen cannot refresh a bank statement or a public offer.

Opportunities are deterministic local projections. Their source facts, period, confidence, deadline, action and limitations remain available in a compact details disclosure. Exact view/record/tab targets retain the domain's own validation and human approvals. Unknown amount is null. Gross expense, insurer payment and possible residual are never relabelled as savings. A partial basket, unmatched quantities, missing fees/taxes, an indicative mortgage rate or unreviewed public candidate cannot become a personalized net gain.

Private opportunity decisions are a separate paired, revision-protected store. They carry an opaque identity and evidence fingerprint; no ledger or source document is altered. A changed fingerprint reopens the opportunity for review. Read/seen is distinct from resolved. Snooze expires by time; an absent source does not constitute completion. History counts interventions only, never savings or time saved.

## Operating loops

- Reimbursements: refreshed invoice/insurer evidence -> authoritative open case -> original invoice, primary/secondary insurer and duplicate guards -> precise case -> existing guarded preparation -> human consent/submission -> later payment evidence. No new submission operation.
- Insurance and recurring costs: shared contract/document dates and matching research -> approaching deadline or missing comparison facts -> current contract detail -> equivalent cover/service and all-in fee review -> user action with provider outside automation -> subsequent documented outcome. A quote request is not a received quote.
- Courses: active needs and existing comparison evidence -> missing trustworthy prices or valid comparable basket -> correct Courses tab/receipt -> local format/store/mode/quantity/availability/fee checks -> explicit shopper choice -> receipt evidence, without treating an order estimate as payment.
- Mortgage: dated public observations and private evidence -> scenario readiness/missing personal terms -> Mortgage detail -> compare matching term/type and net costs when complete -> explicit owner decision. Lower payment alone is not saved interest.
- Finances: dated imported bank coverage -> reviewable recurring charge or incomplete coverage -> source detail -> user confirmation. No live bank refresh is implied.

## Research cost and interruption controls

The existing Windows task and public-research whitelist are preserved. Stable successful comparisons are reused for seven days for subscriptions/telecom/other recurring costs, thirty days for insurance outside its sixty-day review window, weekly inside that window, and daily in the last seven days. Mortgage is weekly outside a ninety-day deadline window and daily inside it. Changed baseline fingerprint or explicitly expired offer requires new research. No quoted cost is promoted to a financial saving by reuse. A missing renewal date is not invented.

A new scheduled attempt remains deduplicated by the existing Pacific date reservation. After a lost response, one GET may recover only one new job for that contract/current scheduled date created at the attempted start. Ambiguity, wrong date or missing job stops safely. There is no POST retry. Poll errors and deadlines save a terminal status with only an allowlisted error kind/status/code. The runner records reused results separately and does not store error text, credentials or private request payloads.

## Notification policy

Cards, notification history and background tasks are distinct. Existing opaque Web Push and per-device opt-in are retained. The lifecycle extension preserves preferences, device registrations, silent baseline and permanent uncertain-send protection. Only fresh, actionable, changed events may be candidates. Shared snooze/resolution decisions are separate from read state. A Today insurance-renewal decision carries the exact contract and due date in its single atomic write; the existing notification scanner consults that decision before delivery. Snooze/resolve/dismiss suppress only that same renewal, restore removes the constraint, and a changed date is new evidence. This does not suppress other offers, payments, collections or commitment dates on the contract. Migration does not send the old backlog. The implementation's quiet-hour/daily budget applies only to automatic pushes, not in-app visibility or explicit test actions.

Provider acceptance is not confirmed handset receipt. Android/PWA still needs supported browser, notification permission, a subscribed device, reachable push provider and the PC worker running. The already-installed private HTTPS route and worker pairing remain unchanged. No push test or device enrollment is part of this release.

## Validation and release gates

1. Pure tests exercise authoritative claim totals, nulls, time periods, freshness, ranking, fingerprints, cadence and interruption recovery with fictitious evidence.
2. Store/API tests exercise revision conflicts, input bounds, corrupt data, backward compatibility, history and no replay; source financial files stay unchanged.
3. Mobile browser acceptance covers all five target widths, loading/partial error/unpaired states, exact deep links, lifecycle controls and old route access. Synthetic browser suites retain the existing domain safety net.
4. PR CI must pass typecheck, builds, domain/API suites, browser regressions and retained .NET tests. Merge is followed by successful main/Pages deployment and served release revision.
5. Installed worker activation requires an idle authoritative process, current protected-file hashes, saved current code, only intended source/dist/script updates, health/read-back and unchanged credentials, pairings, schedules and financial/manual records. No collection, rescan, portal preparation or push test for deployment validation.
6. Physical Galaxy S24 and naturally triggered schedule/notification outcomes remain separate observed gates. A desktop responsive viewport is not a physical-device receipt test.

## Outcome measurement

Measure stored action decisions and completed/reused/failed research jobs directly. Do not estimate money or minutes from those counts. Potential savings and claim residuals remain separate from actual savings and recovered cash. A future evidence-linked outcome ledger must reference a unique payment/contract change and its baseline, currency, period, fees and attribution; transfers/refunds/reimbursements cannot be counted again as savings. Available data does not establish complete realized savings, household recovered-cash coverage, API token billing or avoided minutes, so those measures remain explicitly unmeasured.
