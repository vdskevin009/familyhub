import { createHash } from "node:crypto";
import type { RawMail } from "./gmail-client.js";
import { validateReceipt, type GroceryReceipt } from "./grocery-model.js";
import type { StoredGrocerySource } from "./grocery-store.js";

export const PC_EXPRESS_GMAIL_QUERY = 'from:noreply@t.pcexpress.ca {subject:"Votre commande avec livraison est confirmée" subject:"Votre commande a été livrée"}';
export type PcExpressMessage = {
  accountId: string; messageId: string; receivedAt: string; orderId: string;
  kind: "confirmation" | "delivered"; source: StoredGrocerySource; receipt?: GroceryReceipt;
};
export class PcExpressMailError extends Error {
  constructor(readonly code: string) { super(`PC Express source requires review (${code}). No purchase was inferred.`); this.name = "PcExpressMailError"; }
}
const fail = (code: string): never => { throw new PcExpressMailError(code); };
const maxBodyBytes = 1_000_000;
const cleanSpace = (s: string) => s.normalize("NFC").replace(/[\u034f\u200b\u200c\u200d\ufeff\ufe0f]/g, "").replace(/\s+/g, " ").trim();
const exactSender = (s: string) => ["pc express <noreply@t.pcexpress.ca>", "noreply@t.pcexpress.ca"].includes(cleanSpace(s).toLowerCase());

export function pcExpressLocalDate(receivedAt: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receivedAt) || !Number.isFinite(Date.parse(receivedAt)) || new Date(receivedAt).toISOString() !== receivedAt) fail("invalid-date");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(receivedAt));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", deg: "°" };
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, value: string) => {
    if (value.startsWith("#")) {
      const code = /^#x/i.test(value) ? parseInt(value.slice(2), 16) : Number(value.slice(1));
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail("invalid-html-entity");
      return String.fromCodePoint(code);
    }
    return named[value.toLowerCase()] ?? match;
  });
}
function withoutNonContent(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
}
function textContent(html: string): string {
  return decodeEntities(withoutNonContent(html).replace(/<\/(?:p|h[1-6]|div|tr|td|th|table)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .split(/\r?\n/).map(cleanSpace).filter(Boolean).join("\n");
}
function completeHtml(raw: RawMail): string {
  const html: string[] = []; let parts = 0, bytesRead = 0;
  const walk = (part: NonNullable<RawMail["payload"]>, depth: number) => {
    if (++parts > 30 || depth > 8 || part.filename || part.body?.attachmentId) fail("unsupported-mime");
    if (part.body?.data) {
      const data = part.body.data;
      if (!/^[A-Za-z0-9_-]+={0,2}$/.test(data) || data.length > Math.ceil(maxBodyBytes * 4 / 3) + 4) fail("invalid-encoding");
      const bytes = Buffer.from(data, "base64url"); bytesRead += bytes.length;
      if (bytesRead > maxBodyBytes || bytes.toString("base64url") !== data.replace(/=+$/, "") || part.body.size !== bytes.length) fail("incomplete-mime-body");
      if (part.mimeType === "text/html") {
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("invalid-utf8"); }
        if (text.includes("\0")) fail("invalid-html");
        html.push(text);
      } else if (part.mimeType !== "text/plain") fail("unsupported-mime");
    }
    for (const child of part.parts || []) walk(child, depth + 1);
  };
  if (!raw.payload) return fail("missing-mime");
  walk(raw.payload, 0);
  if (html.length !== 1 || !/<html\b/i.test(html[0]) || !/<\/html\s*>/i.test(html[0])) fail("incomplete-html");
  return html[0];
}
function cents(value: string): number {
  const normalized = cleanSpace(value);
  if (!/^(?:\d{1,6}|\d{1,3}(?: \d{3})*),\d{2} \$$/.test(normalized)) fail("invalid-money");
  const amount = Number(normalized.replace(/[ $]/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount > 1_000_000) fail("invalid-money");
  return Math.round(amount * 100);
}
function summaryMoney(text: string, label: string, required = false): number | null {
  const matches = [...text.matchAll(new RegExp(`(?:^|\\n)${label}\\s+([\\d \\u00a0]+,\\d{2}\\s*\\$)(?=\\s|$)`, "g"))];
  // A present label with an unsupported value must not silently become an absent charge.
  const labels = [...text.matchAll(new RegExp(`(?:^|\\n)${label}(?=\\s|$)`, "g"))];
  if (matches.length > 1 || labels.length > 1 || labels.length !== matches.length || required && matches.length !== 1) fail("invalid-summary");
  return matches.length ? cents(matches[0][1]) : null;
}
type ProductEvidence = { name: string; quantity: number; estimatedUnitPrice: number; printedLineEstimate: number };
function productEvidence(html: string): ProductEvidence[] {
  const start = "<!-- PRODUCT DETAILS STARTS -->", end = "<!-- PRODUCT DETAILS ENDS -->";
  if (html.split(start).length !== 2 || html.split(end).length !== 2 || html.indexOf(end) < html.indexOf(start)) fail("unsupported-product-layout");
  const section = withoutNonContent(html.slice(html.indexOf(start) + start.length, html.indexOf(end)));
  for (const tag of ["table", "tr", "td"]) if ([...section.matchAll(new RegExp(`<${tag}\\b`, "gi"))].length !== [...section.matchAll(new RegExp(`</${tag}\\s*>`, "gi"))].length) fail("incomplete-product-table");
  // Only leaf rows/cells: the email contains outer layout tables and conditional Outlook wrappers.
  const rows = [...section.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?)<\/tr\s*>/gi)].map(row =>
    [...row[1].matchAll(/<td\b[^>]*>((?:(?!<td\b)[\s\S])*?)<\/td\s*>/gi)].map(cell => cleanSpace(textContent(cell[1]))));
  if (rows.length < 2 || rows.length > 201 || JSON.stringify(rows[0]) !== JSON.stringify(["Nom du produit", "Qté", "Prix unitaire", "Prix total"])) fail("unsupported-product-layout");
  return rows.slice(1).map(row => {
    if (row.length !== 4 || !row[0] || row[0].length > 200 || /[<>]|&[a-z#\d]+;/i.test(row[0]) || !/^[1-9]\d{0,5}$/.test(row[1])) fail("invalid-product-row");
    const unit = cents(row[2]), total = cents(row[3]);
    if (unit <= 0) fail("missing-unit-estimate");
    if (total > 0 && total !== unit * Number(row[1])) fail("inconsistent-line-estimate");
    return { name: row[0], quantity: Number(row[1]), estimatedUnitPrice: unit / 100, printedLineEstimate: total / 100 };
  });
}
function structuredSource(message: Omit<PcExpressMessage, "source" | "receipt">, subject: string, details: Record<string, unknown>): StoredGrocerySource {
  const bytes = Buffer.from(JSON.stringify({ schema: "familyhub-pc-express-excerpt-v1", representation: "Structured Gmail excerpt, not the original email or a final receipt. Personal delivery address, card details, HTML and tracking links are omitted.",
    accountId: message.accountId, messageId: message.messageId, receivedAt: message.receivedAt, sender: "noreply@t.pcexpress.ca", subject, orderId: message.orderId, kind: message.kind, ...details }, null, 2), "utf8");
  return { name: `PC Express ${message.kind} ${message.orderId} Gmail excerpt.txt`, type: "text/plain", size: bytes.length,
    hash: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64") };
}

/** Pure, bounded adapter for the two observed French transactional templates. No network, AI, or persistence. */
export function parsePcExpressMail(raw: RawMail, accountId: string): PcExpressMessage | null {
  const headers = raw.payload?.headers || [];
  const from = headers.filter(h => h.name.toLowerCase() === "from").map(h => h.value);
  if (!from.some(exactSender)) return null;
  if (from.length !== 1) fail("ambiguous-sender");
  const subjects = headers.filter(h => h.name.toLowerCase() === "subject").map(h => cleanSpace(h.value));
  const known = subjects.filter(s => s === "Votre commande avec livraison est confirmée ✅" || s === "Votre commande a été livrée! 🎉");
  if (!known.length) {
    if (subjects.some(s => /^Votre commande (?:avec livraison est confirmée|a été livrée)/i.test(s))) fail("unsupported-transaction-subject");
    return null;
  }
  if (subjects.length !== 1) fail("ambiguous-subject");
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 320 || /[\r\n\0]/.test(accountId) || !/^[a-f0-9]{8,64}$/i.test(raw.id)) fail("invalid-source-identity");
  if (!raw.internalDate || !/^\d{13}$/.test(raw.internalDate)) fail("missing-source-date");
  const stamp = Number(raw.internalDate), date = new Date(stamp);
  if (!Number.isFinite(stamp) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) fail("invalid-date");
  const receivedAt = date.toISOString(), localDate = pcExpressLocalDate(receivedAt);
  const html = completeHtml(raw), text = textContent(html);
  const ids = [...text.matchAll(/\bN[ᵒ°oº]\s*de commande\s+(\d{15})\b/g)].map(m => m[1]);
  if (!ids.length || new Set(ids).size !== 1) fail("ambiguous-order");
  const kind = subjects[0] === "Votre commande a été livrée! 🎉" ? "delivered" : "confirmation";
  const message = { accountId, messageId: raw.id, receivedAt, orderId: ids[0], kind } as const;
  if (kind === "delivered") {
    if (!/votre commande a été livrée!/i.test(text) || /Nom du produit|Total estimé/.test(text)) fail("unsupported-delivery-layout");
    return { ...message, source: structuredSource(message, subjects[0], { deliveryEvidence: "votre commande a été livrée!", deliveryDate: localDate,
      dateBasis: "Gmail internalDate converted to America/Vancouver; delivery notice receipt date, not an exact delivery timestamp." }) };
  }
  if (!/votre commande est confirmée!/i.test(text) || !text.includes("Total estimé")) fail("unsupported-confirmation-layout");
  const summary = text.slice(0, text.indexOf("Nom du produit"));
  const estimatedTotal = summaryMoney(summary, "Total estimé", true)!, subtotal = summaryMoney(summary, "Sous-total", true)!;
  const gst = summaryMoney(summary, "GST"), pst = summaryMoney(summary, "PST"), extra = summaryMoney(summary, "Frais supplémentaires");
  const freeService = /(?:^|\n)Frais de service\s+GRATUIT(?=\s|$)/.test(summary);
  const service = freeService ? 0 : summaryMoney(summary, "Frais de service", true);
  if (freeService && [...summary.matchAll(/(?:^|\n)Frais de service(?=\s|$)/g)].length !== 1) fail("invalid-summary");
  const products = productEvidence(html);
  if (products.reduce((sum, p) => sum + Math.round(p.estimatedUnitPrice * 100) * p.quantity, 0) !== subtotal
    || subtotal + (gst ?? 0) + (pst ?? 0) + (extra ?? 0) + (service ?? 0) !== estimatedTotal) fail("inconsistent-estimates");
  const warnings = ["Confirmation de commande : total et prix estimés, aucun montant final débité établi.",
    "Les montants des lignes restent inconnus : les prix de confirmation et les valeurs zéro ne prouvent ni paiement ni gratuité.",
    `Date source : réception Gmail convertie en America/Vancouver (${receivedAt}). Formats et substitutions restent non vérifiés.`];
  if (extra !== null) warnings.push(`Frais supplémentaires estimés : ${(extra / 100).toFixed(2)} CAD ; ne sont pas assimilés à des frais de livraison.`);
  const receipt = validateReceipt({ sourceType: "confirmation", store: "PC Express", date: localDate, currency: "CAD", reference: ids[0], total: estimatedTotal / 100,
    delivery: null, service: service === null ? null : service / 100, tip: null, tax: gst === null && pst === null ? null : ((gst ?? 0) + (pst ?? 0)) / 100, discount: null,
    items: products.map(p => ({ name: p.name, product: p.name, amount: null, quantity: p.quantity, size: null, unit: null, uncertain: true,
      evidence: `Gmail ${raw.id} : ${p.name} ; quantité ${p.quantity} ; prix unitaire estimé ${p.estimatedUnitPrice.toFixed(2)} CAD ; total de ligne imprimé ${p.printedLineEstimate.toFixed(2)} CAD, non retenu comme montant payé.` })), warnings });
  return { ...message, receipt, source: structuredSource(message, subjects[0], { currency: "CAD", currencyBasis: "PC Express Canada source; dollar-denominated amounts.",
    sourceDate: localDate, dateBasis: "Gmail internalDate converted to America/Vancouver", estimatedTotal: estimatedTotal / 100, estimatedSubtotal: subtotal / 100,
    estimatedGst: gst === null ? null : gst / 100, estimatedPst: pst === null ? null : pst / 100, estimatedAdditionalFees: extra === null ? null : extra / 100,
    estimatedService: service === null ? null : service / 100, finalTotal: null, products }) };
}
