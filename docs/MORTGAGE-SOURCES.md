# Mortgage public sources

The daily runner extends the existing Mortgage snapshot flow. It neither replaces the Ratehub collector nor registers another schedule. Public source requests contain no household balance, amortization, contact, quote, profile, authentication session or financial document. Failed attempts return null current values and preserve the old observation separately with its original timestamps.

## Numeric observations

`collectMortgageIndicators` reads five Bank of Canada Valet series:

| Evidence | Valet series | Meaning |
|---|---|---|
| Policy target | `V39079` | Target for overnight financing; distinct from lender prime |
| 3-year benchmark bond | `BD.CDN.3YR.DQ.YLD` | Government benchmark closing yield, not a mortgage offer |
| 5-year benchmark bond | `BD.CDN.5YR.DQ.YLD` | Government benchmark closing yield, not a mortgage offer |
| National prime benchmark | `V80691311` | Weekly chartered-bank reference, not a particular mortgage contract |
| Annual CPI inflation | `STATIC_TOTALCPICHANGE` | Unadjusted year-over-year change in total CPI |

The official [Valet catalogue](https://www.bankofcanada.ca/valet/lists/series/json) identifies the bond series above. The older CANSIM labels V39052/V39053 shown on the lookup page are not accepted as current Valet observation identifiers. No numeric fallback is used when an endpoint fails.

The CPI observation date denotes the start of the reference month, not publication. Its age bound is 75 days plus a collection no older than two days; a 50-day bound would incorrectly mark September data stale on October 23. Daily indicators allow a seven-day observation age to accommodate non-business days; the weekly national prime allows ten. Actual dates remain visible.

## TD prime rates

Two separately named observations prevent confusing TD general prime, TD mortgage prime and a promotional mortgage rate:

* General prime is read from the unique current `TD Prime Rate` row on [TD's rate page](https://www.td.com/ca/en/personal-banking/products/todays-rates-and-prime). Its published effective date is retained in `effectiveDate`. The current page observation date and UTC collection time remain separate.
* Mortgage prime is read from [TD's mortgage page](https://www.td.com/ca/en/personal-banking/products/mortgages/mortgage-rates). The page identifies `MTGV060C` with `PostedRate`. Its public rendering script maps array index zero to `PostedRate`, index two to `SpecialRate`; the collector only accepts matching prime values in both public ratio variants. The public JSON read endpoint is `https://psservice.td.com/ca/en/carate/getRates`, using POST with exactly `{ "errorText": "Unable to get the rate", "ratesType": "resl" }`. This is a product-rate read; no borrower data, cookies, credentials or application is sent.

The mortgage-prime feed supplies no effective date, so `effectiveDate` remains null and the conditions state that the figure was observed on the current page. A failed TD read never substitutes the national benchmark or the other TD prime. Public primes do not confirm the prime basis or discount in a personal quote.

## Dated context

`collectMortgageContext` reads three official sources independently:

* The Bank of Canada's [policy calendar](https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/): only complete `Schedule for YYYY` tables with eight valid dates qualify. The next date says nothing about the decision outcome.
* [Statistics Canada's labour index](https://www.statcan.gc.ca/en/subjects-start/labour_): only its exact dated Labour Force Survey release link qualifies. The release title, URL date and issued metadata must agree. The bounded official description is retained as an attributed English excerpt; no numerical prediction is derived.
* The Bank of Canada's [Monetary Policy Report index](https://www.bankofcanada.ca/publications/mpr/): a dated report article and its published forecast excerpt remain explicitly external forecasts. Future report links, arbitrary surrounding page text and unverified forecasts are excluded.

Each context record carries its source URL, publication or event date, actual collection time and observed/failed/unavailable state. Uncollected context has `collectedAt: null`; a failed read has the attempt time and a separate original `lastKnown`. The daily report keeps observed facts, external forecasts and financial simulation assumptions separate. No retroactive market history is constructed.
