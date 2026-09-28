# FH-REIMB-028 — Open invoice PDF directly from reimbursements

**Status:** Implemented; live mobile acceptance pending

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
The card uses an existing archived PDF reference when available. Otherwise it retrieves the indexed expense PDF from the authenticated worker attachment endpoint and opens it in a new tab. The source attachment remains in Gmail; FamilyHub does not duplicate it. The action is hidden when no usable expense PDF reference exists. A live PWA opening test remains pending.

## Acceptance criteria
- [x] A reimbursement with an available invoice PDF exposes an obvious open/view action in the implementation.
- [x] The action selects the expense PDF rather than an insurer statement PDF.
- [ ] The user can reach the PDF without manually searching the underlying storage/source.
- [x] Expenses without an available PDF do not show a misleading working action in synthetic coverage.
- [x] Invoice selection does not change reimbursement matching/status/workflow behavior.
- [ ] Mobile/PWA behavior is covered when implemented.

## Tracking
- GitHub issue: #69 — Open stored invoice PDF directly from reimbursement cards.
