// Synthetic only. No provider identity or family financial value.
export function observationsFixture(state, capturedAt = "2026-11-01T12:34:56Z") {
  const accounts = state.data.accounts.filter(a => ["bank", "rrsp"].includes(a.id));
  return {
    schema: "familyhub.td.preparation.v1", importMode: "balance-observations-only", collectedOn: capturedAt.slice(0, 10), scope: { ...state.data.scope },
    collection: { retrievedAt: capturedAt, accountIds: accounts.map(a => a.id) },
    accounts: accounts.map(a => ({ accountId: a.id, identityFingerprint: a.identity, alias: a.name, type: a.type, currency: a.currency, observedBalanceCents: a.balanceCents, observedOn: a.asOf, identityEvidence: a.source.detail ?? { file: a.source.name, ...(a.source.sha256 ? { sha256: a.source.sha256 } : {}), ...(a.source.record === undefined ? {} : { record: a.source.record }), ...(a.source.page === undefined ? {} : { page: a.source.page }) } })),
    balanceObservations: accounts.map((a, i) => ({ accountId: a.id, currency: a.currency, balanceCents: 123456 + i * 200000, capturedAt, sourceAsOf: null, source: { file: "synthetic-linked-accounts.json", sha256: "b".repeat(64) } })),
    bankActivities: [], brokerageActivities: [], holdingsSnapshots: [], coverage: [], pendingActivities: [], limits: [],
  };
}
