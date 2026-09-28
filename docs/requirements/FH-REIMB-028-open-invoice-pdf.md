# FH-REIMB-028 — Open invoice PDF directly from reimbursements

**Status:** Proposed

## User need
When a reimbursement expense already has an invoice PDF that FamilyHub collected and stored in Google Drive, the user should not have to search Drive manually to retrieve it.

## Requirement
The reimbursement card/detail must expose a direct action to open or view the associated invoice PDF from FamilyHub when that PDF is already available in the collected source evidence / Google Drive storage.

## Expected behavior
- Show a clear invoice action on the relevant reimbursement card/detail when an invoice PDF is available.
- Opening the action should take the user directly to the associated PDF, or display it in an in-app viewer if the implementation supports that safely.
- Do not show an active invoice action when no PDF is available.
- Preserve the existing reimbursement, reconciliation, workflow, confidence, and source-evidence behavior.
- Do not duplicate invoice files merely to support viewing; reuse the existing collected/stored document reference where possible.
- Keep the experience mobile-first and usable from the installed FamilyHub PWA.

## Scope boundary
This entry only documents the requested capability. No implementation is included in this change.

## Acceptance criteria
- [ ] A reimbursement with an available invoice PDF exposes an obvious open/view action.
- [ ] The action resolves to the correct invoice for that expense.
- [ ] The user can reach the PDF without manually searching Google Drive.
- [ ] Expenses without an available PDF do not show a misleading working action.
- [ ] Existing reimbursement matching/status/workflow behavior does not regress.
- [ ] Mobile/PWA behavior is covered when implemented.

## Tracking
- GitHub issue: #69 — Open stored invoice PDF directly from reimbursement cards.
