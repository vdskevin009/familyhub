# Reusable four-target finance intake controller (local candidate)

`finance-intake-controller.ts` and `Run-FinanceIntakeController.mjs` replace the one-run private intake script for future reviewed attempts. They do not collect Finances, change services, register routes or activate an automation. All source tools remain in the assistant's cloud context. No completed private cycle is migrated or replayed.

## Stable scheduled sequence

Use the installed reviewed Node runtime with `--import tsx`; every path below must be explicit and private, outside Git.

1. `scripts/FinanceScheduledBridge.mjs scheduled-begin <dataDir>` before any provider or FamilyHub API call. Skip means stop. On a recovery admission, do not collect or apply.
2. `scripts/FinanceCloudReadback.mjs baseline <dataDir> <evidenceDir> <admissionFile>`. The baseline requires the live monthly account-capture capability and stores before collection. Do not reuse an earlier attempt's baseline.
3. The authorized cloud controller checks its admission before each Finances call, preserves complete native response/export bytes, and creates the manifest described in FINANCE-CLOUD-READBACK.md. No selected columns, incomplete cursor chain or preview-only CSV content may substitute for originals.
4. `scripts/FinanceCloudReadback.mjs prepare-account-capture <dataDir> <evidenceDir> <admissionFile> <manifestFile>` prepares the fourth snapshot wrapper only. Add its PrivateRef as manifest.accountCapture. Source input files/refs remain immutable.
5. `scripts/Run-FinanceIntakeController.mjs <dataDir> <evidenceDir> <admissionFile> <manifestFile>` is **preview-only**. It locally re-derives the exact four payloads from native-bound evidence and the baseline. Paired preview POSTs are explicitly apply:false and journaled first; no production store is changed.
6. After reviewing preview and within the same admitted window, run the same command with `--apply`. It requires the durable preview binding for that exact source plan. It uses only `/finances/import` (balance-observations-only), `/finance/source-inventory`, `/finance/source-expenses`, and `/finance/account-captures`, in that order. An empty canonical mapping is a balance-target no-op, never a reason to create accounts. No transaction-ledger import occurs.
7. Independently run `FinanceCloudReadback.mjs report ...`, then `finalize ...` with the private report reference. Controller intake-confirmed is **not** daily/global success. Missing dataset coverage, unsupported credit/forecast semantics or any verifier gap remains partial. The optional reportFile annotation is a local result locator, excluded from the intake source-plan fingerprint; all source refs, hashes, periods, scope and payloads remain bound.

No CLI accepts a clock override. Window/lease admission is checked before every API callback, every new preview/apply and recovery GET. Crossing the deadline leaves a pending outcome for later authorized read-only recovery. A manual "update now" is a separate request; it must not reset or forge scheduled daily completion.

## Revision, mutation and preservation contract

Preview binding records attempt/scope and the complete locally derived plan digest. Each apply invocation reads fresh authoritative state, verifies its exact composition, re-previews the bound payload at that target's fresh revision, saves the preview result, and proves that the entire snapshot stayed unchanged immediately before intent/apply. Payload changes or unrelated external history/revision changes fail closed.

The fourth target's revision is deliberately **not frozen at the initial all-target preview**. Applying inventory through the monthly worker can archive its prior legacy projection and expose a current legacy projection in account-captures. The controller proves those exact own changes, then previews the unchanged approved fourth payload again. Its returned capture and proposed revision must equal the deterministic expected appended history. No external revision change is accepted merely because a new GET returned it.

Global preservation checks keep canonical accounts/transactions/classifications/decisions/configuration unchanged, retain every prior import and balance observation, and accept only this plan's exact mapped balance observations and single corresponding import. Expense snapshots retain baseline history and may append only the exact bound capture. Inventory may move only from baseline to the derived snapshot. Account history retains every baseline row and allows only its exact current legacy projection plus the bound fourth source capture. Any unrelated append, removal, change or configuration drift blocks.

These composed-state checks remain in effect on resume. Earlier completed steps are checked per target while allowing only this controller's own later intents/proofs, so a valid inventory/expense/capture apply does not falsely invalidate the preceding balance step. Preservation assertions are not discarded on recovery.

## Durable journal and crash behavior

Private records live under `finance-feed/daily-gate/controller-<attemptId>/`. A cross-process exclusive controller.lock prevents overlap. Its age does not authorize stealing; after a process kill an operator must establish all owners stopped before clearing a stale lock. No automatic cleanup of another owner's lock or intent exists.

- Each preview POST has a durable immutable request record first.
- Each possible apply has a durable controller intent and shared bridge intent before POST. The intent binds payload, target revision, source plan, before-target state and preview. A shared intent without its controller proof blocks before any API.
- Transport errors never trigger another POST. An admitted GET is the only possible next network operation. Verified successful persistence may complete the step despite a lost response.
- If a crash occurs after intent but before POST, a later invocation uses GET only. Exact unchanged target and bound revision can establish `not-applied-readback-only`, but this **does not authorize resend**. Finalization/new-attempt policy must be resolved explicitly; the same operation is never automatically replayed.
- If a crash occurs after successful POST but before receipt, readback establishes the intended state without re-posting it. Later not-yet-intented steps may proceed only under an active collect admission and the reviewed binding.
- A renewed recovery admission may verify existing intents and write a new private proof without replacing older proofs. It cannot issue new preview/apply POSTs or collect source data. Missing steps return recovery-only-no-new-intake.
- Once the gate has finalized complete, an exact controller replay uses its sealed private proof and finalized gate/admission evidence before any API or journal mutation. It returns already-finalized-local.
- Once finalized **partial**, the released admission is refused locally with `attempt-finalized-partial-new-admission-required`, before any API. A later eligible scheduled attempt must obtain a new admission and fresh source capture; the old attempt is never revived.

Errors are sanitized reason/step codes, never financial fields, tokens or raw response bodies. Exact target state remains private. There is no multi-store transaction: a partial apply can occur before a later refusal, and journals/readback preserve that truth. Unknown outcomes remain pending; no blind rollback or reset is attempted.

## Validation and remaining activation gate

Synthetic tests use the actual finance and source stores, including the monthly capture/inventory legacy-append behavior. They cover fourth revision drift, preservation through later steps, unrelated concurrent changes, process overlap, missing capability, fabricated preview history, intent-before-POST crashes, lost responses, read-only renewed recovery, finalized complete/partial replays, and expiry/window checks with zero forbidden API calls.

A future real run still requires coordination with the sole runtime writer, reviewed deployed capabilities, valid local window/lease, fresh authentic source captures, preview review, explicit permitted intake, and independent receipt/finalization checks. This candidate performs none of those live steps and does not publish, deploy, schedule or alter the completed real cycle.
