# FamilyHub — Canonical Requirements

> **Source of truth for product requirements.** Read this file before changing the product. Update it whenever a requirement, decision, scope boundary, or implementation status changes.

## Baseline

- **Repository:** `vdskevin009/familyhub`
- **Default branch:** `main`
- **Baseline verified:** 2026-09-27
- **Code reference:** `8f16be3cc8a584c0e4bae071c1f15be07315a5ef`, [PR #41](https://github.com/vdskevin009/familyhub/pull/41), healthcare calendar/service repair and worker 2.5.4.
- **Baseline evidence:** green [PR CI](https://github.com/vdskevin009/familyhub/actions/runs/36340832272), green [main build/deploy](https://github.com/vdskevin009/familyhub/actions/runs/36340914123), public bundle verification and completed authenticated existing-worker collection/repair v4; acceptance recorded in [issue #40](https://github.com/vdskevin009/familyhub/issues/40). Phone visual acceptance and the next scheduled trigger remain separate.

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
| FH-REIMB-015 | Provider receipts with direct insurer adjustments must keep the gross healthcare expense, explicit primary/secondary insurer payment(s), and final patient balance as separate amounts. Subtotals before tax must not replace the gross expense or final balance. Existing recent Jane receipts must receive an amount-only repair pass that preserves classification, eligibility and manual decisions. | Implemented | Direct-insurer negative adjustments are extracted deterministically, gross expense is reconstructed only when explicit payment + residual arithmetic supports it, reconciliation consumes embedded insurer payments without double counting matched statements, and receipt repair version 3 re-reads recent Jane receipts without reclassification. |
| FH-REIMB-017 | When a provider receipt proves only a post-insurance patient residual and that an insurer processed the claim, but does not prove the gross expense or insurer payment amount, those unknown facts must stay null. The explicit residual remains the current outstanding amount, and later insurer evidence may enrich the same canonical expense without creating a duplicate. | Verified | Issues #38/#40; receipt-only and statement-enriched states pass synthetic regressions. The existing worker's completed v4 repair produces one canonical case from compatible original/forwarded receipts and uniquely matched insurer evidence, with the documented residual preserved. PC source/state acceptance passed; phone visual acceptance remains separate. |
| FH-REIMB-018 | Keep patient/member, healthcare provider, service type, service date and payment/statement date separate. Calendar dates must retain the source day in every timezone. Forwarding senders/cardholders must never become providers; when the clinic is unknown, show the documented service. | Verified | Issue #40; UTC formatting only for validated date-only labels (timestamps remain local), deterministic billed-appointment extraction from plain email and flattened PDF text, service metadata in canonical cases/UI and a structured adapter for legacy Desjardins rows. Six-timezone, source-shape and display regressions pass in CI. Public production bundle and authenticated existing-worker source/date/service/provider results verified at the baseline SHA. |
| FH-REIMB-019 | Reconcile legacy submitted/service evidence conservatively, preserve explicit zero payments, reject conflicting services and ambiguous candidates, and repair original/forwarded healthcare receipts without changing identities, classification, eligibility or decisions. | Verified | Issue #40; repair v4 spans the supported June-2025 history with resumable/resettable cursors and skips ignored records. Shared invoice identity groups compatible copies; primary evidence may supply the gross amount for secondary matching independently of source order. Insurer amounts cannot come from card payments or upcoming appointments. Private-source replay and completed installed-worker collection passed: no pending repair cursor/account error, all prior IDs, classifications, eligibility, ignore state, corrections and decisions preserved. |
| FH-REIMB-020 | Matching status must be independent from reimbursement completeness and from a generic document-level review flag. An insurer record is matched when it is confidently assigned to exactly one expense, even when payment is partial or explicitly zero; only insurer records with no confident active assignment belong in `Unmatched reimbursements`. Combined Benefits proceeds Primary → Secondary using the remaining balance without treating a partial primary payment as unmatched. A `NeedsReview` expense may auto-match only through strict deterministic corroboration: known member, exact service date, compatible service, exact embedded insurer payment equal to the insurer row, and a non-review insurer row. Its source review metadata remains unchanged. | Implemented | Issue #43; `buildReconciliationSnapshot` derives the unmatched projection from the final assignment graph. Exact insurer payments embedded in provider receipts can be corroborated by a later insurer row without double counting, including the live QubeCore shape with `NeedsReview=true` and confidence 85. Other reviewed expenses, reviewed insurer rows, service conflicts and tied candidates remain unmatched. Once strict corroboration succeeds, the reimbursement workflow may progress to secondary without rewriting the source review flag. Regression coverage locks 150 / 112 / 0 / 38 plus blocked non-corroborated review cases. CI/live acceptance pending. |
| FH-REIMB-016 | A previously detected/imported healthcare invoice must remain available in the underlying reimbursement history across newest-first sorting, temporary filters, reconciliation refreshes and partial worker snapshots. | Verified | Issue #35; the UI history now uses tested pure helpers backed by `mergeInvoiceItems`, `mergeReconciliationHistory` and `unreconciledInvoiceCases`. The regression test runs in the normal CI invoice suite. |

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
| FH-REIMB-013 | Audit potential invoice messages from June 1, 2025 for every connected PC account, including archived and attachment-only messages, independently of the incremental watermark. Preserve resume cursors and expose coverage honestly. | Implemented | Issue #28; versioned frozen historical window, paginated Gmail search, sequential daily-run continuation, and coverage in Reimbursements. Historical intake indexes deterministic candidates and readable evidence before optional AI work; incremental collection retains Codex classification. Completion proves query traversal, not recognition of every invoice or insurance eligibility. Sent, Drafts, Spam, Trash and GitHub notifications remain excluded. Unreadable/image-only/oversize attachments require review. Live source completeness requires a separate source-ID comparison; acceptance is tracked in #28. |
| FH-REIMB-014 | Allow a reimbursement expense to be ignored and restored in the app; persist the exact grouped-source decision on the PC across collection and restarts without training a provider-wide exclusion. Keep evidence and remove ignored expenses from attention/totals. | Implemented | Atomic authenticated case action, per-document IgnoredAt, exact duplicate inheritance and collapsed Ignored expenses with Restore. Original statuses and sources remain stored. |
| FH-TECH-004 | Do not persist Gmail prompts, personal amounts or private identifiers in diagnostic logs from invoice classification/review. | Implemented | Private Codex CLI uses stdin and --ephemeral; stdout parsed in memory, stderr discarded, generic failures only. No new paid API. |

## Open questions / Needs confirmation

- Issue #40: paired-phone visual acceptance remains separate from tests, private-source replay and installed-worker acceptance. Low-confidence or contradictory records remain reviewable.

## Decision log

| Date | Decision | Result |
|---|---|---|
| 2026-09-26 | Establish `REQUIREMENTS.md` as the canonical requirement source for FamilyHub. | Accepted |
| 2026-09-26 | Baseline current requirements against commit `d85650e104075b08f58516ee147b7cb896f26687`. | Accepted |
| 2026-09-26 | Adopt a local AI-agent runner as the initial automation direction for reimbursement collection/reconciliation, using deterministic code plus specialized Codex/OpenAI reasoning agents before introducing a separately billed hosted Agents API. | Accepted |
| 2026-09-26 | Preserve historical invoice visibility across incomplete rescans, with stale results clearly marked and excluded from live totals. | Accepted |
| 2026-09-26 | Align code reference with worker 2.5.3 at `a25e7f81f58c1796646fe276f148e01ab14ac1d4`: June history, exact Ignore/Restore, private analysis and Gmail quota recovery. Windows update/build and targeted restart preserved protected files, indexed sources and corrections; 37 synthetic tests plus worker/web builds and .NET CI passed. Paired-app acceptance remains open in #25/#28. | Implemented |
| 2026-09-27 | For direct-insurance provider receipts, treat gross expense, insurer adjustment and patient balance as distinct financial facts. Repair existing recent Jane receipt amounts without re-evaluating invoice eligibility or manual classification decisions. | Implemented |
| 2026-09-27 | Align canonical baseline to `df7c78df6e487f214c6063ffb36053ff026c7dc8`: direct-insurance receipt amount extraction/reconciliation and Jane amount-only repair merged after passing PR CI. | Verified |
| 2026-09-27 | Lock invoice-history visibility into regression coverage so sorting, filters, reconciliation refreshes and partial worker snapshots cannot silently remove an already indexed invoice. | Verified |
| 2026-09-27 | Align canonical baseline to `60325981169a6aeb155ab507bf8b13a03f40f375`: issue #35 invoice-visibility regression safety net merged after green PR CI; main build/test/deploy also passed. | Verified |
| 2026-09-27 | Preserve partial financial knowledge: a residual-only provider receipt may establish the patient balance and processed insurer while gross expense and insurer payment remain unknown until corroborating insurer evidence arrives. | Implemented; live acceptance pending |
| 2026-09-27 | Align canonical baseline to `e5087c2e76ef0cf9f8da0f4dabb0e6ad540046de`: issue #38 residual-only QubeCore/Jane handling merged after green PR CI; main build/test/deploy also passed. | Verified |
| 2026-09-27 | Issue #40: calendar-date display must preserve the source day; source appointment/service and clinic identity remain separate from patient, forwarding sender and payment metadata. Repair legacy receipt facts through a versioned collector pass, with service conflicts/ties left unresolved and zero payments kept known. | Implemented; CI and installed-worker acceptance tracked in #40 |
| 2026-09-27 | Align healthcare baseline to `8f16be3cc8a584c0e4bae071c1f15be07315a5ef` after green PR/main CI, verified public bundle and a completed normal collection on the existing worker 2.5.4. Mark FH-REIMB-017/018/019 verified against source/state evidence; preserve the separate phone and future scheduled-trigger acceptance boundaries. | Verified |
| 2026-09-27 | Issue #43: separate insurer-record matching from reimbursement completeness. Derive `Unmatched reimbursements` from final reconciliation assignments; partial and explicit-zero adjudications can be matched, and Primary → Secondary progression uses the remaining balance. | Implemented; PR CI/live acceptance pending |

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
