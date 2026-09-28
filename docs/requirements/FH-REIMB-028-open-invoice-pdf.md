# FH-REIMB-028 — Open invoice PDF directly from reimbursements

**Status:** Proposed

## User need
When a reimbursement expense already has an invoice PDF available to FamilyHub, the user should be able to open it directly without manually searching for the source document.

## Requirement
The reimbursement card/detail must expose a direct action to open or view the associated invoice PDF from FamilyHub when that PDF is already available through collected source evidence or another durable document reference.

## Expected behavior
- Show a clear invoice action on the relevant reimbursement card/detail when an invoice PDF is available.
- Opening the action should take the user directly to the associated PDF, or display it in an in-app viewer if the implementation supports that safely.
- Do not show an active invoice action when no PDF is available.
- Preserve the existing reimbursement, reconciliation, workflow, confidence, and source-evidence behavior.
- Do not depend on Google Drive specifically and do not duplicate invoice files merely to support viewing; reuse the existing durable document reference where possible.
- Keep the experience mobile-first and usable from the installed FamilyHub PWA.

## Scope boundary
This entry only documents the requested capability. No implementation is included in this change.

## Acceptance criteria
- [ ] A reimbursement with an available invoice PDF exposes an obvious open/view action.
- [ ] The action resolves to the correct invoice for that expense.
- [ ] The user can reach the PDF without manually searching the underlying storage/source.
- [ ] Expenses without an available PDF do not show a misleading working action.
- [ ] Existing reimbursement matching/status/workflow behavior does not regress.
- [ ] Mobile/PWA behavior is covered when implemented.

## Tracking
- GitHub issue: #69 — Open stored invoice PDF directly from reimbursement cards.
