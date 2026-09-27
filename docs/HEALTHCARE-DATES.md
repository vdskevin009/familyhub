# Healthcare date, service and provider correction

Tracking: issue #40; requirements FH-REIMB-018/019, FH-REIMB-003/009/010/017.

## Diagnosis

Date-only `YYYY-MM-DD` values were formatted through `new Date(value)` in the device timezone. UTC midnight becomes the previous calendar day in western timezones. The ledger date can be correct while the displayed date is wrong.

Legacy forwarded healthcare receipts used the forwarding sender as provider, omitted service metadata, and often had no extracted service date. The Jane amount-repair pass only searched direct senders over a recent window and only copied monetary fields back. Legacy Desjardins statements kept submitted amounts in structured import notes while `BilledAmount` was null; matching did not consistently consume that evidence. A zero insurer payment could also fall through to unknown or an embedded payment.

The attachment reader flattens PDF whitespace. The billed appointment row must still be recognized, excluding the `Items and Payments` header, payment timestamps, printed dates and upcoming appointments. Negative amounts on card-payment lines after totals must never be interpreted as insurer adjustments.

## Behavior

- Format calendar dates in UTC after validating the actual date; format timestamps in the device timezone.
- Extract the clinic from labelled receipt evidence and retain the patient separately. Keep the billed appointment/service in both invoice and healthcare evidence.
- Expose service type on canonical cases; use it as the title when a real provider is unknown.
- Adapt legacy Desjardins submitted/service/payment-date facts without mutating the source records or fabricating a clinic.
- Match normalized service/member/date/currency/amount evidence. Reject explicit service conflicts and ties. Group compatible copies by invoice identity, retaining all document IDs.
- Use a uniquely linked primary statement to supply a missing gross amount for secondary matching, independent of input order. Preserve explicit zero payments and record supporting document IDs in evidence.
- Receipt repair v4 searches the supported historical period, including forwarded receipts. Its versioned cursor resumes failures and resets obsolete query cursors. It preserves classification, eligibility, IDs, decisions and ignored records.
- Where a Jane receipt gives an explicit insurer adjustment and the final patient total after GST, reconstruct the gross amount from those separate facts even without an `Amount not covered` label. A generic subtotal or unlabeled payment cannot establish it.
- Collector/reconciler instructions carry the same rules for future runs. Private documents and diagnostic source text are not committed.

## Verification and limitations

The normal CI suite covers dates in six timezones, timestamps, invalid dates, forwarded/plain/flattened source formats, service/provider titles, legacy submitted amounts, zero payments, secondary-first input, same-invoice copies, distinct invoices, conflicting services/persons/dates and resumable repair with decisions preserved. Existing authentication, import, history and .NET checks remain required.

Private read-only replay against available source receipts establishes the target arithmetic without manually editing the index. Installed-worker acceptance and public deployment must be recorded against the merged revision in issue #40. Phone visual acceptance is separate. Low-confidence classification, conflicting adjustments and incomplete insurer exports can still produce reviewable cases; zero secondary payment without a matching record means no payment found, not proof of insurer refusal.
