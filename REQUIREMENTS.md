# FamilyHub Requirements

This file is the canonical product-requirements source for FamilyHub. Code, README files, issues, chats and implementation notes are supporting evidence; when they disagree, update this file explicitly rather than silently guessing which behavior is intended.

## Reference state

- Bootstrap date: 2026-09-26
- Baseline branch: `main`
- Baseline commit: `d85650e104075b08f58516ee147b7cb896f26687`
- Baseline evidence: current code, `README.md`, architecture/docs and merged implementation history.

## Status model

- **Implemented**: present in the current product/code and expected to remain supported.
- **Planned**: accepted requirement not yet implemented or not yet verified in code.
- **Needs verification**: requested behavior whose implementation state is uncertain; inspect code/tests before changing status.
- **Superseded**: intentionally replaced; keep the decision and replacement reference.

## Working rules

1. Read this file before proposing or implementing a product change.
2. Compare the request with the current implementation before editing code.
3. Add or update the affected requirement before implementation; do not rely on chat history as the only record.
4. After implementation, update status, behavior and validation notes in the same PR.
5. Do not mark a requirement Implemented unless the code supports it and relevant checks pass.
6. If the code and this file conflict, flag the conflict and resolve it explicitly; do not silently rewrite history.
7. Record meaningful product decisions under Decision log.
8. Keep secrets, real family records, credentials, insurer exports and financial identifiers out of this repository.

## Product purpose

FamilyHub is a mobile-first household assistant. Features should primarily save time, prevent important misses, or reduce avoidable spending. The default experience is proactive and app-like rather than dashboard-heavy.

## Current requirements

### FH-001 — Mobile-first household assistant
**Status: Implemented**

- Provide a mobile-first PWA focused on household actions and prioritized information.
- Keep the Today/Assistant experience as the main entry point.

### FH-002 — Important Mail
**Status: Implemented**

- Surface time-sensitive and administrative mail prepared by the paired PC worker.
- Filter obvious marketing/noise conservatively.
- Preserve uncertain classifications for review instead of pretending certainty.

### FH-003 — Reimbursements and health-claim reconciliation
**Status: Implemented**

- Track paid, primary-insurer, secondary-insurer and outstanding amounts.
- Keep one status per expense and preserve unmatched/ambiguous evidence for review.
- Reconcile conservatively; do not auto-match ambiguous evidence.
- Respect the configured insurer order for household members.
- Keep decision history recoverable/undoable where supported.

### FH-004 — Reimbursement history usability
**Status: Implemented**

- Show reimbursement history as a browsable app screen.
- Present the complete available history rather than only a short recent subset.
- Order history by date descending by default.
- Provide filters for the meaningful reimbursement states/source dimensions supported by the model.
- Make the active filters and selected state visually clear.

### FH-005 — Daily PC collection
**Status: Implemented**

- Support an optional local worker for Gmail collection/classification and bounded document inspection.
- Keep low-confidence results in an explicit review state.
- Treat the scheduled PC scan as the authoritative mailbox-analysis path when a worker is paired.

### FH-006 — Truthful external actions
**Status: Implemented**

- Never present a simulated, heuristic, planned or suggested external action as completed.
- Keep irreversible/sensitive actions behind explicit confirmation.

### FH-007 — Google Drive administrative archive
**Status: Implemented**

- Allow selected Gmail attachments to be filed into FamilyHub-created Drive locations using limited `drive.file` scope.

### FH-008 — Household planning
**Status: Implemented**

- Support dinner planning, recipe storage, grocery-list generation and family tasks.

### FH-009 — Money tools
**Status: Implemented**

- Support local CSV transaction import, category summaries, recurring-merchant candidates, subscription review and Canadian mortgage scenario comparison.
- Do not present estimates as lender quotes or individualized financial advice.

### FH-010 — Local-first data and privacy
**Status: Implemented**

- Keep current household state browser-local unless a feature explicitly documents otherwise.
- Exclude access tokens and worker pairing keys from backups.
- Never commit real household data, credentials or financial identifiers.

### FH-011 — Opportunity radar
**Status: Implemented**

- Support saved research watches that the optional local worker can run while online.

### FH-012 — Improve inbox classification from corrections
**Status: Planned**

- Improve future classification using user corrections without unnecessarily sending or persisting full message bodies.

### FH-013 — Richer proactive household insights
**Status: Planned**

- Expand useful Today insights and routines while keeping the experience concise and action-oriented.

### FH-014 — Grocery price/opportunity inputs and assisted shopping
**Status: Planned**

- Add richer grocery/opportunity inputs.
- Keep assisted purchasing behind explicit user confirmation.

### FH-015 — Better recurring-cost and anomaly review
**Status: Planned**

- Improve recurring-cost detection and financial anomaly review without claiming certainty where only heuristics exist.

### FH-016 — Private mobile connectivity to the local worker
**Status: Planned**

- Improve private mobile connectivity without making the worker publicly reachable by default.

### FH-017 — Household sync
**Status: Planned**

- Add authenticated household sync only if it can preserve the local-first/privacy model.

## Validation expectations

For product changes, run the relevant subset of:

- `npm run typecheck`
- `npm run build`
- `dotnet run --project tests/Core.Tests -c Release`

Document any validation that could not be performed.

## Decision log

### 2026-09-26 — Requirements source of truth

- `REQUIREMENTS.md` becomes the canonical product-requirements register.
- ChatGPT/Work/Codex sessions must read it before implementation and update it when accepted behavior changes.
- Requirements are reconciled against the actual repository state, not copied blindly from old conversations.
