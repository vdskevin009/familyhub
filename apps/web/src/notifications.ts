import type { NotificationTarget } from "../../worker/src/notification-model";
export const notificationLabels = { "open-claim": "Claims open for at least 14 days", "new-property": "New properties matching all four criteria", "new-vehicle": "New AWD SUVs priced below comparable listings", collection: "Blocked or stale collections", reimbursement: "Recorded reimbursements", unmatched: "Payments to match", price: "Changes in recurring charges", deadline: "Renewals and GIC maturities", weekly: "Weekly summary", mortgage: "Mortgage opportunities", policy: "Bank of Canada decisions", grocery: "Price drops on regular purchases", "claim-deadline": "Claim deadlines" };
export function notificationTargetHref(target: NotificationTarget): string {
  const query = new URLSearchParams({ view: target.view });
  if (target.recordId) query.set("record", target.recordId);
  if (target.queue) query.set("queue", target.queue);
  if (target.tab) query.set("tab", target.tab);
  if (target.accountId) query.set("account", target.accountId);
  if (target.from) query.set("from", target.from);
  if (target.to) query.set("to", target.to);
  if (target.currency) query.set("currency", target.currency);
  if (target.sources) query.set("sources", "1");
  return `${import.meta.env.BASE_URL}?${query}`;
}
export function pushSupported(): boolean { return window.isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window; }
export function applicationServerKey(encoded: string): Uint8Array<ArrayBuffer> {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
