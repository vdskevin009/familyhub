import type { NotificationTarget } from "../../worker/src/notification-model";
export const notificationLabels = { collection: "Collectes bloquées ou anciennes", reimbursement: "Remboursements enregistrés", unmatched: "Paiements à rapprocher", price: "Variations de prélèvements", deadline: "Échéances documentées", weekly: "Résumé hebdomadaire" };
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
