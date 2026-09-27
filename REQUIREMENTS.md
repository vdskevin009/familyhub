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
| FH-REIMB-005 | Reimbursement history must be ordered by service date descending by default, across all reimbursement statuses. | Implemented | `ReimbursementsView` sorts the combined history before optional filters; missing service dates go last. |
| FH-REIMB-006 | Reimbursement history must support a compact filter surface for statuses/categories such as fully reimbursed/not reimbursed and primary/secondary. | Implemented | Baseline commit adds filterable app-like history. |
| FH-REIMB-007 | The history should remain complete and scrollable rather than hiding older invoices behind a reduced summary. | Implemented | All cases render in one scrollable list; optional filters start cleared. |
| FH-REIMB-012 | A rescan must not silently erase a previously found healthcare expense. Show one chronological line per expense, consolidating related source documents only with explicit shared-invoice or residual evidence. Show indexed invoices even when reconciliation omits them, retain missing past cases for review, and exclude stale amounts from current totals. | Implemented | Issue #25; worker source identity, stricter canonicalization, browser history retention and classifier-failure guard. A bounded, resumable 60-day recovery pass revisits Jane clinic receipts after the normal Gmail watermark and repairs a prior non-expense classification without overriding manual decisions. An extracted invoice/service can produce a reviewable expense when AI is unavailable or wrong. The actual missing September expense still requires a live PC worker/browser check. |
| FH-REIMB-008 | “Needs attention” should be minimized through better reconciliation logic, while uncertain cases remain reviewable rather than guessed. | Accepted | Quality goal; do not trade correctness for fewer warnings. |

## Local worker / automation

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-WORKER-001 | A local Node/TypeScript worker may perform deeper analysis and scheduled collection without requiring a paid hosted AI API. | Implemented | `apps/worker`. |
| FH-WORKER-002 | The worker must be paired securely and must not be exposed directly to the public internet. | Verified | Localhost default + pairing key; private HTTPS route required for phone access. |
| FH-WORKER-003 | Automatic watches/scans only run while the worker is running; the UI must not imply otherwise. | Verified | Current documented limitation. |
| FH-WORKER-004 | FamilyHub should support a local Windows agent runner that orchestrates specialized AI agents using real Codex/OpenAI model reasoning through the existing ChatGPT/Codex entitlement where technically supported, without requiring a separately billed hosted AI API for the initial implementation. | Implemented | Issue #23; existing Windows task and Codex SDK worker, with explicit roles in `agents/` and `apps/worker/src/agents.ts`. Installation and live Codex login still require verification on Kevin's PC. |
| FH-WORKER-005 | Scheduled reimbursement automation must separate deterministic collection/parsing/exact matching from AI reasoning and orchestrate the specialized flow **Invoice Collector → Reimbursement Reconciler → Needs Attention Reviewer**. | Implemented | Issue #23; `collectInvoices` → `buildReconciliationSnapshot` → `reviewReconciliations`, bounded to ten new uncertain cases per run. Suggestions cannot change assignments. |

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

## Durable classification and health-ledger rules

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-MAIL-005 | Routine GitHub/CI notifications, appointments, Cedar Hill booking messages, ordinary receipts and similar administrative mail must not be promoted to claims or “money to recover” unless the evidence actually supports that classification. | Accepted | Preserve conservative classification; corrections may refine future runs. |
| FH-MAIL-006 | Scheduled mailbox collection should ignore Sent/Drafts and other non-inbox noise by default unless a future requirement explicitly adds them. | Implemented | Current collector direction. |
| FH-REIMB-009 | The healthcare ledger must ingest the available family medical invoices and insurer statements, preserve original billed/reimbursed evidence, and provide refresh/import paths for missed records. | Implemented | PC collection plus targeted import/reconciliation paths exist. |
| FH-REIMB-010 | Missing dates, amounts, providers or insurer roles must remain unknown rather than be invented. “Needs attention” should be reduced through stronger reconciliation/deduplication, not by guessing. | Accepted | Current quality goal; keep ambiguous evidence reviewable. |
| FH-REIMB-011 | Low-confidence reconciliation candidates must receive a second AI review before being surfaced as Needs Attention; reconciliation output should preserve supporting evidence/confidence, and only genuinely unresolved or ambiguous cases should remain for Kevin to review. | Partial | Issue #23; bounded second Codex review returns evidence-linked suggestions and invalidates stale results. Failed/unprocessed cases stay visible, and AI does not resolve or suppress uncertainty automatically. Better precision needs real-data validation. |

## Historical collection and explicit exclusions (Issue #28)

| ID | Requirement | Status | Implementation notes |
|---|---|---|---|
| FH-REIMB-013 | Audit potential invoice messages from June 1, 2025 for every connected PC account, including archived and attachment-only messages, independently of the incremental watermark. Preserve resume cursors and expose coverage honestly. | Implemented | Issue #28; versioned frozen historical window, paginated Gmail search, sequential daily-run continuation, and coverage in Reimbursements. Historical intake indexes deterministic candidates and readable evidence before optional AI work; incremental collection retains Codex classification. Completion proves query traversal, not recognition of every invoice or insurance eligibility. Sent, Drafts, Spam, Trash and GitHub notifications remain excluded. Unreadable/image-only/oversize attachments require review. Live completeness remains to verify. |
| FH-REIMB-014 | Allow a reimbursement expense to be ignored and restored in the app; persist the exact grouped-source decision on the PC across collection and restarts without training a provider-wide exclusion. Keep evidence and remove ignored expenses from attention/totals. | Implemented | Atomic authenticated case action, per-document IgnoredAt, exact duplicate inheritance and collapsed Ignored expenses with Restore. Original statuses and sources remain stored. |
| FH-TECH-004 | Do not persist Gmail prompts, personal amounts or private identifiers in diagnostic logs from invoice classification/review. | Implemented | Private Codex CLI uses stdin and --ephemeral; stdout parsed in memory, stderr discarded, generic failures only. No new paid API. |

## Open questions / Needs confirmation

- None recorded at baseline. Add unresolved requirements here instead of guessing.

## Decision log

| Date | Decision | Result |
|---|---|---|
| 2026-09-26 | Establish `REQUIREMENTS.md` as the canonical requirement source for FamilyHub. | Accepted |
| 2026-09-26 | Baseline current requirements against commit `d85650e104075b08f58516ee147b7cb896f26687`. | Accepted |
| 2026-09-26 | Adopt a local AI-agent runner as the initial automation direction for reimbursement collection/reconciliation, using deterministic code plus specialized Codex/OpenAI reasoning agents before introducing a separately billed hosted Agents API. | Accepted |
| 2026-09-26 | Preserve historical invoice visibility across incomplete rescans, with stale results clearly marked and excluded from live totals. | Accepted |

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
