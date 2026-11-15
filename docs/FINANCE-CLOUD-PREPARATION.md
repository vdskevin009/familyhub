# Scheduled scope and native packet preparation

Local candidate for FH-FIN-027/028, work item #281. No real activation or scheduler is included. Run CLIs with `node --import tsx` from the reviewed repository. No CLI clock override exists.

## Explicit private policy

An operator must create and review a private JSON policy outside Git. Required exact fields:
- schema: 1
- timezone: America/Vancouver
- from: explicit real YYYY-MM-DD, covering intended history and Contribution periods
- through: current-local-day (the only supported date policy)
- mappingFile: absolute path to the existing reviewed private mapping JSON
- mappingSha256: SHA256 of those exact persisted mapping bytes
- contributionsConfigSha256: SHA256 of the exact current private contributions/config.json bytes
- accountPolicy: all-linked
- accountScope: returned-institution-accounts

This is a candidate format, not permission to create/change mappings, goals, periods or beneficiaries. Unknown fields, changed hashes or an unrecognized existing scope require review. Do not automatically update pins. Current configuration plan IDs become Contribution subjects; all source account enumeration stays dynamic. No assumption that the old account count is the current universe.

## Stable sequence

1. `scripts/Initialize-FinanceScope.mjs <dataDir> <reviewedPolicyFile>`
   Local only. On ready, writes/readbacks finance-feed/daily-scope.json and immutable daily-gate/scope-YYYY-MM-DD.json; never changes completion state, mappings or Contributions configuration. Prior day scope is replaced only when its digest belongs to recorded prior work. Uses the same exclusive lease file as scheduled-begin; a stale lease is never stolen. Pending work requires the original scope and operator-reviewed recovery, not next-day rollover. Complete current-day or outside 08:00–20:59 Vancouver returns skip without touching the old cycle. A current partial day must retain exactly its previous scope.
2. Run existing FinanceScheduledBridge.mjs scheduled-begin. A ready initializer result is NOT admission. On skip stop before Finances or health/API calls. On recover follow only readback recovery, never recollect. After collect admission save the independent baseline with FinanceCloudReadback.mjs baseline. Copy the reviewed mapping bytes into this NEW attempt's private evidenceDir/mapping.json, verifying the policy hash.
3. Collect with cloud Finances tools only after check-collect immediately before every call. Archive original responses/CSV bytes twice and preserve exact call queries, result indices and receipt timestamps. Capture after the new admission/baseline, not a prior cycle.
4. `scripts/Assemble-FinanceCloudPacket.mjs <dataDir> <evidenceDir> <extractedPackDir> <admissionFile> <packetManifest>`
   Local reads and immutable derived evidence writes only; never edits baseline/source bytes or production stores and never calls an API. The extracted pack must be inside private evidenceDir; all directories must be outside repositories. It validates producer SHA256/length for every indexed file, verifies capture/archive identity, complete cursors and exact current linked-account query universe. Malformed/unsupported source does not produce an accepted manifest. Absent manual_accounts remains null in the account wrapper; nonempty/malformed manual data is unsupported, not silently merged. New institutional accounts are retained without canonical mapping. Unknown source freshness remains unknown.
5. Result manifest is `<evidenceDir>/fresh-cloud-manifest.json` (includes accountCapture PrivateRef). Run Run-FinanceIntakeController.mjs first default preview, then explicit --apply only with unchanged evidence and fresh admission. Finally run independent report/finalize. Assembly and intake success alone never mark the day complete.

## Packet contract

packetManifest JSON contains files [{path, bytes, sha256}]. Paths resolve inside extractedPackDir. The indexed transfer-metadata.json contains attemptId, linked {capture, archive, collectedAt}, and toolCalls [{response:{capture,archive}, collectedAt, queries:[exact native requests], exports:[{resultIndex,sourceFileId,capture,archive}]}]. Response files contain entire original Finances responses, not reconstructed previews; linked files wrap {collectedAt,rawLinkedAccounts:entireOriginalResponse}. Every result index is unique and has its exact query. CSV exports are linked by native file_id and result_count, never a preview. Pagination query equality and full chain are required.

Derived expenses/section captures are explicitly normalized wrappers bound back to original native envelopes and CSV bytes; originals remain authoritative. The assembler calls the existing loadCloudIntakePlan validator again before publishing the manifest. Unsupported credit/prediction transformations preserve baseline and remain partial; missing provider coverage cannot become zero or success. Current adapter requires an existing source-inventory baseline and narrow undated balances. Unexpected dated balances refuse rather than discard dates. Each attempt requires a new evidence directory; immutable output conflicts stop, not overwrite.

## Remaining activation gates

Review private policy, install reviewed code, validate next fresh admitted cloud packet and four real readbacks under sole-writer coordination, then connect the parent's automation. No real policy or next-day collection was created by this change. Outside-window notification is handled separately by the parent; these preparation CLIs do not send messages. Advisory locking cannot constrain uncooperative writers; exclusive maintenance coordination remains mandatory.
