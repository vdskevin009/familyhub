# Purchase calculation correction — FH-GROCERY-013/014

Status: local Testing; no release, deployment, production import or live-offer acceptance implied.

Integration on the updated main branch also exercises the product aggregate. Historical reviewed formats must still match their saved source/reference keys and cannot be future-dated; a removed reference cannot determine a new scenario target. When an unknown selling unit receives a common physical-pack hypothesis, the selling-unit comparison is not fed back into physical inference. Legacy fixtures now supply their explicit SKU for SKU-scoped hypotheses and expect missing coverage for unsupported cucumber count-to-mass conversions.

Independent review follow-up: reviewed equivalences are now checked against the common physical target before taking priority over estimates. With no scenario, an explicit source label still controls the target; contradictory reviewed targets abstain. Nested numeric multipacks and `packs of` prefixes use the full quantity, while unsupported postfix declarations abstain rather than losing a multiplier. Whole liquid eggs, whites, shell eggs and substitutes remain separate. Synthetic regressions reproduce each review finding; no visual component or production data change is involved.

The former selling-unit fallback could price a different physical quantity at each retailer. For example, two unknown selling units could become two 500 g packs at one retailer and two 1 kg packs at another. The corrected projection chooses one dated reference hypothesis for the source quantity and applies it to every retailer. Explicit source quantities remain authoritative; known counts never become mass without a scoped common hint.

The comparison also previously accepted search/category URLs as prices, mixed localities/channels to fill rows, and used substring receipt IDs and ambiguous historical lines as price provenance. These paths now retain missing coverage with reasons. Exact text references can cover products outside the substitution families, while new bounded families preserve cheese type, salted butter and dry pasta distinctions. Frozen/fresh, smoked, dietary, production and explicit quality constraints are preserved. A source label can provide an explicit unambiguous mass/volume multipack; this is a derived comparison format, never a receipt edit.

Prorata and whole-package costs are separate. Repeated lines using the same reference aggregate before package rounding. Positive tiny quantities cannot round down to zero packages. Missing prices remain missing; explicit sourced zero remains zero. Source subtotals use exactly the compared rows and never substitute the complete receipt total.

## Read-only diagnosis

After installing the existing dependencies, run:

```text
node --import tsx scripts/grocery-coverage-report.mjs <private-groceries-directory> <YYYY-MM-DD>
node --import tsx scripts/grocery-coverage-report.mjs <private-groceries-directory> <YYYY-MM-DD> <reviewed-public-reference-plan.json>
```

The optional overlay uses the existing validated plan schema, permits only public references and rejects identifier collisions and private comparison/source-estimate evidence. It is merged in memory only. The helper reads three JSON files, emits hashes, coverage, amounts and missing line positions/reasons, and never creates a store, calls a worker or accesses the network. Keep reports private. Public fixtures contain fictional purchases and prices only.

Public research must use only product terms and coarse locality. Search listings remain leads. A saved price requires a product page with dated price/conditions, format, locality/channel and availability (explicitly unknown where not established). This projection does not scrape or certify pages; it consumes reviewed observations. Nonlocal/historical/unavailable observations remain limited estimates, not a promise to buy locally. No cart, order, sign-in bypass, schedule or permission change is introduced.

## Validation

The focused coverage tests cover compatible unit conversions, fractional and multiple packs, grouping, unknown formats, common inter-store hypotheses, explicit count-to-mass scope, constraints, unrecognized families, absent/invalid/future/old prices, nonlocal and unavailable observations, search-only leads, independent receipts, duplicate purchases, contradictory hints and read-only replay/overlay preservation.

The existing scenario browser fixture now gives its SKU-scoped cucumber assumption the corresponding explicit synthetic source SKU. It checks formula/pack disclosure, verified/estimated/missing states, modal keyboard/back behavior, cache/empty states and widths 320/390/1280 with zero external requests and zero API writes. Other grocery regression tests, typechecking, builds and retained .NET validation are separate checks; report actual execution results with the local handoff.

Remaining data work: obtain missing dated product pages in one comparable locality/channel and source formats for explicit unknown club/count packs. More permissive math cannot supply an absent price or prove an equivalent product. Production ingestion and release require separate authorization.
