import type { Quote, ProductKey } from "../../worker/src/mortgage-model";
export const percent = (n: number | null | undefined) => n === null || n === undefined ? "Indisponible" : `${new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} %`;
export const cad = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
export const productLabel = (p: ProductKey) => `${p.startsWith("fixed") ? "Fixe" : "Variable"} · ${p.endsWith("3") ? "3" : "5"} ans`;
export const variantLabel = (q: Quote) => q.variant === "adjustable-payment" ? "Paiements ajustables" : q.variant === "fixed-payment" ? "Paiements fixes" : q.variant === "unconfirmed-payment" ? "Paiements à confirmer" : "Taux fixe";
export const shortDate = (day: string) => new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", timeZone: "America/Vancouver" }).format(new Date(day + "T12:00:00Z"));
export const appointmentDate = (at: string) => new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Vancouver" }).format(new Date(at));
export const cashbackLabel = (q: Quote) => q.cashback ? `${q.cashback.basis === "total-incentive" ? "Remise totale" : "Remise"} ${cad(q.cashback.amount)}` : "Remise non confirmée";
export const visibleQuotes = (quotes: Quote[]) => quotes.filter(q => !quotes.some(next => next.supersedes === q.id));
