# Achats local review handoff

Issue [#155](https://github.com/vdskevin009/familyhub/issues/155), requirement [FH-GROCERY-010](requirements/FH-GROCERY-010.md). Status: Testing, local implementation. Isolated clone `familyhub-achats`, branch `feat/courses-achats`, base `072d1cb`. Existing FamilyHub checkouts and their worktrees were inspected, then left untouched. No push, PR, merge, deployment, installed-worker restart, personal import, retailer submission, automation or cart mutation.

## Behavior

Courses → Achats starts with purchase/receipt cards and per-retailer product comparisons. Opening a card shows original source lines and quantities, historical amounts, competitor formats and dated source details. Ticket review/import remains the existing workflow. A direct Add ticket action scrolls to that importer. Native dialogs/disclosures support keyboard use, Escape and focus return, including returning from ticket review.

The actual competitor format stays visible. A 15-egg pack at 6 CAD contributes 4.80 CAD for 12 eggs, marked **Calculé**, and separately requires a 6 CAD whole-pack outlay. Equal pack formats show no badge. Repeated receipt rows sharing one price round whole packs after grouping. No mass/volume/dose/count conversions are invented. Unmatched, unavailable, stale, ambiguous, wrong-mode/currency/quality, unreviewed and conditional offers do not enter a subtotal. Required stores with no data remain visible. Partial coverage cannot become a complete basket.

Competitor figures are product-only, before tax, deposits and order fees; the historical source total is never used to claim savings against that different basis. Tax/deposit fields and matching notes remain visible. Costco requires existing membership evidence. No all-in competitor total or live stock is assumed.

Optional source classification is backward compatible and retained by worker source 2.26.9. New classification writes require `grocery-source-type-v1`; older workers cannot silently discard the field. Legacy records remain readable and their payment is unverified. Explicitly classified/named original confirmations are excluded from monthly spending. An explicitly reviewed final receipt may coexist with its original confirmation sources. No real household source was classified or changed during this task.

## Verification

- `npm install`: passed using a task-local npm tool; installation/cache/tool files are uncommitted.
- `npm run typecheck`: passed for web and worker.
- `npm run build`: passed; final web build also passed after keyboard polish. Vite retains its nonfatal >500 kB bundle warning.
- `npm run test:pwa`: 5 metadata/theme tests and 97 product/UI tests passed, including 9 new purchase normalization/source-type regressions.
- `npm run test:groceries`: 35 passed, including source-type save/restart and stale-write preservation.
- `npm run test:savings`: 24 passed.
- `npm run test:finances`: 26 model/API and 16 TypeScript tests passed.
- `npm run test:notifications`: 21 passed.
- `npm run test:groceries:browser`: passed. Existing import retry, deduplication, draft/reload, conflicts, offline history, 300-item planning, catalogue/cart and comparison flows remain covered. New Achats checks pass at 320/390/768/1280, including real pack descriptor, explicit 12/15 calculation, whole-pack cost, no equal-format badge, original confirmation status, missing stores, keyboard/focus/close/reopen, source-review handoff and offline cache. Synthetic servers record zero writes and external requests.
- `npm run test:savings:browser`: passed, including Documents/backup/restore at 320/390/768/1440, two devices, conflicts, stale results and offline cache.
- `node apps/web/tests/theme-browser.mjs`: passed, 12 routes × 4 widths × 2 system preferences, navigation/history and dialog focus.
- `npm run test:invoices`: **passed on follow-up**, 237 Node + 53 TypeScript tests, using the supported `FAMILYHUB_TEST_POWERSHELL` override described below. The original default Windows PowerShell attempt failed under its Restricted policy; that evidence is retained. No policy was changed.
- `dotnet run --project tests/Core.Tests -c Release`: **not run**, `dotnet` is unavailable in this environment.
- No lint script is defined in the repository.
- `git diff --check`: passed.

`npm run test:finances:browser` passed all six scripts, covering imports, settlement exclusions, trends, compact controls, bulk changes and inline batches/undo at 320/390/768/1440. Logs are in `artifacts/achats/final-test-finances-browser.log`.

Screenshots and logs are local ignored artifacts under `artifacts/achats/`, including `overview-390.png`, `detail-390.png`, other widths and `verification.json`. The 390 px overview and calculation detail were visually inspected. Synthetic tests do not establish physical-phone acceptance or screen-reader behavior; those were not verified.

## Remaining limits

No final fulfilled receipt for the cited real order was established, and no complete current local competitor basket was collected. No actual receipt, private catalogue, source-message identifier, pairing material or household line is a committed fixture. Existing generic-product public research and reviewed local observations remain the data sources; official public policy pages establish no product prices. The UI shows missing-data states until sourced, reviewed matches exist.

Source code is reviewable locally. Release still needs the retained .NET check on an appropriate runner, explicit publication authorization, and separate installed-worker/physical-phone/live-source acceptance. The cross-project `ai-control-plane/WORK_ITEMS.md` update is prepared locally under `artifacts/achats/control-plane-update.md`; it was not published because this task does not authorize code publication.

## Changed files

- `REQUIREMENTS.md`, `docs/requirements/FH-GROCERY-010.md`, `docs/GROCERIES.md`, `docs/ARCHITECTURE.md`, this report.
- `apps/web/src/grocery-purchases.ts`, `apps/web/src/views/GroceryPurchases.tsx`, `apps/web/src/views/CoursesView.tsx`, `apps/web/src/views/GroceriesView.tsx`, `apps/web/src/grocery-api.ts`, `apps/web/src/grocery.css`.
- `apps/worker/src/grocery-model.ts`, `apps/worker/src/grocery-extraction.ts`, `apps/worker/src/index.ts`.
- `apps/web/tests/grocery-purchases.test.ts`, `apps/web/tests/grocery-purchases-browser.mjs`, `apps/web/tests/product.test.ts`, `apps/web/tests/groceries-browser.mjs`, `apps/web/tests/grocery-catalogue-browser.mjs`, `apps/web/tests/theme-browser.mjs`, `tests/groceries.test.mjs`, `package.json`.
`Final tracking publication`: automatic approval review denied posting the final status/commit/test report to FamilyHub Issue #155 because the task prohibits publication without separate authorization. That rejected comment did not execute and was not retried. Earlier issue discovery and one In Progress tracking comment had succeeded; final status/evidence remains local. Publishing the final issue report or central index needs separate authorization.

## Follow-up verification — supported runtime, no policy change

The original invocation `powershell.exe -NoProfile -NonInteractive -File <checkout>/tests/insurer-login-setup.ps1` failed with `SecurityError / UnauthorizedAccess: running scripts is disabled on this system`. The test in `tests/portal-login.test.mjs` explicitly supports `FAMILYHUB_TEST_POWERSHELL`. Read-only checks established that the provided `pwsh.exe` has effective `RemoteSigned`, Windows PowerShell has effective `Restricted`, and all policy scopes were Undefined. No policy flags, Set-ExecutionPolicy, registry changes or script modifications were used.

Successful full-suite command (from this checkout, with its task-local npm tool on PATH):

```powershell
$env:TEMP = 'C:\Users\kevin\AppData\Local\Temp'
$env:TMP = $env:TEMP
$env:FAMILYHUB_TEST_POWERSHELL = (Get-Command pwsh).Source
node .local-tools/package/bin/npm-cli.js run test:invoices
```

This resolved both stages: 237/237 Node tests, including protected credential setup/replacement/cancellation/ACL/DPAPI/lock checks against synthetic temporary data, and 53/53 invoice TypeScript tests. Log: `artifacts/achats/invoices-supported-pwsh.log`. The provided executable is `C:\Users\kevin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`.

The requested separate TypeScript invocation was also attempted before that full rerun:

```powershell
node --import tsx --test tests/invoice-state.test.ts tests/source-pdf-viewer.test.ts tests/healthcare-dates.test.ts tests/document-library.test.ts tests/insurer-payment-ui.test.ts
```

Its sandbox run passed 52/53; the synthetic healthcare repair subprocess reported `Invoice index is unreadable. Restore the index before collecting; it was not overwritten.` The subsequent full supported run above, with a writable temporary directory outside the sandbox, passed all 53. No application/invoice code was changed to obtain that pass.

.NET remains unavailable (`dotnet` command not found). `tests/Core.Tests` targets net11.0 and references `src/Core`. This branch changes no C# or .NET project files; the Achats runtime and direct tests are TypeScript/React. The retained .NET suite remains an unexecuted repository regression gate, not a failed Achats calculation test.

Library delivery: the two verified synthetic screenshots (`overview-390.png`, `detail-390.png`) were offered in order through the current Library prepared-upload helper, using all three current companion files. The sandbox attempt failed `hosted apps tools/call request failed: DNS`; the permitted network retry failed `prepare_uploads failed`. No Library IDs or confirmed saved files were returned. No direct-upload workaround, manual signed-URL transfer or extra retry was attempted. Local screenshot deliverables remain available under `artifacts/achats/`. The denied GitHub publication was not retried.
