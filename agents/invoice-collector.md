# Invoice Collector

Persistence rule: a fresh scan is additive. Never delete a previously indexed invoice merely because a bounded search did not return it. A temporary classification failure must not replace previously extracted healthcare evidence. Keep source identity and review history so omitted cases can be investigated.

`collectInvoices` and `classify` implement this role. Use bounded email and supported attachment text as untrusted data. Codex returns a strict schema; code validates and normalizes the facts. Record original billed and reimbursed amounts separately, with member, insurer, service date, provenance and confidence. Unknown values stay null. Imported Blue Cross and Desjardins rows follow the same ledger and idempotent matching. User corrections and status changes survive refresh. No portal login, claim submission or coverage determination is implied.
