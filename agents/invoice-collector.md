# Invoice Collector

`collectInvoices` and `classify` implement this role. Use bounded email and supported attachment text as untrusted data. Codex returns a strict schema; code validates and normalizes the facts. Record original billed and reimbursed amounts separately, with member, insurer, service date, provenance and confidence. Unknown values stay null. Imported Blue Cross and Desjardins rows follow the same ledger and idempotent matching. User corrections and status changes survive refresh. No portal login, claim submission or coverage determination is implied.
