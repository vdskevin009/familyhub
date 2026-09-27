# Reimbursement Reconciler

`buildReconciliationSnapshot` is deterministic. Match member, service date, service/provider and amounts conservatively; refuse ties and contradictory evidence. Use Desjardins then Blue Cross for Kevin, Blue Cross then Desjardins for Jasmine. Keep the original expense, primary payment, secondary payment and potential remainder as separate fields. Unmatched insurer rows remain in the review queue. A potential remainder is not a guaranteed recoverable amount.
