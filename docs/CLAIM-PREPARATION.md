# Assisted claim preparation

Issue #110 adds **Prepare claim** to an original open healthcare expense when the paired worker is version 2.12.0 or newer. Insurer-only projections need the original invoice first.

Choose Desjardins or Blue Cross. The worker shows source-backed patient, provider, service, date, original amount, available PDFs and email links. Missing fields stay unknown. It checks the current local ledger, including recorded zero-payment decisions, direct insurer processing and possible same-day pending claims. These checks cannot establish complete current portal history. A recorded or possible duplicate blocks preparation. Review the insurer's current history yourself before checking the acknowledgement to continue.

**Open preparation window on PC** opens a separate visible browser on the computer running the worker. Sign in if necessary, then open the insurer's claim form. FamilyHub can reuse existing privately stored insurer cookies, but does not save new credentials. Sessions expire after 30 minutes. Close an existing preparation window before starting another.

Use **Read current form fields** after opening the form and after each step. The helper reads visible labelled fields and the actual select options from that insurer. Exact service-label matches can be suggested; other mappings require your selection. Social Worker and Clinical Counsellor are not aliases. Unknown labels and text-based date masks remain manual. Original invoice service evidence is retained unchanged.

Review the values in FamilyHub, select the intended source PDF if a document field is available, then choose **Fill reviewed fields**. FamilyHub fills only those values and attaches only that PDF. It refuses stale form revisions and values that changed after inspection. Check the insurer window and click Next yourself. FamilyHub never clicks Next, Submit, or an attestation. It stops on recognized final-review screens; there is no submission API. A completed preparation is not a submitted claim.

Live portal login, labels, controls and full journeys need validation independently for both insurers. A layout change or unsupported control leaves the field manual; the helper must not guess. Synthetic validation does not prove that a real insurer flow passed.

## Connected-mailbox intake

`POST /invoices/import-connector` accepts an explicitly authorized normalized Gmail source message and its original PDF bytes, with `apply: false` for a non-mutating preview or `apply: true` for import. It uses the existing pairing and origin checks. The input includes an account, label, and exact `since` inclusive / `through` exclusive timestamps with timezone. Connector access tokens are never supplied to FamilyHub.

The worker validates source identity, excluded folders, dates, metadata, size and PDF bytes. Original files are stored under content hashes in the existing private DataDirectory and served through the existing authenticated attachment route. The existing classifier and reconciliation retain original financial evidence; account ownership is not patient identity. Existing source IDs are skipped, so reruns do not overwrite corrections or manual statuses. A failed classifier is reported as `analysis-unavailable`, not silently treated as a non-invoice. Imports serialize with collection and use the existing mutation queue and ledger backup.

Search traversal, candidate recognition, original file retrieval and actual ledger import are separate acceptance checks. The PC Gmail scheduler remains configured only for its existing authorized accounts; this operation does not install connector credentials or start a full rescan.

Emails with multiple PDFs require `invoiceAttachmentId`: send only the selected original PDF in `files`, retaining the complete original message metadata. Each selected attachment has a stable separate record identity while its source email remains unchanged. Classification reads that PDF alone, preventing other patients, receipt amounts or treatment handouts in the email from being combined into one expense.
