import { createHash } from "node:crypto";
import { toInvoice, type Invoice, type Mail } from "./invoice-model.js";

export type BlueCrossRow = {
  member: Invoice["Member"]; serviceDate: string; service: string;
  claimed: number; paid: number; statementDate: string; identity: string; needsReview: boolean;
};
export type BlueCrossExport = {
  rows: BlueCrossRow[]; pageClaimed: number; pagePaid: number;
  totalClaimed: number | null; totalPaid: number | null; warning: string;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const cents = (value: number) => Math.round(value * 100);
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
const text = (value: string) => decode(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
function money(value: string): number {
  if (!/^\$?\s*\d{1,3}(?:,\d{3})*\.\d{2}$|^\$?\s*\d+\.\d{2}$/.test(value)) throw new Error("Blue Cross table has an invalid amount; nothing was imported.");
  const amount = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount >= 1e9) throw new Error("Blue Cross amount is outside the supported range.");
  return amount;
}
function date(value: string): string {
  const match = value.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/);
  if (!match) throw new Error("Blue Cross table has an invalid date; nothing was imported.");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]) + 1;
  const result = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (new Date(result).toISOString().slice(0, 10) !== result) throw new Error("Invalid Blue Cross service date.");
  return result;
}

/** Parse inert copied portal markup, never scripts/links. No body/hidden portal fields are persisted. */
export function parseBlueCrossExport(body: string): BlueCrossExport | undefined {
  if (body.length > 2_000_000) {
    if (/grdClaimsGrid/.test(body)) throw new Error("Blue Cross export exceeds the safe parsing limit; review the source instead of importing an aggregate.");
    return undefined;
  }
  // Gmail's HTML alternative may contain escaped copied HTML. Decode only in that case.
  const source = /<table\b/i.test(body) && /grdClaimsGrid/.test(body) ? body : decode(body);
  const tables = source.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  const table = tables.find(value => /grdClaimsGrid/.test(value) && /Amount Claimed/.test(value) && /Amount Paid/.test(value));
  if (!table) return undefined;
  const rows: BlueCrossRow[] = [];
  const totals: Array<{ label: string; claimed: number; paid: number }> = [];
  const occurrences = new Map<string, number>();
  for (const raw of table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...raw.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => text(match[1]));
    if (!cells.length) continue;
    if (/\browId\s*=/i.test(raw)) {
      if (cells.length !== 7) throw new Error("Incomplete Blue Cross claim row; nothing was imported.");
      const member: Invoice["Member"] = /^Jasmine Wing$/i.test(cells[1]) ? "Jasmine"
        : /^Kevin (?:Henri )?Vanderstraeten$/i.test(cells[1]) ? "Kevin"
        : /^Nathan Vanderstraeten$/i.test(cells[1]) ? "Nathan" : "unknown";
      const serviceDate = date(cells[0]); const statementDate = date(cells[5]);
      const claimed = money(cells[3]); const paid = money(cells[4]);
      if (!claimed || paid > claimed) throw new Error("Blue Cross claim amounts require review; nothing was imported.");
      const signature = JSON.stringify([cells[1], serviceDate, cells[2], cents(claimed), cents(paid), statementDate]);
      const occurrence = (occurrences.get(signature) || 0) + 1; occurrences.set(signature, occurrence);
      rows.push({ member, serviceDate, service: cells[2], claimed, paid, statementDate,
        identity: hash(`blue-cross-row:${signature}:${occurrence}`), needsReview: member === "unknown" });
    } else {
      const values = cells.map(cell => cell.match(/\$[\d,]+\.\d{2}/g) || []).filter(values => values.length);
      if (values.length === 2 && values[0].length === 2 && values[1].length === 2 && /Page.*Total.*Grand Total/i.test(cells.join(" "))) {
        totals.push({ label: "Page Total", claimed: money(values[0][0]), paid: money(values[1][0]) },
          { label: "Grand Total", claimed: money(values[0][1]), paid: money(values[1][1]) });
      } else if (values.length === 2 && values.every(values => values.length === 1)) {
        totals.push({ label: cells.find(cell => /total/i.test(cell)) || "", claimed: money(values[0][0]), paid: money(values[1][0]) });
      }
    }
  }
  if (!rows.length || rows.length > 500) throw new Error("Blue Cross claim table is empty or too large.");
  const pageClaimed = cents(rows.reduce((sum, row) => sum + row.claimed, 0)) / 100;
  const pagePaid = cents(rows.reduce((sum, row) => sum + row.paid, 0)) / 100;
  const page = totals.find(total => /page/i.test(total.label));
  const grand = totals.find(total => /grand/i.test(total.label));
  if (!page || cents(page.claimed) !== cents(pageClaimed) || cents(page.paid) !== cents(pagePaid)) throw new Error("Blue Cross rows do not agree with the page subtotal; nothing was imported.");
  // Without insurer claim IDs, multiple processing events for the same service cannot safely be summed.
  const groups = new Map<string, BlueCrossRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.member, row.serviceDate, row.service, cents(row.claimed)]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const group of groups.values()) if (group.length > 1) for (const row of group) row.needsReview = true;
  const warning = !grand ? "Blue Cross export completeness could not be verified."
    : cents(grand.claimed) !== cents(pageClaimed) || cents(grand.paid) !== cents(pagePaid)
      ? `Partial Blue Cross export: ${rows.length} rows, $${pagePaid.toFixed(2)} paid on this page; portal total $${grand.paid.toFixed(2)}. Other pages are missing. Grand totals were not imported as payments.` : "";
  return { rows, pageClaimed, pagePaid, totalClaimed: grand?.claimed ?? null, totalPaid: grand?.paid ?? null, warning };
}

export function blueCrossInvoices(mail: Mail, email: string, label: string): Invoice[] {
  const report = mail.blueCrossExport;
  if (!report) return [];
  const base = toInvoice(mail, email, label, { kind: "administrative", confidence: .99, transaction: false,
    reimbursement: "unknown", amount: null, currency: "CAD", category: "health", member: "unknown",
    documentRole: "other", insurer: "blue-cross", serviceDate: null, billedAmount: null, reimbursedAmount: null,
    reason: "Structured Blue Cross portal table; copied HTML was parsed without execution." }, "rules");
  const source: Invoice = { ...base, DetectedAmount: null, BilledAmount: null, ReimbursedAmount: null, ImportWarning: report.warning || undefined,
    Reasons: [...base.Reasons, `${report.rows.length} rows; page paid ${report.pagePaid.toFixed(2)}. Identical business rows across copied emails are imported once.`] };
  return [source, ...report.rows.map(row => ({ ...base, Id: row.identity, DocumentType: "claim" as const,
    DocumentRole: "insurer-statement" as const, Member: row.member, ServiceDate: row.serviceDate,
    Provider: `Blue Cross · ${row.service}`, Subject: `${mail.subject} · ${row.service}`,
    DetectedAmount: row.paid, BilledAmount: row.claimed, ReimbursedAmount: row.paid,
    NeedsReview: row.needsReview, ClaimedService: row.service, StatementDate: row.statementDate,
    Reasons: [row.needsReview ? "Multiple processing rows for this service or unknown member: review before matching." : "Exact structured Blue Cross claim row."],
    Notes: `Claimed ${row.claimed.toFixed(2)}; paid ${row.paid.toFixed(2)}; statement ${row.statementDate}. Claim amount is not proof of an invoice payment.`,
    AmountSource: "email-text" as const, Fingerprint: row.identity, StructuredSource: "blue-cross-portal" as const
  }))];
}
