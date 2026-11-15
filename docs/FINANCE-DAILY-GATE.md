# Private daily Finances completion gate (FH-FIN-025)

Local, synthetic-tested candidate only. No automation, provider call, production API route, worker deployment or real private state is activated by this change. The runtime adapter is intentionally NOT supplied: an integrator must connect actual collection/import/reconciliation evidence and verify it before enabling this gate.

## Schedule and early gate
- Run at most hourly from 08:00 through **20:59**, America/Vancouver. The 20:00 scheduled slot may arrive later within that hour; 21:00 and later cannot start a source/API callback. The external scheduler must use that IANA timezone, not a fixed UTC offset.
- `Intl.DateTimeFormat` supplies local date/time and current timezone rules. Tests cover historical spring/fall DST transitions without assuming future political timezone rules.
- A verified complete result for the same local date and intended scope suppresses every collector, plugin, health/API and verification callback. The CLI does not even import the adapter in that case. Only private local state/proof files and the advisory lock are touched.
- Incomplete attempts and recovery invocations are throttled by **invocation start**, not completion time. A slow 08:00 attempt does not suppress a 09:00 retry merely because it finished at 08:10. Recovery cannot repeat every minute after its original attempt gets old.
- Same-day scope changes after an attempt are review-required. Never use a previously completed narrower scope to silently approve a wider collection. A pending prior-day attempt must be resolved first; its recovered success is not today's success.

## Private scope and integration interfaces
`finance-feed/daily-scope.json` contains `DailyFinanceScope`: schema 1, nonempty valid `periods` (`from`, `through` calendar dates), and exactly five `subjects` lists keyed `collection`, `accounts`, `balances`, `transactions`, `contributions`. Each list contains the exact private intended identifiers for that stage, with no duplicates or empty list. Include account/section identifiers sufficient to distinguish transaction and investment sections; do not shrink the list to only currently accessible accounts. Extra configuration fields are also bound by the digest, while period/subject ordering is canonicalized. Do not put this private scope in a public prompt or repository.

Call `runDailyFinanceGate({directory,scope,callbacks})`, or:

`node --import tsx scripts/Run-DailyFinanceGate.mjs <explicit-private-directory> <reviewed-local-adapter.mjs>`

The CLI lazily imports the reviewed adapter only after the local gate. The adapter exports:
- `collect(attempt,{directory,scope})`: performs the authorized source collection and existing revision-checked imports. Must retain an attempt-bound operation journal before each consequential write so later readback can identify its exact outcome.
- `recoverReadOnly(attempt,{directory,scope})`: authoritative **reads only**. Never refresh the Finances source, submit an import, replay POST, open/close sessions, or call `collect`. It can return verified receipts, `not-applied` with independently verified no-write evidence, or `uncertain`. Merely catching an error is not no-write proof.
- `verifyReceiptReadOnly(receipt,attempt,{directory,scope})`: independently validate each stage receipt against its authoritative readback/artifacts and expected scope. A self-reported boolean or checksum is not enough. **No source refresh or POST.**
- `verifyOutcomeReadOnly(report,attempt,{directory,scope})`: verify the overall write outcome from authoritative state, including explicit proof for `not-applied`. **No source refresh or POST.**

Adapter modules must have **no top-level effects**. All provider/network work belongs inside its correctly named callback. The gate cannot sandbox arbitrary adapter code or prove a callback is read-only. Production integration requires source review and independently tested wrappers; synthetic callbacks returning true are not an implementation of those wrappers.

## Stage receipts and complete success
The import/readback integration emits `StageReceipt {payload,digest}`. The canonical SHA256 digest binds the exact payload, which includes schema, stage, attemptId, localDate, scopeDigest, status, confirmedSubjectIds, evidenceDigests, withheldCount, uncertainWrite, sourceFreshness and sourceAsOf. Evidence digests refer to actual private source/import/config/readback artifacts, not arbitrary marker strings. Every receipt is independently checked by its read-only verifier.

Complete requires exactly one receipt for each of all five stages, status confirmed, every intended identifier either confirmed or losslessly retained source-native with verified readback, no withheld observation, no uncertain write, valid evidence digests and an authoritative confirmed outcome. Partial, failed, withheld or missing coverage remains incomplete. `sourceFreshness:unknown` with `sourceAsOf:null` is honest provenance and does not alone prevent operational completion when the stage's intended scope was actually confirmed. Unknown freshness must never be converted into a bank-updated timestamp.

The separate Contributions reconciler's `configurationVerified:true` can support its stage only when its config/API receipt covers **all intended plans/IDs** for this attempt. Its `globalSuccess:false` and partial projection never imply all-stage failure or all-stage success. The adapter must preserve these source limitations separately and must not infer a beneficiary or contribution from a generic transfer.

## Persistence, uncertain outcomes and recovery
Private files live under `finance-feed/daily-gate/`: atomic `state.json`, immutable `verified-<digest>.json` artifacts, and `lease.lock`.

A pending attempt is flushed and read back before entering any collector callback. Throws, malformed receipts, failed verification and uncertain writes leave it pending. The next eligible hourly invocation can call only `recoverReadOnly`, with the original attempt ID and start time retained. An authoritative `not-applied` resolution clears pending but never collects again in that invocation; a subsequent hourly slot can try normally. Uncertain recovery remains pending and is also throttled for an hour.

The lock is exclusive/advisory with a recorded 55-minute lease. Completion after that interval is rejected and remains pending. A lock left by a killed process is **never stolen by age**; the operator must prove the old owner is dead and no writer is active before removing it. All invocations must cooperate; unrelated editors cannot be made transactional by an advisory lock. State digests are checked before final replacement to detect observed drift.

Files are flushed before same-directory rename, then read back. Power-loss directory durability depends on platform/filesystem; no stronger guarantee is claimed. A process killed before completion-state replacement remains pending and recovers via readback, never blind reapply. A persisted complete state must match the stored artifact digest and complete receipt scope before it can suppress callbacks. Missing/corrupt state or proof fails closed rather than silently recollecting.

## Remaining real integration gates
No real adapter, scheduler, all-account mappings, live stage receipts, stale-lock recovery service or production dependency installation is supplied. Unresolved mappings do not alone prevent collection success when every intended source-native observation is losslessly retained and verified. They must never become fabricated ledger mappings, balances or beneficiary assignments. Missing source coverage or unpersisted evidence remains a failure. Test real provider availability in the future automation context, private transfer/materialization, readback-only uncertain outcomes, receipt production, Contributions integration, and persisted schedule before declaring daily collection active. No fund movement is part of this workflow.

## Retained unassigned evidence and end-of-window notification
A stage may include `retainedUnassigned` entries `{subjectId,evidenceDigests,sourceNative:true,persisted:true,readbackVerified:true,limits:[...]}`. Each intended identifier must appear exactly once across confirmed and retained lists. Retained evidence digests must also appear in the stage's evidence list and be independently checked by the read-only verifier against the full private original capture and durable readback. Nonempty explicit limitations are required. The count `withheldCount` means missing/unpreserved observations or coverage, not merely an unidentified account; it is never silently ignored. Thus an ambiguous new account with all raw evidence preserved can succeed without inventing an allocation, while any dropped/withheld data cannot.

Before each callback the gate rechecks the local window. If a collection returns after 21:00, it leaves pending and does not start a verification API call. Adapters must also check the same window before **each internal provider/API operation**, not merely once at callback entry; the gate cannot preempt arbitrary adapter code. Source/API work after 21:00 is forbidden; pending verification resumes read-only during the next permitted window.

The gate never sends a message. After 21:00 an incomplete local day returns `notificationDue:true` using local state only; a failed 20:xx attempt does not alert prematurely. The integrator must arrange an after-21:00 local-only wake, send the requested final-window alert, and persist/deduplicate a delivery acknowledgement only after messaging acceptance. No notification marker is set by this candidate, and it makes no claim that an alert was sent. Lock/corrupt-state failures also need the integrator's explicit blocker handling without source/API calls after the window.
