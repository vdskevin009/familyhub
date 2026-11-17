# Started schema-2 finance recovery — candidate, issue #281

FH-FIN-027 / FH-FIN-028. This code is for independent review and synthetic validation.
It is not activated. Keep the pinned operational checkout, runtime, schedules,
security pins, source captures and financial stores unchanged until the coordinator
has reviewed the exact candidate and established exclusive ownership.

## Preparation correction

New packets specify `inventoryPolicy: retain-baseline-v1`. The legacy inventory has
one collection timestamp for balances, credit details and forecasts. The preparer
therefore retains the **entire** validated baseline inventory: accounts, links,
predictions, counts, availability and original date. Fresh recurring-source counts
describe the separate native capture; they never become a retained-forecast count.
The independent intake planner requires exact equality with the baseline. The
strict inventory validator is unchanged. A missing baseline inventory still blocks.

Fresh accounts, including new and disappeared source accounts, are represented by
the separately derived immutable account capture. Mapped balance observations and
source expenses use their existing targets. The controller's inventory target is
an already-imported no-op. Raw sections, original exports and receipt times remain
losslessly preserved. The independent report verifies the fresh account capture
and always marks retained inventory semantics partial. This fix does not implement
fresh forecast/credit derivation or claim full daily success. Legacy report replay
retains its old read-only verification contract; new intake plans require the new
policy and cannot reuse old preparation manifests.

## Supported recovery boundary

Only an expired schema-2 `preoperation-v1` **collect** admission with its exact
stored admission, original lease, started marker, pending state and baseline is
eligible. The current inference policy must exist and match the admitted pin.
Missing files, symbolic links/reparse points, changed scope, active phase/finalizer
locks, any current-attempt intent, or **any controller directory** fail closed.
This deliberately excludes even preview-only controller attempts and all uncertain
POST outcomes. A different recovery policy is required for those cases.

Independent local reads compare the full ledger, inventory, expenses and account
captures to the pre-intake baseline, plus Contributions configuration and projection.
Projection evaluation uses the baseline's date. Every imported source archive is
hash-verified; inference is recomputed from unchanged inputs and the pinned policy.
No HTTP call, source refresh, import or Contribution edit exists in this path.

## Coordination and evidence required before activation

1. The coordinator must suspend all financial intake, stop/drain the original
   cloud owner and all local controller/writer owners, and account for every
   previously authorized in-flight operation. Keep intake suspended until final
   verification and explicit handoff. A lease age, absent journal or process-count
   snapshot is not this evidence. Do not execute with an uncertain operation.
2. Preserve the original admission, lease, marker, state, baseline and captures.
   Independently read and reconcile the current four targets and Contributions.
   Inspection alone does not prove they will remain unchanged.
3. Outside Git, prepare a reviewed schema-2 proof matching `StartedRecoveryProof`:
   exact semantic admission/state/lease/marker digests, baseline byte SHA256,
   owner-evidence byte SHA256, and exact byte fingerprints for the fixed target,
   config, scope, inference and every imported-source file. The maintained verifier
   recomputes the complete expected file list and rejects additions/omissions.
4. The private owner evidence has `schema:1`, `kind:finance-owner-quiescence`,
   `admissionDigest`, `beforeStateDigest`, `leaseDigest`, `startedDigest`,
   `baselineSha256`, a named `coordinator`, `intakeSuspended:true`,
   `pendingOperations:0`, actual `observedAt`, and `expiresAt` at most 15 minutes
   later. It lists every owner exactly once with `id`, `status:stopped-and-drained`,
   relative `evidenceFile` and `evidenceSha256` pointing to authentic stop/drain
   transcripts. Observation must be after admission expiration.

The coordinator must independently review the transcript semantics. The software
checks byte identity, bindings and validity but cannot authenticate a remote
conversation or prove that an omitted cloud owner does not exist. Never manufacture
these attestations, use an arbitrary marker as stop evidence, or turn an expired
lease into an authorization. No helper generates live owner evidence automatically.

## Execution after reviewed coordination

Use PowerShell 7 with its existing permitted execution policy and the reviewed
Node installation. Do not change permissions or execution policy to run it.
From the reviewed isolated checkout, execute only after the above checkpoint:

```powershell
pwsh -NoProfile -File scripts/Recover-StartedFinance.ps1 `
  -DataDirectory <active-private-directory> -AdmissionFile <original-admission> `
  -BaselineFile <original-baseline> -ProofFile <reviewed-proof> `
  -OwnerEvidenceFile <reviewed-stop-and-drain-evidence> -NodePath <reviewed-node>
```

The parent PowerShell process opens existing protected files with `FileShare.Read`,
denying both writes and deletion/replacement. It owns both phase and finalizer
mutexes and is the **only process that mutates the gate**. The Node child is a
read-only verifier/planner; it creates no lock, archive or state, and cannot clear
the lease. Killing the holder therefore cannot leave a writing child after exclusion
is released. Write-access probes are diagnostics, not authority for exclusion;
the holder's actual .NET file handles establish it.

The holder archives the exact immutable partial/not-applied result, re-verifies,
atomically replaces state, reads it back, re-verifies again, then removes only the
exact original lease. The artifact contains exact before/after states and proof.
Daily status is **partial**, `complete:false`, `writeOutcome:not-applied`, original
attempt/start time retained. No successful receipt or daily success is created.
The financial files remain byte-identical and their deny-write/delete handles stay
open throughout gate mutation. Afterwards the coordinator independently verifies
the archive, partial state, original admission/marker and all protected bytes.

## Interruption and retry

Graceful failures clean up only mutexes owned by that invocation. The immutable
artifact permits exact replay after archive/state/lease stages while evidence is
still valid, never overwrites it, and rejects a later admission or foreign lease.
If killed, phase/finalizer files remain fail-closed; do not delete or reset them.
Expired owner evidence also blocks resumption. Either condition needs a separately
reviewed operator recovery, not an automatic retry or a changed proof forced onto
the old artifact. Temporary state files left by a crash are preserved for review.
Filesystem directory durability after power loss remains platform-dependent.

This invocation never collects again. A subsequent eligible attempt needs fresh
admission, baseline, source capture and preparation. Respect hourly timing and the
Vancouver window; never reuse the blocked attempt's packet for a new admission.
Source coverage gaps and unimplemented forecast/credit derivation remain explicit
partial outcomes even after the count failure is corrected.

## Local validation and independent review checkpoint

The full `npm run test:finances` run passed 375 tests. After the final gate-file
reparse hardening, all 35 recovery cases passed again, including real Windows
write/rename denial, concrete recovery, evidence rejection and forced holder
termination after archive and state commit. All five CI-shard/gate tests pass.
Typecheck and web/worker builds pass. The local .NET project compiled but Windows
Application Control blocked execution of its test assembly; no policy was changed.
Remote CI and publication remain separate gates.

An independent reviewer ran 159 distinct preparation/controller/readback/gate/
recovery checks and reran the positive holder plus both forced-kill cases after
hardening. No blocking source finding remains within the documented coordinator
trust boundary. Review resolved the initial parent/child exclusion-lifetime race,
mistaking access denial for exclusion authority, misleading legacy-date wording,
negative tests masking execution-policy failure, and reparse-path handling.
Windows coverage now has a dedicated required CI job; no execution-policy override
is used. This is source/synthetic acceptance only, with live activation/recovery
explicitly unperformed.
