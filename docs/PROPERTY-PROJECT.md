# Property project evidence backend (FH-PROPERTY-001)

Local implementation foundation; NOT deployed or connected to daily research.

- GET /property-project: paired private cards + immutable observation history.
- POST /property-project/observations: paired JSON, maximum 32 KB. Same ID/content replay is idempotent; changed content conflicts (409). A changed listing gets a new observation ID; prior facts remain intact. Latest observation is chosen by source observation time, not ingest order. Missing listings are not silently withdrawn.
- All source facts require HTTPS provenance and checked timestamp. Null is unknown, never zero or false. Unknown facts have null source/date and a short explanatory note.
- The four current criteria have equal weight: Lower Lonsdale, 3+ bedrooms, at most CAD 1.7M, two separate entrances. Percent is withheld until all four are known. Coverage is distinct. A hard mismatch remains explicit even if a partial percentage might look attractive. Cards older than 48 hours or future-dated are not marked available.
- Airbnb is unknown, conditional, or prohibited, with separately dated evidence. This is NOT permission to operate: municipal/provincial/strata and unit-specific conditions must all be checked. Entrances imply neither suite legality nor rental permission.
- Market opportunity is explicitly unscored. No fabricated valuation from asking-price averages. A subsequent comparative-market-analysis feature needs verified sold comparables, comparability and adjustment evidence, and sample/date coverage.
- primaryPhoto defaults to null. Optional HTTPS image URL includes originating listing URL, attribution and observation date. Backend does not download, proxy or scrape photos. Collector must establish permission to display; UI must fall back cleanly without an invented image.
- No schedule, collector, contact, offer, purchase, external upload, public bind or secret changed. Existing daily search must feed this endpoint only after its normal authorization, using stable listing IDs and new observation IDs. Do not create a parallel schedule.

## Remaining acceptance

UI not implemented. No live observations imported. Existing daily automation not connected. No production verification. Nine synthetic tests pass, including a real isolated worker HTTP check of pairing/origin, 32 KB body limit, idempotence, conflict handling and private readback. Worker TypeScript check passes. Full repository aggregate checks remain required before release. Public test data is entirely synthetic.

## Owner following and listing transitions

POST /property-project/following takes {requestId, listingId, followed, expectedRevision}. GET returns followingRevision, immutable followingHistory and followed on each card. New listings default to non-followed. Following is an owner decision, never inferred from a match score or overwritten by refresh. Request-ID replays are idempotent; stale revisions return 409. Follow/unfollow does not delete the listing/history. Independent listings are not automatically merged by address or photos; collectors must use stable MLS identity. Relistings need a separately reviewed identity link before inheriting decisions.

Market states are active, sold, withdrawn, unavailable or unknown. Every known market status requires statusEvidence with the exact status, direct source and checked date. HTTP errors/disappearance produce unknown, not sold. Missing listings from a later batch remain stored; an older delayed observation cannot replace the current version. The response includes dated/source-linked price and market-status changes. Refresh never alters owner decisions. Opportunity evaluation and follow state are separate.

Validation update: 13 tests pass including following POST authorization/409 readback, restart persistence, sold-to-unknown history, manual optimistic concurrency, request replay and older observation handling. TypeScript worker passes. This remains a tested backend foundation, NOT a production-ready end-to-end feature until collector, UI, main integration and release gates complete.
