# FH-GROCERY-009 — Household catalogue and cheaper alternatives

Status: Testing (draft, no deployment). Issue #155. Product direction approved on 2026-10-13 replaces the first-screen weekly preparation and the cancelled PR #212 direction. PR #212 must not be resumed or merged.

Courses starts with **Catalogue**, all saved household articles including inactive/unpriced ones, confirmed products from reviewed nonduplicate receipts, and separately imported PCExpress snapshot references. Two independent compact controls show/hide article comparison rows and choose all products/current PCExpress basket. Search combines with both. Unknown brands/formats stay unknown; all observed identities remain accessible. Confirmed saved cadences are retained; new receipt/cart-only products have unknown cadence. Neither a basket nor a receipt invents stock, consumption or a frequency. Existing needs/price editors remain under Sources et outils; structured retailer informational details and Après achats receipt access remain intact.

**Moins cher ailleurs** (Target) groups cheaper articles by store, with `(Superstore unit rate - alternative unit rate) / Superstore unit rate × 100`. Both references must be reviewed, available according to source, in the same known mode, currency, physical dimension/label capacity and confirmed locality, with dated observations no older than seven days. Exact product identities must match, or the alternative must be an explicitly reviewed substitution, permitted by the household and accompanied by a quality/match note. The lowest compatible Superstore reference is used when multiple formats exist, preventing an inflated saving. Zero/missing Superstore rates, stale/receipt/future/expired evidence, incompatible units/quality/modes and unknown availability cannot produce a recommendation. A tiny saving never rounds to zero. The article percentage excludes order fees; available dates/modes are visible and fee/source details are folded. No whole-order winner, guaranteed saving, invented coffee discount, order, cart mutation or provider action.

## Separate PCExpress snapshot contract

The frontend accepts a manually imported private JSON file under Sources et outils. It stays in the existing scoped IndexedDB grocery cache, key `<endpoint>:pcexpress-cart-snapshot-v1`, separate from the planning draft and PC plan. It is neither uploaded nor included in a planning save. Reading the catalogue calls only existing authenticated GET `/groceries/planning` and GET `/groceries`. The bounded planning-limit extension below changes validation/capability reporting only; security, persistent PC schema and installed runtime are unchanged.

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

Catalogue, editor and worker now share the same validator with a maximum of 300 saved articles. Display union also supports additional receipt/cart-only articles without an automatic plan replacement. This device-local snapshot is not yet shared to other phones by the worker.

## Bounded planning compatibility

The extension retains `schema: 1`, the same `ShoppingItem`, retailer, price and evidence fields, the same private `groceries/planning.json` and scoped device draft. Only the item-array maximum changes from 60 to 300; retailer/mode maximum 16 and price maximum 300 remain. Required/optional fields, unknown/null values, confirmed cadences, preferences, sources, approvals, selected flags, basket overrides and validation rules are unchanged. There is no migration, automatic merge, frequency derivation or import. `expectedRevision` and serialized atomic saves retain their previous replacement/conflict semantics.

Worker source version is **2.25.3**, advertising `grocery-items-300-v1` alongside existing capabilities. Only POST `/groceries/planning` uses a 10,000,000-byte JSON budget instead of the generic 100,000-byte budget, accommodating bounded larger plans and escaped source strings. Other request bounds, authentication, allowed origins, localhost listener and error handling are untouched. Over-budget requests and over-300 arrays are rejected before persistence.

The frontend permits legacy plans of at most 60 items on worker 2.25.2 with its existing `grocery-weekly-v1` support. Before sending an expanded plan it requires the new capability; an older PC receives no POST and the entire dirty draft remains cached across reloads. Worker 2.25.3 reads and saves existing schema-1 plans without changing their fields. Worker 2.25.2 cannot validate a saved plan exceeding 60; a rollback after expansion needs the pre-expansion backup, not truncation. Coordinate the new web and worker code before an expanded private import. This task does not install, restart or alter any running worker/private store.

## Verification

Synthetic model tests cover every inactive/unpriced article, >60 display union, receipt-only/cart-only products, confirmed cadence preservation, combined filters, actual membership independent of weekly flags, malformed/incomplete/stale/future/empty snapshots, missing/zero reference, g/kg and ml/l conversion, quality/substitution/locality/mode/currency exclusions and exact Superstore percentages. Browser acceptance exercises 320/390/412px catalogue/comparison/Target, private snapshot import/reload, search/filter combinations, details Return/Escape and focus restoration, sources, receipt navigation, unavailable PC and no horizontal overflow, no external calls and no PC writes. Captures are synthetic and stored in ignored `artifacts/groceries/catalogue/` for CI evidence. Final-head CI, parent visual approval, real private import and physical phone acceptance remain separate gates.

Initial local acceptance: both typechecks and full build pass; 81 product/PWA tests plus five metadata/theme tests, 31 Courses model/API regressions, 24 Savings, 42 Finances and 21 Notifications tests pass. Existing receipt/planning/retailer-card/common-basket browser suites and the new catalogue mobile suite pass, with zero writes/external calls in the catalogue suite. Theme/navigation passes 12 routes × four widths × two system preferences. Initial head `0d87be7` passes [exact CI 38441719212](https://github.com/vdskevin009/familyhub/actions/runs/38441719212), including retained .NET and all browser/invoice checks; deployment is skipped. The subsequent limit extension is tested with arbitrary synthetic legacy/expanded/300-item plans, strict validation beyond index 60, atomic restart round-trip, stale/invalid-save byte preservation, a real isolated-worker API body exceeding 100 KB, rejected item/body bounds, and an editor save/reload with old/new capability gates. Final extension CI remains required. No installed-worker or deployment acceptance is inferred.

Expanded-limit local acceptance: typechecks/full build, all 34 Courses model/API tests and 82 product/PWA tests pass. The complete Courses browser suite also passes, including the new 300-item editor read/edit/save/reload flow, full dirty-draft preservation on an older capability set, no unsupported POST, and new-capability round-trip retaining all other fields. Oversized streaming requests use a non-reused test connection and may be refused with HTTP 400 or a transport close; both leave the saved plan byte-preserved. No production runtime is used by these tests.
