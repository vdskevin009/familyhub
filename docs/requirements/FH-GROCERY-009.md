# FH-GROCERY-009 — Household catalogue and cheaper alternatives

Status: Testing (draft, no deployment). Issue #155. Product direction approved on 2026-10-13 replaces the first-screen weekly preparation and the cancelled PR #212 direction. PR #212 must not be resumed or merged.

Courses starts with **Catalogue**, all saved household articles including inactive/unpriced ones, confirmed products from reviewed nonduplicate receipts, and separately imported PCExpress snapshot references. Two independent compact controls show/hide article comparison rows and choose all products/current PCExpress basket. Search combines with both. Unknown brands/formats stay unknown; all observed identities remain accessible. Confirmed saved cadences are retained; new receipt/cart-only products have unknown cadence. Neither a basket nor a receipt invents stock, consumption or a frequency. Existing needs/price editors remain under Sources et outils; structured retailer informational details and Après achats receipt access remain intact.

**Moins cher ailleurs** (Target) groups cheaper articles by store, with `(Superstore unit rate - alternative unit rate) / Superstore unit rate × 100`. Both references must be reviewed, available according to source, in the same known mode, currency, physical dimension/label capacity and confirmed locality, with dated observations no older than seven days. Exact product identities must match, or the alternative must be an explicitly reviewed substitution, permitted by the household and accompanied by a quality/match note. The lowest compatible Superstore reference is used when multiple formats exist, preventing an inflated saving. Zero/missing Superstore rates, stale/receipt/future/expired evidence, incompatible units/quality/modes and unknown availability cannot produce a recommendation. A tiny saving never rounds to zero. The article percentage excludes order fees; available dates/modes are visible and fee/source details are folded. No whole-order winner, guaranteed saving, invented coffee discount, order, cart mutation or provider action.

## Separate PCExpress snapshot contract

The frontend accepts a manually imported private JSON file under Sources et outils. It stays in the existing scoped IndexedDB grocery cache, key `<endpoint>:pcexpress-cart-snapshot-v1`, separate from the planning draft and PC plan. It is neither uploaded nor included in a planning save. Reading the catalogue calls only existing authenticated GET `/groceries/planning` and GET `/groceries`. This PR changes no worker, API, security, persistent PC schema or installed runtime.

```ts
type PCExpressCartSnapshot = {
  schema: 1;
  source: "pcexpress";
  capturedAt: string; // dated ISO timestamp of the observed basket
  complete: boolean; // true only after all visible basket lines were captured
  items: Array<{
    itemId: string | null; // exact existing plan ID, when reviewed; never fuzzy
    product: string;
    brand: string | null;
    size: number | null;
    unit: "g" | "kg" | "ml" | "l" | "each" | null;
    quantity: number | null;
  }>;
};
```

Bounded to 300 lines/500 KB. Unknown values are `null`. A complete snapshot at most 24 hours old is eligible for **Panier PCExpress actuel**. Old/partial/future/missing snapshots yield an explicit unavailable state instead of substituting `ShoppingItem.active`, `basketQuantity`, a proposed weekly list or inferred stock. Snapshot quantity is not copied into household needs. A complete empty snapshot means an empty basket. An unknown association remains a separate visible article; no existing article is removed. Files must contain only the necessary product facts, never cookies, credentials, addresses or account details; unrelated fields are stripped.

The existing planning save validator still has its 60-article limit. The frontend catalogue reader admits up to 300 saved articles using the existing validators in chunks with cross-chunk duplicate/orphan checks; it can read larger synthetic plans without dropping articles or prices. Display union also supports additional receipt/cart-only articles without a plan replacement or destructive migration. PC save/editor limit upgrades are outside this frontend change; no plan replacement or worker installation is performed. This device-local snapshot is not yet shared to other phones by the worker.

## Verification

Synthetic model tests cover every inactive/unpriced article, >60 display union, receipt-only/cart-only products, confirmed cadence preservation, combined filters, actual membership independent of weekly flags, malformed/incomplete/stale/future/empty snapshots, missing/zero reference, g/kg and ml/l conversion, quality/substitution/locality/mode/currency exclusions and exact Superstore percentages. Browser acceptance exercises 320/390/412px catalogue/comparison/Target, private snapshot import/reload, search/filter combinations, details Return/Escape and focus restoration, sources, receipt navigation, unavailable PC and no horizontal overflow, no external calls and no PC writes. Captures are synthetic and stored in ignored `artifacts/groceries/catalogue/` for CI evidence. Final-head CI, parent visual approval, real private import and physical phone acceptance remain separate gates.

Local acceptance: both typechecks and full build pass; 81 product/PWA tests plus five metadata/theme tests, 31 Courses model/API regressions, 24 Savings, 42 Finances and 21 Notifications tests pass. Existing receipt/planning/retailer-card/common-basket browser suites and the new catalogue mobile suite pass, with zero writes/external calls in the catalogue suite. Theme/navigation passes 12 routes × four widths × two system preferences. Local .NET SDK is unavailable; retained .NET verification is required in draft-PR CI. Main baseline `316124d8bf169c07d2b7ab5909dee4a60c387cda` has successful CI/Pages run [38367764558](https://github.com/vdskevin009/familyhub/actions/runs/38367764558), and its public index responds HTTP 200. This is baseline evidence, not deployment of this draft.
