import type { Quote, ProductKey } from "../../worker/src/mortgage-model";
export const percent = (n: number | null | undefined) => n === null || n === undefined ? "Unavailable" : `${new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}%`;
export const cad = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
export const productLabel = (p: ProductKey) => `${p.startsWith("fixed") ? "Fixed" : "Variable"} · ${p.endsWith("3") ? "3" : "5"} years`;
export const variantLabel = (q: Quote) => q.variant === "adjustable-payment" ? "Adjustable payments" : q.variant === "fixed-payment" ? "Fixed payments" : q.variant === "unconfirmed-payment" ? "Payments to confirm" : "Fixed rate";
export const shortDate = (day: string) => new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", timeZone: "America/Vancouver" }).format(new Date(day + "T12:00:00Z"));
export const appointmentDate = (at: string) => new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Vancouver" }).format(new Date(at));
export const cashbackLabel = (q: Quote) => q.cashback ? `${q.cashback.basis === "total-incentive" ? "Total incentive" : "Incentive"} ${cad(q.cashback.amount)}` : "Incentive not confirmed";
export const visibleQuotes = (quotes: Quote[]) => quotes.filter(q => !quotes.some(next => next.supersedes === q.id));
