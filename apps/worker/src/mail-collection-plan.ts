import { createHash } from "node:crypto";
import type { Invoice } from "./invoice-model.js";
import { PC_EXPRESS_GMAIL_QUERY } from "./pc-express-mail.js";
export type MailWindow = { after: number; before: number; page?: string };
export type InvoiceProgress = { transport?: "plugin-batch"; through?: number; window?: MailWindow; error?: string; lastSuccess?: string; healthReceiptRepairVersion?: number; healthReceiptRepairPage?: string; healthReceiptRepairTargetVersion?: number; invoiceHistoryVersion?: number; invoiceHistoryWindow?: MailWindow; invoiceHistoryThrough?: number; invoiceHistoryExamined?: number };
export const invoiceHistoryStart = Math.floor(Date.parse("2025-06-01T00:00:00-07:00") / 1000) - 1;
export const invoiceHistoryVersion = 1;
export const healthReceiptRepairVersion = 4;
const invoiceSignals = '{receipt invoice facture reçu recu reimbursement remboursement claim statement "payment confirmation" "amount due" "explanation of benefits" "blue cross" "croix bleue" desjardins has:attachment}';
const invoiceExclusions = '-in:spam -in:trash -in:sent -in:drafts -from:notifications@github.com';

const epoch = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid planning instant."); return n; };
export function invoiceWindow(progress: InvoiceProgress, at: number): MailWindow {
  epoch(at);
  return structuredClone(progress.window || { after: Math.max(0, (progress.through || at - 30 * 86400) - 2 * 86400), before: at });
}
export function historyWindow(progress: InvoiceProgress, at: number): MailWindow {
  epoch(at); return structuredClone(progress.invoiceHistoryWindow || { after: invoiceHistoryStart, before: at });
}
export function groceryWindow(progress: { through?: number; window?: MailWindow }, at: number): MailWindow {
  epoch(at); return structuredClone(progress.window || { after: Math.max(0, progress.through === undefined ? at - 30 * 86400 : progress.through - 2 * 86400), before: at });
}
export function mailListRequest(q: string, page?: string, maxResults = 50) {
  const params = new URLSearchParams({ q, maxResults: String(maxResults), ...(page ? { pageToken: page } : {}) });
  return { q, maxResults, ...(page ? { pageToken: page } : {}), path: 'messages?' + params };
}
export function incrementalRequest(window: MailWindow) { return mailListRequest(`after:${window.after} before:${window.before} {receipt invoice facture reçu recu reimbursement remboursement claim statement has:attachment "payment confirmation" "amount due" "booking confirmation" "reservation confirmation" "explanation of benefits" "renewal notice" "blue cross" "croix bleue" desjardins "security alert" "new sign-in" "password changed" "action required" "response required" "account limited" "temporary limitations" "action requise" "réponse requise"} ${invoiceExclusions}`, window.page); }
export function repairRequest(page?: string) { return mailListRequest(`after:${invoiceHistoryStart} subject:"Your Receipt" -in:trash -in:spam`, page); }
export function historyRequest(window: MailWindow) { return mailListRequest(`after:${window.after} before:${window.before} ${invoiceSignals} ${invoiceExclusions}`, window.page); }
export function groceryRequest(window: MailWindow, pageSize = 50) { return mailListRequest(`${PC_EXPRESS_GMAIL_QUERY} after:${window.after} before:${window.before} -in:sent -in:drafts -in:spam -in:trash`, window.page, pageSize); }
export function needsInvoiceUpgrade(item: Invoice): boolean { return item.AnalysisVersion !== 4 || !item.DocumentRole || !item.Member || !("BilledAmount" in item); }
export function upgradeCandidates(items: readonly Invoice[], email: string): Invoice[] {
  return items.filter(item => item.AccountEmail === email && item.SourceMessageId && !item.StructuredSource && needsInvoiceUpgrade(item)).slice(0, 25);
}
export function retryCandidates(items: readonly Invoice[], email: string): Invoice[] {
  return items.filter(item => item.AccountEmail === email && item.ClassificationSource === "unavailable" && !item.CorrectedAt).slice(0, 10);
}
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
/** Snapshot only. Later stages are conditional, and candidate reads may be skipped by manual authority or an earlier successful upgrade. */
export function planInvoiceMail(progress: InvoiceProgress, items: readonly Invoice[], email: string, at: number) {
  const window = invoiceWindow(progress, at), history = historyWindow(progress, at);
  const knownHistory = progress.invoiceHistoryVersion === invoiceHistoryVersion;
  return frozen({ account: email, at, fingerprint: createHash("sha256").update(JSON.stringify({ progress, items: items.filter(item => item.AccountEmail === email) })).digest("hex"), window, incremental: incrementalRequest(window),
    repair: progress.healthReceiptRepairVersion !== healthReceiptRepairVersion ? { afterIncrementalComplete: true, request: repairRequest(progress.healthReceiptRepairTargetVersion === healthReceiptRepairVersion ? progress.healthReceiptRepairPage : undefined) } : undefined,
    history: !knownHistory ? { afterIncrementalComplete: true, window: history, request: historyRequest(history) } : undefined,
    upgradeMessageIds: knownHistory ? upgradeCandidates(items, email).map(item => item.SourceMessageId) : [],
    retryMessageIds: knownHistory ? items.filter(item => item.AccountEmail === email && item.ClassificationSource === "unavailable" && !item.CorrectedAt).slice(0, 35).map(item => item.SourceMessageId) : [],
    maxPagesPerStage: 2, retryReadBudget: 10, upgradeReadBudget: 25, candidateReadsAreConditional: true });
}
export function planGroceryMail(progress: { through?: number; window?: MailWindow; [key: string]: unknown }, email: string, at: number, pageSize = 50) {
  const window = groceryWindow(progress, at);
  return frozen({ account: email, at, fingerprint: createHash("sha256").update(JSON.stringify(progress)).digest("hex"), window, request: groceryRequest(window, pageSize) });
}

export type InvoiceMailPlan = ReturnType<typeof planInvoiceMail>;
export type GroceryMailPlan = ReturnType<typeof planGroceryMail>;
