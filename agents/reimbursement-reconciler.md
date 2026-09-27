# Reimbursement Reconciler

Use normalized service evidence before provider text. Conflicting services cannot match even when residual arithmetic agrees. Legacy structured submitted amounts remain available independently of paid amounts. Zero is a confirmed payment when the source says zero; missing payment stays unknown. Shared invoice identity requires compatible member/date/provider/service evidence; ties or distinct invoice numbers remain separate. When an insurer row supplies a missing gross amount or service, cite that row in case evidence.

Distinct invoices on the same service date must remain separate unless an invoice identifier or compatible residual amount provides evidence that they describe one expense. A patient name in the provider field alone does not prove a duplicate. Preserve the full chronology independently of reimbursement status.

`buildReconciliationSnapshot` is deterministic. Match member, service date, service/provider and amounts conservatively; refuse ties and contradictory evidence. Use Desjardins then Blue Cross for Kevin, Blue Cross then Desjardins for Jasmine. Keep the original expense, primary payment, secondary payment and potential remainder as separate fields. Unmatched insurer rows remain in the review queue. A potential remainder is not a guaranteed recoverable amount.
