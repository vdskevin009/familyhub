# Mail scanner

The Gmail collector in `apps/worker/src/invoices.ts` runs read-only against separately consented accounts. Search only bounded document and important mail candidates, excluding Sent, Drafts, Spam and Trash. Filter promotions using deterministic evidence before Codex classification. Preserve source message IDs; store metadata and classification, not full message bodies or attachment bytes. A security or action message goes to Important Mail rather than the healthcare ledger unless it is also supported by healthcare evidence.
