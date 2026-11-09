# Claims coverage clarity — FH-REIMB-045, Issue #159

Local candidate only. No publication, deployment, credential change or private-data import is included.

## Demonstrated behavior

The previous source-coverage notice described any ambiguous record as an incomplete collection, even when the entire source read completed without errors. The corrected notice separates collection coverage, matching review and staleness, retaining the block on applying ambiguous records.

Pending source records can include zero-payment adjudications. The notice now says insurer records, rather than implying positive payments are missing from saved history. The existing automatic-import rule still requires a strictly positive payment; no payment or match is fabricated.

The default Open workflow excludes closed and ignored cases. Potential to recover is an outstanding balance, not a cumulative reimbursement history. Direct links to the existing insurer document libraries and explicit workflow labels make the saved history discoverable without changing any workflow decision or financial calculation.

An expired/rejected Gmail authorization previously surfaced only a generic incomplete-account message in Claims. The corrected notice identifies the PC reconnection required, retains the last complete collection timestamp, preserves saved records and clears when the account status becomes healthy. It does not start login or collection.

## Validation and release gates

Synthetic unit coverage tests distinguish complete-but-ambiguous, genuinely incomplete, stale, pending and authorization-failed states. Built-PWA browser acceptance exercises the notices, insurer-history links, closed payment cards, workflow changes and repeated navigation at mobile and desktop widths. Synthetic workflow writes are confined to the isolated temporary test worker store.

Local validation: both TypeScript checks and both builds passed; 34 focused source-coverage and invoice-state tests passed. The built PWA passed isolated Edge acceptance at 390 px and 1440 px, including completed payment cards, workflow restore/reload, authorization guidance and history links. The test captures remain local under `output/playwright` and contain synthetic records only. The retained .NET suite could not start because the host has no available `dotnet` executable; this is not a passing check. No real source documents or household fixtures belong in this repository. Production, CI and physical-phone acceptance remain unverified until separately authorized and completed.
