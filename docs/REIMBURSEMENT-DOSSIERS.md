# Reimbursement dossiers and actionable home priorities

Tracks #250 and #256 (FH-CLAIM-009 and FH-PROACTIVE-006). Deployment requires separate authorization.

## Behavior

The existing authenticated `POST /claim-preparation/preview` remains read-only. It now includes a deterministic source checklist: identity, original gross, currency, service/date, original PDF candidates, configured insurer order, primary response, local duplicate/conflict evidence and explicit unverified portal work. Source readiness means that known source facts can be prepared; it never means eligibility, no pending claim, selected provider, original PDF validation, uploaded-document success or final consent. Known zero adjudication remains zero; missing amounts remain null. An owner confirmation is never an imported explanation of benefits.

The PWA reads this preview on a direct original-expense dossier link or the optional “Pièces et préparation” action. The preview does not launch a browser, login, upload, collect, contact or modify an invoice. It cancels acceptance of stale responses on source, insurer, connection or component change. Failure leaves an explicit unverified state and a read-only retry. The checklist also derives from older compatible preview responses, so it does not falsely require a new worker release to display source gaps. The existing explicit Prepare action remains available; source conflicts/duplicates stay blocked server-side. Unsupported portal-dependent work remains a handoff.

Direct dossier mode suppresses list-only person totals and filters. The exact target identity stays visible and source/financial decisions are untouched. Return to list removes the direct-link parameters while restoring the existing session filters. A closed, ignored or insurer-inferred case does not gain a new preparation action.

Home ranks fresh verified deadlines within seven days first, then fresh preparable actions, then evidence completion and background follow-up. An insurance request with no received quote and more than seven days remaining becomes waiting follow-up, with no new contact. Date uncertainty cannot establish urgent priority. Quote arrival and genuine deadline escalation can reopen the opportunity; retrieval-time movement cannot. Insurance IDs and evidence hashes stay unchanged outside the new imminent-deadline bucket. Summary money tiles move below the actions; potential, recoverable and confirmed values stay separate.

Reimbursement ranking uses the same pure dossier projection as the PC preview: missing PDF, insurer order, primary response or recognized service cannot be called preparable merely because a residual is large. Claim evidence fingerprints now include source fields, PDF candidates, coordination and gross provenance; existing claim decisions remain stored, while a card from the previous narrower evidence scope may require review once. Stable insurance waiting fingerprints are preserved exactly. No financial/manual workflow decision is migrated or changed.

## Validation contract

- Unit projection: known/zero/unknown money, invalid date/currency/order, no PDF, duplicate copies, possible/recorded duplicate, protected conflict, supported/unobserved service, genuine-vs-owner explanation and immutable source records.
- Priority: ready action before a larger uncertain amount or passive waiting; verified deadline escalation; unknown/stale date never urgent; quote arrival; stable decisions/fingerprints on ordinary refresh and stable ordering.
- UI: exact record independent of prior person/filter scope, safe return, preview-only requests, explicit preparation boundary, older-worker compatibility, loading/failure, stale-response isolation and 320/360/384/390/412/1280 widths.
- Regression: TypeScript/build, existing opportunities/lifecycle, invoice financial/manual-authority preservation, claims and retained .NET checks. Synthetic browser tests never contact real insurers or the installed worker.

## Separate acceptance gates

This first slice does not implement automatic portal-history verification or a durable journal of pending preparation attempts. It does not extend the observed insurer forms or weaken the existing upload no-replay guards. Live portal read-back, actual named upload success, physical S24 use, CI, publication and installed-worker deployment are separate. Production remains untouched during preparation.
