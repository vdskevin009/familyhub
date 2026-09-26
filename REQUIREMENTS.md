# FamilyHub — Canonical Requirements

> **Source of truth for product requirements.** Read this file before changing the product. Update it whenever a requirement, decision, scope boundary, or implementation status changes.

## Baseline

- **Repository:** `vdskevin009/familyhub`
- **Default branch:** `main`
- **Baseline verified:** 2026-09-26
- **Code reference:** `d85650e104075b08f58516ee147b7cb896f26687`
- **Baseline evidence:** current repository implementation and README at the code reference above.

## Requirement lifecycle

Statuses: `Proposed` → `Accepted` → `In progress` → `Implemented` → `Verified`. A requirement can also be `Deferred`, `Superseded`, or `Rejected`.

Rules:
1. New user requests must be added here before or with implementation.
2. Never mark a requirement `Implemented` only because it was discussed; confirm the code path exists.
3. Mark `Verified` only after the relevant checks/tests or a concrete acceptance check succeed.
4. When a newer explicit decision conflicts with an older requirement, keep both in history and mark the older one `Superseded`.
5. After implementation, update the requirement status, implementation notes, and code reference.
6. Do not invent missing business requirements. Record uncertainty under **Open questions / Needs confirmation**.
7. README/docs may explain the product, but this file owns requirement intent and status.

## Product principles

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-001 | FamilyHub must be mobile-first and behave like an app/PWA rather than a dashboard-heavy website. | Verified | React/Vite PWA is the active web target. |
| FH-002 | Every feature should primarily save time, prevent missed obligations, or reduce avoidable spending. | Accepted | Product-level decision. |
| FH-003 | The default experience should surface a small set of useful actions in **Today / Assistant**, with secondary information one tap away. | Implemented | Today/Assistant exists as the primary experience. |
| FH-004 | The UI must never claim that an external action succeeded unless it actually happened. | Accepted | Applies to purchases, claims, cancellations, unsubscribes, messages, bank connections and other external actions. |
| FH-005 | FamilyHub should remain local-first/privacy-conscious and must not commit real family records, credentials, account exports or financial identifiers. | Verified | Current architecture keeps sensitive state local and explicitly excludes secrets from backup/repo. |

## Important Mail

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-MAIL-001 | Important Mail must prioritize time-sensitive/admin messages and filter promotions/newsletters/noise. | Implemented | PC-agent classification is the authoritative paired-worker path. |
| FH-MAIL-002 | Low-confidence or ambiguous classifications must remain reviewable instead of being silently treated as certain. | Implemented | `À vérifier`/review flow exists. |
| FH-MAIL-003 | The scheduled PC scan should be the authoritative mailbox-analysis path when a worker is paired; browser scanning is fallback only. | Implemented | Current documented behavior. |
| FH-MAIL-004 | User corrections should progressively improve classification without requiring full email bodies to be sent away. | Accepted | Near-term roadmap/current learning direction. |

## Reimbursements

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-REIMB-001 | Reimbursements must be a separate healthcare reconciliation experience. | Implemented | Dedicated reimbursement screen exists. |
| FH-REIMB-002 | Show paid, primary-insurer, secondary-insurer and outstanding totals with one status per expense. | Implemented | Current reimbursement model. |
| FH-REIMB-003 | Reconciliation must be conservative: ambiguous matches must not be auto-linked. | Implemented | Unmatched/review queue is part of the current flow. |
| FH-REIMB-004 | Reconciliation must respect the configured Kevin/Jasmine insurer order and preserve an undoable decision history. | Implemented | Current documented behavior. |
| FH-REIMB-005 | Reimbursement history must be ordered by date descending by default. | Implemented | Baseline commit specifically updates reimbursement history ordering/UI. |
| FH-REIMB-006 | Reimbursement history must support a compact filter surface for statuses/categories such as fully reimbursed/not reimbursed and primary/secondary. | Implemented | Baseline commit adds filterable app-like history. |
| FH-REIMB-007 | The history should remain complete and scrollable rather than hiding older invoices behind a reduced summary. | Accepted | Canonical UX requirement from current product direction. |
| FH-REIMB-008 | “Needs attention” should be minimized through better reconciliation logic, while uncertain cases remain reviewable rather than guessed. | Accepted | Quality goal; do not trade correctness for fewer warnings. |

## Local worker / automation

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-WORKER-001 | A local Node/TypeScript worker may perform deeper analysis and scheduled collection without requiring a paid hosted AI API. | Implemented | `apps/worker`. |
| FH-WORKER-002 | The worker must be paired securely and must not be exposed directly to the public internet. | Verified | Localhost default + pairing key; private HTTPS route required for phone access. |
| FH-WORKER-003 | Automatic watches/scans only run while the worker is running; the UI must not imply otherwise. | Verified | Current documented limitation. |

## Planning, money and archive

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-PLAN-001 | Support dinner planning, recipe library, grocery-list generation and household tasks. | Implemented | Current Plan area. |
| FH-MONEY-001 | Support local transaction CSV import, category summaries, recurring-merchant detection and mortgage scenario comparison. | Implemented | Current Money area. |
| FH-MONEY-002 | Financial outputs are estimates/candidates, not lender quotes, guaranteed savings or confirmed subscriptions. | Verified | Explicit product limitation. |
| FH-ARCH-001 | Allow selected Gmail attachments to be archived to sensible FamilyHub Google Drive folders using limited permissions. | Implemented | `drive.file` scope model. |

## Architecture / delivery constraints

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-TECH-001 | Active web target is React 19 + TypeScript + Vite PWA in `apps/web`; retained .NET/Blazor code is not the Pages deployment target. | Verified | Current repo architecture. |
| FH-TECH-002 | Main-branch delivery must typecheck/build the React PWA and worker and run retained .NET regression checks before deployment. | Verified | CI workflow currently documents this contract. |
| FH-TECH-003 | Current design should not require paid hosting, a hosted database or a paid AI API. | Accepted | Core architecture decision. |

## Open questions / Needs confirmation

- None recorded at baseline. Add unresolved requirements here instead of guessing.

## Decision log

| Date | Decision | Result |
|---|---|---|
| 2026-09-26 | Establish `REQUIREMENTS.md` as the canonical requirement source for FamilyHub. | Accepted |
| 2026-09-26 | Baseline current requirements against commit `d85650e104075b08f58516ee147b7cb896f26687`. | Accepted |

## Maintenance checklist

Before implementing a change:
- Read this file and identify affected IDs.
- Add a new ID if the request is new.
- Record conflicts or superseded behavior explicitly.

After implementing:
- Update statuses and implementation notes.
- Run the relevant build/tests/acceptance checks.
- Update the baseline/reference commit when the change is merged.
- Keep README/docs aligned, but do not use them as a substitute for this file.
