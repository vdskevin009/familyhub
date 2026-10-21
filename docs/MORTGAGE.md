# Mortgage — FH-MORTGAGE-001

Implementation and release evidence: Issue #236 and docs/ACHATS-MORTGAGE-RELEASE.md. This feature adds no daily scheduler; activation is separately owned and verified.

The Mortgage tab reads a dedicated append-only evidence store from the paired household worker. Static GitHub Pages cannot persist daily shared observations by itself. Existing household stores, bank records, Savings mortgage settings and receipt flows are unchanged.

## Supported ingestion and read-only preflight

After this source has been built, released and the **existing** worker restarted under separate operator authorization:

* `GET /health` with the existing `x-familyhub-key` must include capability `mortgage-evidence-v1`.
* `GET /mortgage` with that same header is a harmless read-only preflight. It returns schema 1, immutable baseline date `2026-10-20`, `baselineSnapshotId` (or null), `snapshots`, `quotes` and private `assumptions`. An empty store returns empty arrays; it does not create history.
* `POST /mortgage/snapshots` accepts one validated Snapshot, below. `POST /mortgage/quotes` accepts one separately validated Quote. `POST /mortgage/assumptions` accepts one private financial-assumption record.
* Both writes return `{ "duplicate": false }` for newly stored evidence, `{ "duplicate": true }` for the same ID and canonical content. Changed evidence with an existing ID returns 409, preserving the original. Validation and oversized bodies return 400; the body limit is 32,000 bytes. No delete, overwrite, reset or public submission route exists.
* Existing worker authentication, allowlisted browser origins, localhost binding, private HTTPS access and `Cache-Control: no-store` apply. No new token or credential scope is introduced. A cloud task cannot call the household localhost service without an already authorized route or a local executor on the PC.

**Verify the actual installed worker before automation activation.** Source implementation and an isolated test server do not establish reachability through the household's private endpoint. Activation requires the authorized integration/build/restart of the worker plus static PWA release, followed by a real read-only preflight. Issue #236 records release acceptance. Do not activate a daily automation that promises durable FamilyHub writes before that succeeds.

The one-shot helper uses only an existing pairing key file; never paste its contents into chat/logs:

```powershell
node scripts/mortgage-ingest.mjs --preflight --endpoint http://127.0.0.1:4713 --key-file EXISTING_PAIRING_KEY_FILE
node scripts/mortgage-ingest.mjs --kind snapshot --file PRIVATE_SNAPSHOT.json
node scripts/mortgage-ingest.mjs --kind snapshot --file PRIVATE_SNAPSHOT.json --apply --endpoint http://127.0.0.1:4713 --key-file EXISTING_PAIRING_KEY_FILE
```

The preflight command performs GET requests only and prints schema/counts, never evidence or credentials. Validation without --apply does not write; --apply sends one request. It never retries an uncertain POST. After interruption, read `GET /mortgage`, look up the exact ID, and only retry the identical evidence if absent. Generate one stable ID per collection attempt and retain its complete JSON before transmission. An intentionally new source read gets a new ID even on the same date. A duplicate collector delivery reuses the original ID and body; it must not update its timestamp on retry.

## Snapshot contract

All four product outcomes are mandatory. These example rates and balance are **synthetic**, not household data:

```json
{
  "schema": 1,
  "id": "ratehub-2026-10-20-attempt-opaque-id",
  "collectedAt": "2026-10-21T01:00:00Z",
  "localDate": "2026-10-20",
  "source": {
    "url": "https://www.ratehub.ca/best-vancouver-mortgage-rates/5-year/fixed",
    "title": "Ratehub Vancouver mortgage comparison",
    "method": "Visible controls read back; waited for refreshed rates; expanded and inspected all result rows for every term/type",
    "publishedAt": "October 20 06:05 (raw display; timezone unspecified)",
    "controlsVerified": true
  },
  "filters": {
    "purpose": "renewing",
    "balance": 400000,
    "amortizationMonths": 240,
    "location": "Vancouver BC",
    "occupancy": "owner",
    "payment": "monthly",
    "cmhc": "no",
    "ltv": "unavailable"
  },
  "status": "partial",
  "error": null,
  "observations": [
    { "product": "fixed-3", "status": "observed", "rate": 4.6, "lender": "Synthetic lender A", "reason": null, "eligibility": ["Public filtered observation only; personal and early-switch eligibility unverified; insurance category unverified"] },
    { "product": "fixed-5", "status": "observed", "rate": 4.4, "lender": "Synthetic lender A", "reason": null, "eligibility": ["Public filtered observation only; personal and early-switch eligibility unverified; insurance category unverified"] },
    { "product": "variable-3", "status": "observed", "rate": 4.2, "lender": "Synthetic lender B", "reason": null, "eligibility": ["Public filtered observation only; personal and early-switch eligibility unverified; insurance category unverified"] },
    { "product": "variable-5", "status": "unavailable", "rate": null, "lender": null, "reason": "Rate table did not finish refreshing", "eligibility": ["Eligibility unknown"] }
  ]
}
```

Rate values use percent units (`4.4` means 4.40%). `complete` means four observed products; `partial` means one to three; `failed` means zero observed with a nonempty top-level error. Every unavailable outcome has null rate/lender and a reason. A failed profile read must use `controlsVerified: false` and four unavailable results. A zero rate is never a failure sentinel. The collector must record actual UTC collection time and calculate localDate with `America/Vancouver`, including the runtime's IANA timezone rules. Never infer local date from UTC date or hardcode UTC offsets.

Ratehub's URL can initialize Toronto, Buying and CMHC Yes despite a Vancouver URL/title. Every session must explicitly set and read back **the privately configured purpose, balance and amortization, Vancouver BC, owner occupied, monthly, CMHC No** for the requested comparison. The public filter amortization and the separately recorded financial amortization assumptions are distinct; do not silently round the latter to match a public control. No LTV control was observed. CMHC No does not establish uninsured or uninsurable eligibility. Switching term/type can update controls before rate rows; wait for the rows, expand full tables, inspect all lenders and select the actual minimum of the matching product. Featured first rows can be higher. The URL may remain 5-year/fixed while controls change. Store raw source date/time without inventing a source timezone.

The collector owns source access and truthful extraction. This endpoint validates evidence structure and explicit readback attestation; it cannot prove a browser actually used those controls. No scraper, private endpoint, lender application or scheduler is added here.

## Dated quote contract

```json
{
  "id": "opaque-source-and-variant-id",
  "receivedDate": "2026-10-16",
  "source": "Private source reference",
  "lender": "Indicative quote sender",
  "product": "variable-5",
  "variant": "adjustable-payment",
  "rate": 3.55,
  "limitations": ["Synthetic example; indicative only; early-switch eligibility unverified"]
}
```

Variants are `fixed`, `adjustable-payment`, `fixed-payment`. A fixed-rate product only accepts `fixed`; variable products require one of the payment variants. Fixed-payment and adjustable-payment quotes are separate immutable records. Received date/source are retained and never refreshed from public rates. No three-year quote is manufactured. Real quotes and household amounts belong in private runtime storage, never committed fixtures.

## Durable storage and baseline

Records live under `<FAMILYHUB_WORKER_DATA>/mortgage/evidence/`, separately from all existing household data. Each evidence ID has a SHA-256 filename. A same-directory exclusive lock, fully written/fsynced temporary file and atomic rename prevent partial publication and concurrent overwrite. IDs and canonical content deduplicate independently of property order. Records are never removed. First complete snapshot ingested for October 20 Vancouver creates an immutable `baseline.json` pointer. Later corrections/failed attempts retain their own records and cannot silently replace that baseline. A crash between writing the snapshot and its pointer is recoverable by resending the same record; an interrupted lock is never automatically discarded and requires operator investigation. Corrupt finalized data fails closed; there is no empty-store reset.

Back up this **entire directory** with existing private worker backups. The browser's combined local backup does not include this worker-owned store; the Mortgage screen does not create a competing localStorage copy. There is no automatic backfill. The latest attempt for an exact local date is used for Today and rolling reference dates, so a failed later read is explicitly unavailable rather than silently reusing a prior success. The baseline comparison uses its frozen snapshot. Filters must match for rate changes or negotiation estimates; lenders can differ and are listed in the evidence history. Rolling intervals are exact local dates, with calendar-month subtraction clamped to month end. Missing dates remain unavailable.

## Illustrations and estimates

The public-rate gross illustration reads principal, remaining months and current rate from private worker assumption records, labels the principal/amortization as unverified and current rate as user supplied, and uses monthly payments without penalties/fees. No household defaults are shipped in public source. Fixed illustrations use effective monthly rate `(1 + nominalPercent/200)^(1/6) - 1`; variable illustrations explicitly assume nominal monthly compounding. Lender conventions require confirmation. Payment reduction is separate from interest saved over the selected 36/60-month horizon, preserving principal and remaining amortization. The current contract maturity is unverified; its current rate is held across the same full horizon as an explicit illustration assumption. Rates are held constant only for illustration, without guaranteeing future variable savings or the cash flow of a fixed-payment variable contract.

Independent mathematical acceptance includes a discounted-cash-flow present value sum, closed-form ending balance and the FCAC published 300,000 CAD / 25-year table (e.g. 5% → 1,744.81 CAD/month). Source: [FCAC interest on mortgages](https://www.canada.ca/en/financial-consumer-agency/services/mortgages/interest-on-mortgages.html). FCAC also explains why fixed-payment variable mortgages can shift principal/interest and reach a trigger point.

Optional « Estimation de négociation » uses **today public + (dated actual quote − frozen baseline public)** per product and payment variant, in percentage points. Cross-date and product/eligibility comparability limitations remain visible. It does not produce quote history, imply an approved offer or apply a universal percentage discount. Missing quote/baseline/today or filter mismatch yields unavailable.

## Integration with Achats

This branch starts at main `072d1cb`, independently from Achats `1bae919`. Mortgage adds its own modules. Shared-file integration is limited to `package.json` (two scripts), `apps/worker/src/index.ts` (import, store, routes, health capability and conflict type), `REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and CI test steps. Preserve Achats' source-version/capability and purchase-source additions when combining. `App.tsx`, `types.ts`, `domain.ts` add the actual Mortgage tab; these were not edited by Achats. No production release is implied by a successful local build.

## Private assumptions and publication privacy

No household loan balance, current rate or remaining amortization is shipped as a public default. POST /mortgage/assumptions takes `{ id, recordedAt, principal, currentRate, remainingMonths, source, principalBasis: "assumption", amortizationBasis: "assumption", currentRateBasis: "user-reported", currentMaturity: null }`. Rates use percent units and recordedAt is UTC ISO. These immutable records use the same existing pairing/origin protection and ID/content deduplication as quotes. The latest recorded assumptions drive illustrations; missing assumptions yield an explicit unavailable state. The one-shot helper accepts --kind assumptions. These values are never part of daily public observations or public tracking. A collector should read only the privately configured comparison filters, not pass quote/financial-assumption records to public research.
