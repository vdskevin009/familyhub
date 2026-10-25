# FH-GROCERY-011 — PC Express confirmation intake

Status: local implementation; synthetic end-to-end and HTTP validation passed. Related existing issue: #155.
No deployment, merge, public publication, new schedule or private import is implied.

## Local validation

The eight grocery/parser/store/collector/daily-runner regression files pass 85 synthetic tests. The full MIME test uses the production parser, collector and durable store with fake Gmail adapters; it verifies restart, no replay, estimated amounts and decoded source privacy. The real-worker HTTP fixture uses an ephemeral loopback port, a temporary data directory and a synthetic pairing key. It covers origin/key rejection, no-store, read-only collection status, missing-Gmail setup failure without imported purchases, existing review/source flows and restart. Its child process is awaited on shutdown before bounded directory cleanup. Startup failures now expose bounded diagnostics rather than only a readiness timeout.

These checks do not establish acceptance of real Gmail MIME or of the next installed scheduled run. Private MIME files were not retained. No production service or credential is required by these synthetic tests.

## Required behavior

The existing daily worker runner also reads PC Express Gmail evidence through the existing read-only Gmail authorization. This is a separate collection from invoice indexing, with its own status, cursor and errors. A failure in either phase must not silently suppress the other. No merchant login, shopping cart, purchase, new scope, credential or security configuration is involved.

Only the specifically observed sender and complete supported confirmation layout can supply product quantities and the explicitly estimated order amount. A matching delivery message from the same account and exact order reference is required for automatic recording. Missing/ambiguous evidence, unsupported layouts and multiple conflicting confirmations remain unresolved. Full MIME evidence is parsed before any generic text truncation. Product line totals printed as zero placeholders stay unknown; unit-price estimates do not become paid line amounts. Dates use the message's actual timestamp and explicit America/Vancouver local calendar date; retrieval time is never a source date.

Imported records remain `sourceType: confirmation`, excluded from paid monthly totals. `automaticImport` records the collection provenance; `reviewedAt: null` explicitly means no human review. A subsequent confirmed manual review sets that timestamp. Private retained source files are explicitly labelled structured Gmail excerpts, not original emails; addresses, cards, tracking links and marketing are excluded. The two-source identity remains inspectable.

## Preservation and resumption

Append under the same GroceryStore queue as manual edits. Exact order/source identity prevents repeated imports, including response loss or a crash before the collection cursor is persisted. Never replace an existing legacy/manual/automatic record. A unique saved, reviewed, non-duplicate record with the exact order reference is acknowledged as unchanged, including the manual catch-up: its corrected facts and original sources remain byte-identical. Drafts, ambiguous identities, source collisions, or changed evidence for an unreviewed automatic record remain conflicts. No planning, invoice, mortgage or other domain data is changed.

Freeze collection windows, persist pending evidence separately and commit page cursors only after successfully processing a complete page. A pagination limit is incomplete, not success. Gmail read retries use the existing bounded helper. An uncertain mutation response is never automatically replayed by the runner. Pair evidence only after finishing the window's pages, independently for each account. Pending incomplete pairs survive subsequent runs under explicit storage limits.

## Delivery gates

Before release, integrate this narrow patch into the current source branch and preserve newer installed changes. Do not copy the entire preparation snapshot onto the existing installation. Coordinate installed collector/model/store/runner changes; older workers that reject saved records with null `reviewedAt` cannot read newly imported automatic records. An operator-reviewed rollback/migration plan is required before activation; never silently rewrite automatic provenance as human review.

Verify pairing/origin authorization, authenticated health capability `grocery-collection-v1`, read-only collection status, an authorized paired collection, persistence/read-back and duplicate replay. Verify the next natural scheduled run separately. Existing Windows schedule and security settings are unchanged. Private live acceptance and handset display remain separate from synthetic tests.
