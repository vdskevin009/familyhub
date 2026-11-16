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

## Approved comparison scope

POST /property-project/comparison accepts two or three distinct listingIds, reads current stored observations only and causes no collection. Compare cards expose asking price, optional dated published monthly strata fee, source/market status/follow decision, and conditional Airbnb evidence. Budget headroom, asking-price reduction since first known observation, hypothetical negotiation and realized savings are separate fields; latter two remain null. Unknown fee is not zero. Missing tax, insurance, maintenance, financing and closing costs remain explicit. No total cost or expected Airbnb profit is invented. UI provides Tous / Suivis / Non suivis and concise comparison, not nested dashboards.

Production release gates: merge latest main, verify isolated private route behavior and synthetic regression suite, integrate owner-approved visual references, connect existing daily search without duplicate schedule, prove ingestion and independent readback, verify UI on phone and exact deployed commit. Changes remain local pending publication authorization.

## Existing daily research handoff

After the worker release exposes property-project-v1, the existing daily research may prepare a private JSON array of validated observations and call scripts/property-ingest.mjs. Preview (without --apply) performs no requests or writes. Apply requires the existing key file and paired endpoint, verifies health capability and baseline, checks all input conflicts before writing, and independently reads each persisted observation. Lost responses are never blindly replayed. No schedule is installed by this change, and no live handoff has run yet.

The consumer validates returned observations in the browser using a Node-free property-model module. No secret or private runtime path is shipped in the static PWA. Original source image display and new Following/Comparison visuals await reference-pixel verification and UI implementation; current approval of extended behavior is verbal, not approval of a final extended screenshot.

## Local UI verification (not deployed)

Original V2 PNG was inspected on kevinpc after source-to-destination SHA256 verification: bc6c9c06b8251f1f48349bc4e0a7c80966fade11065a17a92aa762e0d5ca765f. It drives colors, cards, address/direct listing link, evidence panel and photo fallback. Followed/non-followed, market status and multi-property comparison extend the verbally approved requirements; they have not yet been separately approved as final screenshots. Unlike the illustrative mockup, no price-coherent badge or fabricated comparable price band is shown without sold evidence.

Implemented UI: Projets container preserves existing Courses and Hypothèque destinations, adds Nouveau bien, and keeps Voiture explicitly unavailable pending implementation. Property view handles empty/offline states, source detail dialog, follow/unfollow with verified re-read, filters, two/three selection and comparison dialog. Private responses are not stored in browser localStorage. Import helper changes no schedule.

Synthetic browser acceptance at 390 and 1100 widths passes: no horizontal page overflow, following/filtering, dialog/Escape, comparison/close, offline last-state preservation, empty state, Projects navigation and browser Back. Screenshots are synthetic local QA only, not production evidence. Full cross-feature/browser aggregate checks and live collector handoff remain release gates.
