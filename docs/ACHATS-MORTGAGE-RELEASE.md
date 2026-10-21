# Combined Achats and Mortgage release

Requirements: FH-GROCERY-010 ([#155](https://github.com/vdskevin009/familyhub/issues/155)) and FH-MORTGAGE-001 ([#236](https://github.com/vdskevin009/familyhub/issues/236)). Kevin explicitly approved publication and deployment of both features after verification. The parent retains ownership of the single daily rate automation.

The combined worker source is 2.26.10. It advertises both `grocery-source-type-v1` and `mortgage-evidence-v1`, preserving the previous capabilities. The combined script list retains both new browser suites. Seven mobile tabs remain on one row; existing navigation-count regressions now expect the Mortgage tab.

## Privacy and data preservation

Mortgage financial assumptions are private immutable worker records. Public source ships no household balance, current rate or remaining-amortization defaults. Missing private assumptions produce an explicit unavailable illustration. Real observations, dated quotes and assumptions remain outside Git. The release branch is prepared from current main as a clean combined commit, so earlier local preparation commits containing supplied working defaults are not published. Original local feature branches and their private initial evidence remain intact.

The installed worker has existing local source modifications. Its private candidate starts from that exact source and applies only the five feature files. The candidate compiles; every pre-existing compiled worker file except `index.js`, `grocery-model.js` and `grocery-extraction.js` is byte-identical. The two new files are `mortgage-model.js` and `mortgage-store.js`. Existing authentication/claim/insurer implementations and dependencies are preserved. Candidate HTTP tests exercise an isolated data directory and port, never the household installation.

Release installation must retain the existing loopback binding, private data directory, pairing key, origins, startup configuration and scheduled-task definitions. Take a private byte-verified backup, confirm idle collection, replace only the scoped source/compiled files and add the one-shot helper, then restart through the same executable/configuration. No credentials, access grant, policy change or new public endpoint is included. Back up and compare existing financial/source/manual state; natural background notification/log updates are distinguished from financial writes. Only reviewed initial Mortgage evidence is explicitly imported into its new private store after authenticated preflight.

## Local verification

Passed: JavaScript dependency install; both TypeScript checks; web/worker builds; 5 metadata/theme plus 97 product/UI tests; 16 Mortgage tests; 35 Courses tests; 24 Savings; 26 Finance Node plus 16 TypeScript; 21 Notifications; 237 invoice Node plus 53 TypeScript; 45 claim Node plus 3 transport tests. The installed-baseline candidate passes 11 focused grocery/model/HTTP and Mortgage HTTP checks.

The Mortgage and Courses/Achats browser flows pass at 320/390/768/1280, including Achats-to-Mortgage-to-Achats navigation, keyboard/disclosures, unavailable data, interrupted/repeated navigation, actual pack outlay versus normalized quantity, and zero real writes. Savings/Documents and notification browsers pass. Existing neutral theme checks pass 12 routes, four widths and both system preferences. Final Finances and full claim-browser acceptance are recorded in the release issue/CI when complete. Retained .NET is unavailable locally and remains a mandatory CI gate.

Screenshots are synthetic, never household source documents. Private initial records are imported separately through the authenticated contract in [MORTGAGE.md](MORTGAGE.md). No complete real competitor basket, final fulfilled receipt, physical-phone or screen-reader acceptance is implied by these tests.

## Release evidence and remaining gates

The issue threads and PR record the exact source head, required CI, main/Pages deployment, public-asset verification, installed-worker hashes and authenticated readback as those actions complete. Do not equate a local test, merge or successful push with deployment. Daily collection becomes operational only after the parent verifies the supported access route and activates its one owned automation; no second scheduler is created by this release.
