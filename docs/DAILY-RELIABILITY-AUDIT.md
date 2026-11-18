# Daily reliability corrections

Issue #305. Requirements: FH-OPS-001, FH-MAIL-008, FH-NOTIF-001, FH-PROACTIVE-004, FH-SAV-003/006 and FH-MORTGAGE-004.

## Observable problems and corrected behavior

| Trigger | Previous behavior | Corrected behavior |
| --- | --- | --- |
| A scan reads one insurer but cannot read a different collector | The unavailable collector's prior failure alert could disappear | Only completed evidence for the exact collector can retire its alert; syncing retains it |
| A near-expiry alert needs a short delay | Only a seven-day snooze was available | One-hour snooze, precise return time and a warning when seven days exceeds known validity |
| Daily runner sees existing busy work finish unsuccessfully | It could start another collection under the unrelated-work fallback | Uncertain failure stops; an explicitly completed continuation-ready invoice tranche may still continue |
| Pairing is rejected or the existing worker is briefly unavailable | Daily mail runner tried to create another process and redirect existing logs | Bounded health wait; the installed supervisor remains the owner of startup |
| Plugin retrieval fails | Structured cause was discarded, leaving only a generic error | Allowlisted failure codes/stages/counters survive restart and appear in paired status; raw/private content is excluded |
| A newly saved research job contains old or future source dates | Job completion could make it reusable | Both job and source clocks must satisfy the category/deadline cadence |
| An offer expires on an impossible calendar date | JavaScript date normalization could admit it | Strict calendar validation blocks intake and saved-estimate use |
| A client sees research complete while final save is still pending | A restart could lose the acknowledged complete result | Completion becomes visible after the atomic save |
| Mortgage evidence timestamps differ in fractional-second formatting | Lexical sorting could choose an older revision | Chronological sorting selects the latest instant |

## Scope and preservation

No change to financial calculations beyond source selection and invalid/stale evidence eligibility. Existing account/currency separation, unknown values, manual decisions, duplicate guards, fee/coverage equivalence and insurer submission boundaries remain intact. The changes do not configure sources, create schedules, change notification budgets, enroll devices or send tests. Short snooze remains an explicit owner decision. An expired event's validity is not assumed to be a contractual deadline.

Sanitized diagnostics are additive to schema 1. Unknown diagnostic fields are discarded at capture, reload and read-back; interrupted status does not inherit an unrelated failure cause. Existing records without diagnostics remain readable. The exact original cause of an already-discarded failure is not recoverable.

## Verification

Focused regressions cover both failing before/fixed after notification disappearance and unsafe busy-operation replay, explicit bounded continuation, refused pairing without a competing worker or log replacement, sanitized error retention/clearing/restart, stale/future source dates, invalid expiries, durable completion, and timestamp ordering. Browser checks exercise one-hour snooze, persistence/restore and the existing notification flow at 320/390/768/1440 pixels.

Record each gate independently in issue #305: local typechecks/builds, applicable domain/API tests, browser acceptance, complete CI (including retained .NET), published web revision, scoped installed-worker activation, natural daily outcomes and physical-phone receipt. Synthetic success cannot establish bank coverage, insurer authentication, tomorrow's run or actual savings. A healthy worker process alone does not establish completion of its scheduled sources.

## Operational follow-through

Use the authoritative scheduled installation and preserve protected state before activation. Compare each affected source module to the tested baseline. If a module differs, stage and validate only its narrow patch rather than replacing unrelated installed changes. Activation must preserve credentials, pairing, ledgers, manual decisions, source policy, schedule definitions and Push identity/history. Do not trigger collection or external actions as deployment checks.

Natural task failures, later manual recoveries, source freshness, daily finance adapter completeness and phone receipt remain separate audit findings. The private audit and illustrative proposals are kept outside this repository; neither contains permission for provider contact or financial action.
