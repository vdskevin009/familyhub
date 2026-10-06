# Validated new insurer payments

Worker 2.22.0 supports an explicit local opt-in in the existing DataDirectory:

`insurer-collection-policy.json` contains `{"version":1,"autoImportNewPayments":true}`.

With this operator-approved policy, ordinary API collection (including the existing 04:00 task) records validated new positive payments automatically. It adds new source identities only, keeps changes to existing payments for review, refuses incomplete/ambiguous history, backs up the ledger and preserves manual decisions. It never submits insurer claims. Missing policy preserves the previous preview-only behavior; corrupt policy fails closed with an actionable error. Set the flag false to disable. Explicit `autoImportNewPayments:false` on an `apply:false` request guarantees a read-only API preview; low-level CLI previews also remain read-only. Explicit apply is unchanged.

Status separates `autoImported`, `pendingNew` and `pendingChanged`; scheduled reports include saved-new and pending counts. Phone display and first natural scheduled execution are separate acceptance gates.
