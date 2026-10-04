# Savings — issue #141

Implements `FamilyHub_Plan_Savings_2026-10-03.txt`. The main navigation is Claims / Documents / Savings / Other. Claims remains the root; existing `?view=invoices`, `desjardins`, `blue-cross`, `money` and other links remain valid. Documents groups navigation only, retaining three distinct source libraries and every existing claim action, correction and reconciliation.

## Usage and scope

Add a phone/internet, subscription, card-fee, car/home-insurance, mortgage or other recurring contract. Save partial information; the checklist requests missing prices, taxes/fees, requirements, review date, penalties and discounts. Existing active subscriptions and the entered mortgage are presented without rewriting their original stores. Recurring CSV merchants are candidates to confirm, not automatically accepted contracts.

Attach PDF/PNG/JPEG/text documents up to 5 MB each. Bytes stay in IndexedDB and are included in complete backup exports. Read documents and enter their facts; automated document extraction is not implemented. An attachment alone never proves coverage or costs. An earlier backup can restore records without document bytes; trying to download or export missing bytes reports the problem. Browser storage and exported financial backups are not encrypted.

Pair with worker **2.19.0 or newer**. Before starting a comparison, the UI shows the exact summary sent to the paired PC/Codex: category, recognized provider, province, numeric costs and comparison requirements. Custom provider names, contract names, notes, requirements text, discounts text, documents and transactions are excluded; requirements are reviewed locally. The local comparison signature is hashed before transmission. Unsupported workers are rejected before sending contract data, with update/restart guidance. Updating repository code does not update/restart an already installed PC worker.

Research is manual. The worker searches public current-provider offers and alternatives, bundles, eligibility discounts, recurring costs, promotions, membership/activation fees and conditions. Search instructions allow generic category/provider/province/product terms and prohibit entered financial amounts or identifiers. Offers need dated public HTTPS sources. No live research produces an empty report with an explanation; invalid output produces a saved failure. A report is not a personalized quote, eligibility confirmation, external action or proof of a complete market search.

Shortlisting saves a preference only. Provider disclosure/contact, quote requests, purchases, cancellations and switching are outside this release and require a separate explicit approval flow. No Savings schedule is registered. Existing invoice schedules are unaffected.

## Deterministic estimates

- Monthly normalization: annual / 12; weekly × 52 / 12. All-in taxes/fees must be confirmed for both prices.
- First-year net difference uses each current/alternative promotion duration and regular price, less baseline cancellation penalty, incremental alternative fees/membership and total annual discounts lost. The larger of the entered and researched total lost-discount estimates is used, so the same loss is not counted twice. Unknown costs remain unknown; enter zero explicitly where justified.
- Ongoing annual difference uses both post-promotion prices and lost discounts, excluding one-time fees. Promotions lasting beyond a year remain visible; this is the eventual regular-price comparison, not a promise about year two.
- Auto liability and collision/comprehensive deductibles must match exactly. Endorsements and other private requirements require a manual review. BC Optional discounts cannot be applied to the full Basic + Optional premium; without the appropriate base price an offer has no numeric savings.
- Mortgage estimates compare amortized **interest**, using Canadian fixed-rate semiannual compounding and identical amortization/term/rate type. Payment reductions are not savings. Variable rates, incomplete penalties or terms under 12 months yield no first-year total; second-year interest appears only for terms of at least 24 months. Borrower eligibility remains unverified.
- Offers expire after their stated validity date or 30 days without a fresh public check. Changing saved requirements or baseline invalidates the old shortlist. Negative differences remain negative.
- Totals accept only positive, reviewed, current comparable estimates. One alternative per affected contract is counted, preferring the largest first-year net value. Bundles touching unmodeled contracts are visible but excluded until complete household costs can be modeled; cross-contract bundle optimization is not implemented.

## Validation and release gates

`npm run test:savings` covers fees, promotions, unknown amounts, lost-discount duplication, mutually exclusive alternatives, auto limits/deductibles, expiry, mortgage calculations, privacy whitelisting, output validation, additive legacy reuse, concurrent request deduplication and restart persistence. Existing worker HTTP tests cover pairing/origin authorization of the new routes.

`npm run test:savings:browser` exercises the built PWA with synthetic data and a mocked worker at 320/390/768/1440 px: add/reload, local attachment, reviewed public-summary submission, job completion, shortlist calculation, invalidation after editing, three grouped document libraries, backup/restore and pairing-secret exclusion. Install Chromium with `npx playwright install --with-deps chromium` first. It contacts no real providers or private worker.

Typecheck/build, existing PWA/claims/invoice regressions and retained .NET checks remain required in CI. Installed-worker upgrade, real public-search output and physical-phone acceptance are separate release gates; synthetic/browser checks do not establish those results.
