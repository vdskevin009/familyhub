# Ingestion and reconciliation authority

FH-REIMB-042, issue #138. Worker 2.18.0. Repository regression scenarios use synthetic records; installed-worker rollout and real insurer/Gmail acceptance are separate.

## Persistence and source identity

The active pipeline stores the private `invoices.json` ledger through serialized, atomic writes. There is no SQL database/table migration. Gmail uses `recordId(normalized account, Gmail message ID)`. Blue Cross uses a claim/line ID when provided by the table, otherwise a hash of row facts plus occurrence. Desjardins uses claim ID plus service-line ordinal, with a fact-hash fallback. Existing record IDs and original Gmail references are retained. Different explicit claim IDs never become a single Blue Cross record through a business-key fallback.

`SourceIdentity` records the source, external ID, current record ID, account, original reference and identity strength. `IngestedAt` is the first known index timestamp, conservatively taken from the legacy update/received timestamp. It is not rewritten by later enrichment. Portal IDs identify source rows; insurer amounts, service dates, document dates and beneficiaries remain separate evidence fields.

When source IDs are unavailable, fuzzy similarity alone cannot prove an external identity. Blue Cross's existing unique business-key update remains available only to unprotected records; conflicting or multiple candidates block apply. The existing Desjardins exact/prefix historical checks do not change historical records. Repeated IDs in a portal batch are ambiguous and block financial apply. No production row is removed to resolve duplicates.

## Detection, matching and decision

Detection produces a proposed classification and extracted `Healthcare` facts. The deterministic reconciliation module produces associations, amounts and review reasons. Persistent user decisions provide authority over both. Agent reviews remain suggestions.

`ManualOverride: { Version: 1, Reasons: [...] }` explicitly records why automatic processing cannot replace a row. It is derived from all existing authority mechanisms:

| Mechanism | Protected decision |
|---|---|
| `ClassificationSource=manual`, `CorrectedAt` | Exact document classification and corrected record |
| `LastDecisionId`, active `decisions` | Status/classification history, including a manual default/Open state |
| `IgnoredAt`, `unmatchedDecisions` | Ignored document, case or insurer source |
| `matchDecisions` | Confirmed associations and rejected pairs, protecting both source records |
| `workflowRecords.ManualStatus` | Open/Closed/Ignore; history remains authoritative |
| `confirmedServiceDates` | Reviewed date, kept as a separate overlay over extraction |
| `Healthcare.FieldSources` containing manual/user | Corrected financial/date/beneficiary evidence |
| Non-default legacy `Status` | Conservative protection when old provenance is missing |
| Other explicit override reason | Reserved for extensions and retained unchanged |

The shared `automaticReplacement` policy returns the entire current record for protected rows, preserving money, beneficiary, attachments, notes, source links and unknown extension fields. Startup normalization, Gmail upgrades/retries, receipt repair, copied Blue Cross import and both portal planners use this policy or the same guard. Guards are rechecked inside serialized writes after asynchronous extraction/collection. Portal plans are recalculated inside the transaction to respect concurrent user actions.

Exact repeats of a protected portal row are unchanged. Contradicting changed facts block apply for review; no partial batch is applied. A protected row missing extraction fields is deliberately not reclassified to fill them. Learned category preferences on *new* messages remain distinct from an exact-record manual override.

Canonicalization may retain equivalent source references, but protected facts remain the canonical facts; incompatible protected financial sources stay separate. Manual associations are allocated first and reserved even if their target later disappears from the active view. The matcher cannot move them to a better candidate. Latest explicit rejection supersedes an older confirmation of the same pair. Multiple plausible insurer processing records stay unresolved; they cannot silently double the paid total. Corrected embedded allocations take precedence over differing imported payments, with an explicit conflict reason. Unallocated named-insurer payments never invent primary/secondary order.

Undo is an explicit user action. Only the latest active decision on a document can be undone; its predecessor and remaining override authority are restored. Reset to Automatic is likewise explicit. Automatic scans cannot reset either choice.

## Non-destructive JSON enrichment

Initialization adds authority and identity metadata without deleting/rekeying records, collections or unknown fields. Before the first write adding metadata, it writes the original saved object to a private `invoices.pre-authority-v1-*.json` backup. No email, credentials or private financial data is committed. The enrichment is repeatable; subsequent initialization does not rewrite an already normalized ledger. Read-only initialization enriches only memory and leaves disk byte-for-byte unchanged.

Uncertainty is stored in the separate versioned `reconciliationIssues` projection, preserving source/manual records. The snapshot includes compatible coarse `Reason` codes plus additive `DetailReason` and readable `Explanation`. Cases expose `ReconciliationReasons`. Codes distinguish missing invoice/reimbursement, beneficiary, source data, insurer/order, amount/date/service/currency mismatch, rejected association, unavailable manual target, plausible duplicates, several possible matches and manual allocation/source conflict. Existing UI details display the explanation; no workflow redesign is introduced.

The browser fallback retains local manual status/classification/money when rescanned or when a worker source first appears. Those rows remain locally controlled; this change does not silently upload browser decisions into the worker. Worker-managed rows use the worker's authoritative result. The retained .NET merge also skips fact replacement for explicit overrides, non-default legacy status or manual notes; an optional boolean field preserves old schema compatibility.

## Validation and limits

`tests/ingestion-preservation.test.mjs` exercises real collection/import functions, atomic JSON persistence, migration, restart, repeat apply, classification/status/money/association preservation and representative full-rescan cycles. Existing authenticated HTTP tests cover matching, workflow, ignore/restore and confirmed dates. Browser state tests verify rescan authority. The standard invoice suite includes these tests in CI alongside PWA, typecheck/build and retained .NET checks.

Sources without stable claim-line IDs still depend on conservative historical identity. Desjardins line ordinals can change when the portal reorders a multi-line claim; conflicting service facts require review rather than reassignment. Metadata cannot recover an undocumented old manual change with no surviving marker/history or evidence provenance; non-default statuses are protected conservatively. This implementation does not claim to have audited or modified the installed private ledger, authenticated portals or phone UI.
