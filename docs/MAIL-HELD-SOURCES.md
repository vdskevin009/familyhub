# Invoice held sources and recovery

Issue #309; FH-MAIL-009, FH-MAIL-008, FH-UX-002 and existing insurer login/manual-authority contracts.

## Problem and intended behavior

The plugin adapter previously required every original in a bounded mail batch. A valid external calendar attachment reported as unsupported by the connector therefore stopped all invoices before application. The supported invoice path needs durable, explicit incomplete-source accounting rather than a discarded attachment, fabricated original or silent OAuth fallback.

A validated held message retains its exact identity, attachment metadata and all applicable purposes (ordinary, historical or health-amount repair). Other supported messages can proceed through the existing collector. Malformed or conflicting evidence still rejects the batch. Unsupported originals are never requested from a tool that explicitly cannot read them. Grocery and other consumers keep whole-batch validation.

## Invariants

- Enumeration progress and verified coverage are separate. New mail remains discoverable while unresolved identities remain held.
- Held IDs enter bounded exact retries independently of search results and survive restart. Every original purpose is preserved and replays in the existing upgrade, retry, incremental, repair, history order. Overlapping purposes must produce the same active-versus-historical result as an immediately available source, and cannot repeat a consumed retry stage.
- Manual financial records, corrections and decisions are preserved. A held source is recorded even when an existing manual record would otherwise short-circuit processing.
- A hold is removed only after its exact source is fully available and processing succeeds. Missing or malformed retry evidence does not clear it.
- Unresolved holds prevent promotion of complete-success dates and verified watermarks. The paired UI reports the held count and partial coverage.
- Held-only work does not request automatic continuation; retries occur on a later requested/scheduled pass.

## Source messages

A failed or stale insurer read, a complete read needing matching review, and an unapplied preview are distinct states. Their compact labels retain this distinction; full evidence remains accessible. No error implies expired credentials without authentication evidence.

## Verification and activation

Local verification passed: the full invoice/worker regression command, worker compilation, combined typechecks, plugin-only web build, PWA regressions, 10 held-source integration scenarios, 37 collector planning/manual-preservation checks, 32 source-presentation tests, and paired browser checks at 320/390/1440px. The integration scenarios compare recovered overlapping purposes against the available-source baseline, including a still-unavailable classifier. Full CI and installed activation are tracked separately in issue #309.

A controlled read recovered both insurer histories without applying preview records or changing existing financial records; this does not prove the next natural scheduled run. The connector explicitly reports one calendar-original MIME type as unsupported. Holding that source does not claim its original was retrieved or its content classified.

Worker activation uses a candidate built from the authoritative installed source plus reviewed narrow patches. Protected-state and current code hashes, task definitions, idle/lock checks, code-only rollback and authenticated poststart readback are required. No private source content belongs in this repository. Live operation and future natural runs are reported separately from synthetic tests or CI.