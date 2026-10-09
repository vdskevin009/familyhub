import { createHash } from "node:crypto";
import { parseDesjardinsPages, type PortalHistoryRow, type PortalTableRow } from "./desjardins-collector.js";
import type { DesjardinsRow } from "./desjardins.js";

/** Operator-supplied original portal tables; this is selected-payment recovery, not a full history scan. */
export function parseDesjardinsBackfill(input: unknown, aliases: Readonly<Record<string, DesjardinsRow["member"]>> = {}, now = Date.now()) {
  const value = input as { sourceUrl?: unknown; capturedAt?: unknown; payments?: unknown };
  if (!value || value.sourceUrl !== "https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Rclmtn/RclmtnTrt/DetailReclamation_ClaimDetails.aspx"
    || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt))
    || now - Date.parse(value.capturedAt) > 24 * 60 * 60_000 || Date.parse(value.capturedAt) > now + 60_000
    || !Array.isArray(value.payments) || !value.payments.length || value.payments.length > 100)
    throw new Error("Provide recent original Desjardins payment tables from the claim detail page.");
  for (const payment of value.payments) {
    const p = payment as { history?: PortalHistoryRow; detail?: PortalTableRow[] };
    if (!p?.history || [p.history.date, p.history.method, p.history.paid, p.history.category].some(x => typeof x !== "string" || x.length > 200)
      || p.history.hasDetail !== true || !Array.isArray(p.detail) || !p.detail.length || p.detail.length > 500
      || p.detail.some(row => !row || !Array.isArray(row.cells) || !Array.isArray(row.colspans)
        || row.cells.length !== row.colspans.length || row.cells.length > 12
        || row.cells.some(cell => typeof cell !== "string" || cell.length > 1000)
        || row.colspans.some(span => !Number.isInteger(span) || span < 1 || span > 12)))
      throw new Error("Payment evidence contains an invalid portal table.");
  }
  const payments = value.payments as Array<{ history: PortalHistoryRow; detail: PortalTableRow[] }>;
  const collection = parseDesjardinsPages([{ histories: payments.map(p => p.history), details: payments.map(p => p.detail), hasNext: false }], [], aliases);
  collection.collectedAt = value.capturedAt;
  if (!collection.complete || collection.warnings.length) throw new Error("Payment evidence is incomplete or inconsistent; nothing was imported.");
  const evidence = { sourceUrl: value.sourceUrl, capturedAt: value.capturedAt, scope: "selected-payments", payments };
  const evidenceId = createHash("sha256").update(JSON.stringify(payments)).digest("hex");
  const totalCents = collection.rows.reduce((sum, row) => sum + Math.round((row.paid ?? 0) * 100), 0);
  return { collection, evidence, evidenceId, totalCents };
}
