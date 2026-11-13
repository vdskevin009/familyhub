# Gmail plugin migration foundation (FH-MAIL-008)

Status: In progress, local foundation only. No production consumer uses this module. No Gmail automation, installed worker, direct-Google fallback, pairing, security pin, credentials or stored family records have changed. GitHub publication/tracking was not authorized; this document is the local operational record, not a completed GitHub issue.

## Accepted scope

Move all Gmail retrieval for the requested account to the connected Gmail plugin, following the existing connector direction. Preserve ordinary invoices, Important Mail, Blue Cross emailed tables, complete PC Express MIME, history/repair coverage, source account/message/thread/attachment identities, original attachments, deduplication, manual corrections and reimbursement history. Reuse the existing classification/reconciliation code; the healthcare-PDF-only `/invoices/import-connector` endpoint is not an all-mail replacement. This requirement is not yet implemented end to end.

## Local implementation

`apps/worker/src/gmail-plugin-batch.ts` has two pure in-memory boundaries:

- `pluginMessageToRawMail(unknown)` converts the observed Gmail plugin snake_case full-message structure into existing `RawMail`. It retains MIME headers, labels, source timestamp and source IDs. Encoded bytes require canonical base64url and exact declared byte length. Decoded content is re-encoded as UTF-8 only when its byte length matches the original declaration. When both representations exist they must agree. Summaries/snippets are never content substitutes. Recursive multipart and external attachment references are preserved; a missing internet Message-ID remains missing.
- `createPluginBatchTransport(unknown, expectedAccount)` validates an entire same-account batch before exposing a `GmailCall`. Its token is a random local batch handle, not OAuth credentials. Exact query/page-size matching replays fully enumerated page chains; unknown queries, missing pages/messages/attachments, duplicates, invalid sizes or a different handle reject. Responses are isolated copies. It makes no network requests, stores no credentials, writes no coverage, and never falls back to Google.

Input schema: `{schema:1, account, messages:RawMail[], attachments:[{messageId, attachmentId, size, data}], queries:[{q,maxResults,complete:true,pages:[{pageToken?,messageIds,nextPageToken?}]}]}`. Data is original base64url bytes. The first query page has no input token; each following page consumes the preceding next token; only the terminal page omits its next token. Order is preserved, not sorted. Query text is matched exactly, not evaluated locally or replaced by a broader inferred search. An explicitly complete empty result is different from a missing query.

Limits: 64 MB serialized batch, 500 messages, 1,000 attachment records, 20 queries, 100 pages/query, 50 IDs/page, 200 MIME parts/message, depth 12, 30 attachments/message and 20 MB per body/attachment. Message/thread IDs are at most 200 characters; attachment IDs at most 1,500. Larger or unsupported evidence stops; it is never clipped to fit. Current parsers do not consume external unnamed text bodies or named inline attachment bytes; the adapter refuses those shapes rather than silently dropping them. From/Subject must be unambiguous; malformed dates and missing labels are rejected. Downstream attachment extraction still has its existing 10 MB and supported-format limits and review states.

The batch is a contract for a future trusted orchestrator, not independent proof of mailbox completeness. `complete:true` cannot prove an upstream plugin search was exhaustive. The orchestrator must actually enumerate all returned pages for the exact frozen query and verify source-account binding. A capped search, truncated tool response, guessed date window, absent continuation token caused by display truncation, or a single matching message is not complete evidence. This foundation does not invent Gmail queries or report coverage.

## Required orchestration and cutover gates

1. Discover and bind the connected source account, without extracting plugin credentials or introducing fake `GmailAccount` secrets. Obtain frozen invoice, history, repair, retry and grocery query requests from collector state. Some existing repair queries lack an upper date bound; explicitly handle them rather than claiming this module bounds those searches.
2. Read every exact query page through the plugin, preserving opaque pagination. Convert complete MIME and download original attachment bytes. Plugin `read_attachment` extracted-text previews, including previews marked truncated, are not attachment bytes. Verify the downloaded original length and source reference. Add a supported authenticated private intake/orchestration boundary with schema, replay, concurrency and recovery controls; none exists here.
3. Inject the transport into the existing invoice/Important Mail, historical/repair, Blue Cross-email and grocery paths without replacing classification. Missing evidence must not advance checkpoints or replace a prior successful scan. Validate actual collector integration and restart/repeated-run behavior before changing sources.
4. Cover all consumers, including `collectInvoices`, `GroceryCollection`, `importBlueCrossMessages`, `invoiceAttachment`, credential-derived setup/status, and retry reads. Original attachment downloads after a batch expires require a durable private byte cache for supported types or a supported on-demand plugin route. Existing connector PDF-only storage is insufficient. The new batch is ephemeral and does not provide that persistence.
5. Decide the unpaired browser Gmail fallback (`apps/web/src/google.ts`) migration explicitly. Separate user-initiated Drive upload and Google login must not be removed merely because Gmail retrieval changes.
6. Compare source IDs and expected outputs across all streams in a read-only/dry-run parity check. Test manual corrections, stable dedup, original attachment retrieval, complete versus partial/error coverage, history resume, and interrupted/repeated runs. Existing regression tests remain necessary but do not prove live parity.
7. Coordinate the existing invoice/grocery daily runner with the separate connector workflow; no second competing schedule. Deployment, security-pin review, source selection, rollback and first natural scheduled run are separate gates. Do not silently alter a pinned worker hash or stop a working path before parity and recovery are verified.

No live import, production migration, portal operation, automation change, publication, security change or completed coverage is claimed by the foundation tests.

## Validation

Focused synthetic tests: `node --test tests/gmail-plugin-batch.test.mjs` after worker build. They exercise observed plugin shapes with fictitious data, exact byte conversion, long attachment IDs, existing text-attachment extraction, full PC Express MIME and Blue Cross tables past 12k, immutable results, account isolation, empty versus missing query, pagination failures, and no network fallback. Full aggregate checks and live acceptance are tracked separately; see the implementation report for actual results, not assumptions.

### Local verification on 2026-11-13

- Passed worker typecheck: `node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.json --noEmit`.
- Passed worker build: `node node_modules/typescript/bin/tsc -p apps/worker/tsconfig.json`.
- Passed web typecheck: `node node_modules/typescript/bin/tsc -b apps/web --pretty false`.
- Passed web production build from `apps/web`: `node ../../node_modules/vite/bin/vite.js build` (1,804 modules).
- Passed 179/179 tests: `node --test tests/gmail-plugin-batch.test.mjs tests/ingestion-preservation.test.mjs tests/invoices.test.mjs tests/worker-invoices.test.mjs tests/private-store.test.mjs tests/bluecross.test.mjs tests/connector-intake.test.mjs tests/grocery-collection.test.mjs tests/pc-express-mail.test.mjs tests/grocery-auto-import.test.mjs tests/daily-collections.test.mjs`. This includes 36 new adapter tests.
- Passed `git diff --check`.
- Existing dependencies were reused through an ignored junction in this isolated worktree. No dependency install or other checkout dependency modification. `npm` was not on PATH; the equivalent installed Node tool entrypoints above were used. An initial Vite invocation from the wrong directory failed to locate its entrypoint; the corrected workspace invocation passed.
- Not run: full `test:invoices` aggregate, retained .NET regression project (no dotnet executable on PATH or the checked common installation paths), browser acceptance, live ingestion/parity, production deployment, or natural scheduled run. Passing these focused checks does not establish the remaining migration gates.

## Phase 2: internal collector composition (local, not deployed)

Shared immutable planning in `mail-collection-plan.ts` now supplies the exact query builders used by the invoice and grocery collectors. `invoiceCollectionPlan` and `GroceryCollection.plan` are read-only internal snapshots, with account-state fingerprints, frozen windows, conditional historical/repair stages and candidate source-message reads. They do not refresh credentials or write checkpoints. Retry planning includes up to 35 initial unavailable candidates because up to 25 upgrades can remove earlier candidates before the existing ten-retry budget runs. It is a conservative read superset, not a promise that every candidate will be reclassified.

`MailSource` separates email/label identity from a typed read session. `legacyMailSource` retains the default credentials/token refresh path; `preparedPluginMailSource` exposes validated in-memory batches without dummy OAuth fields. Explicit injected invoice/grocery runs require exact still-current plans and preflight every planned query/candidate before writing. Newly created windows use the accepted plan instant even when execution is delayed. Invoice validation repeats within its serialized mutation queue; grocery state is reread after asynchronous preflight. Existing correction/manual-authority guards still decide whether a source may change an indexed item. The isolated classifier and its disabled apps/MCP configuration are unchanged.

Prepared runs add optional `transport: "plugin-batch"` provenance to the account collection progress. A saved nonempty cursor without that provenance cannot enter the plugin path; a plugin-marked cursor cannot enter direct OAuth. Existing unmarked frozen windows without a cursor may be queried by their exact original date bounds. Prepared batches must contain the complete first-to-last page chain for the exact query, including any resumed plugin cursor. They do not forge a starting-page token. Tests demonstrate a two-page processing budget retaining the third plugin page across a subsequent prepared run. Source cursor migration/reset remains an explicit future operator-controlled decision, not an automatic conversion.

The standalone `mail-attachment-cache.ts` supplies immutable exact-source manifests and content-addressed original bytes, including generic supported file types. Its 18 synthetic tests pass. It is not yet connected to collection intake or `invoiceAttachment`; therefore attachment retrieval after a batch expires remains a cutover blocker. No existing ledger attachment or manual record was rewritten to adopt the cache.

No production route exposes these internal dependencies or plans. Default source selection, setup-status, Blue Cross manual email intake, on-demand downloads, unpaired browser fallback, schedules and installed worker remain unchanged. The orchestrator, safe private transport, attachment-cache integration, complete parity comparison and cutover/rollback still need implementation and validation. This development baseline must include current upstream security before any release; local foundation checks are not deployment authorization.

Phase-2 pre-merge validation: worker build passed; 96 tests across batch/planner/invoice/grocery suites passed. After final race/plan refinements, 25 planner/source/cache tests passed, including stale no-write rejection, asynchronous manual-edit race, original account isolation, missing-source failure, frozen delayed execution, existing manual correction preservation and same-transport cursor resume. Combined post-merge results remain separate.

### Combined upstream validation

Local source commit `6eeefb5` was merged with verified upstream `050a57dbcca09f083958bc9b8d261bf3060f3fd8` in local merge `ade97b0`. The sole conflict was the invoice test command: both upstream `worker-security` and all migration tests were retained. Upstream request-security, worker entrypoint and security tests are unchanged by this branch. No publication/deployment occurred.

- Passed combined worker TypeScript build, web typecheck and Vite production build (1,805 modules).
- Full merged invoice/security JavaScript stage: **310 passed / 311**, with the sole failure in pre-existing `portal-login.test.mjs` Windows local setup. Its PowerShell test script was blocked because scripts are disabled by the machine execution policy. No policy bypass or security setting change was attempted. This is not a full aggregate pass.
- Independently passed the subsequent invoice TypeScript stage: **57/57**.
- Independently passed all grocery script suites: **96/96**.
- Added a final synthetic grocery asynchronous-preflight race test; planner/source suite **8/8** passed.
- `git diff --check` passed. Verified upstream ancestry and no branch delta in request-security/index/worker-security.
- Retained .NET and browser/live cutover acceptance remain unrun. Generic cache still has no intake/download caller, and no production retrieval coordinator/source selection is enabled.
