# FamilyHub supervisor

Runtime: the existing Windows scheduled task calls the local worker's `/invoices/collect` endpoint. The worker orchestrates the roles below; these files describe their boundaries. The local PC must be awake, signed in, connected to Gmail and authenticated in Codex. No hosted API key is required.

1. Invoice Collector indexes both consented Gmail accounts, deduplicates and resumes interrupted windows. It never submits a claim.
2. Reimbursement Reconciler creates deterministic expense and insurer evidence links. Ambiguous records remain unmatched.
3. Needs Attention Reviewer uses an independent, bounded Codex pass on uncertain records and returns a validated suggestion with evidence IDs.
4. The PWA retrieves the snapshot through the paired worker and labels agent output as a suggestion.

Never treat a model suggestion as a confirmed reimbursement or silently alter the ledger. Failures leave cases visible for review. Account errors and stale reviews must be visible or omitted, never represented as successful analysis.
