# FH-REIMB-028 — Open invoice PDF directly from reimbursements

**Status:** Implemented — live phone/PWA acceptance pending

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
FamilyHub now prefers an already archived/durable PDF reference when available and otherwise reuses the worker’s existing authenticated attachment retrieval for worker-managed expense PDFs. No public document URL, new storage provider, Gmail rescan, or document migration is introduced. Multiple plausible PDFs are presented as a compact choice rather than guessed. Live phone/PWA validation with a real private worker PDF remains the final acceptance gate.

## Acceptance criteria
- [x] A reimbursement with an available invoice PDF exposes an obvious open/view action in the implemented code path.
- [x] The action resolves only from the expense source documents and prefers a durable Drive reference when present.
- [x] Worker-managed PDFs can be reached through the existing authenticated attachment endpoint without manually searching Gmail.
- [x] Expenses without an available PDF do not show a misleading working action.
- [x] Existing reimbursement matching/status/workflow behavior remains unchanged by the PDF resolver.
- [x] Multiple PDFs produce a compact chooser rather than an arbitrary selection.
- [ ] Validate a real private worker PDF from the installed phone PWA before marking the requirement Verified.

## Tracking
- GitHub issue: #69 — Open stored invoice PDF directly from reimbursement cards.
