import type { summarizeSourceExpenses } from "../../worker/src/finance-source-expenses-model";

type ClassifiedRows = ReturnType<typeof summarizeSourceExpenses>["rows"];
export type SourceCategoryTotal = { key: string; netCents: number; grossCents: number; refundCents: number; count: number };
/** Presentation of the existing classified subtotal only; never a second ledger. */
export function sourceCategoryTotals(rows: ClassifiedRows): SourceCategoryTotal[] {
  const groups = new Map<string, SourceCategoryTotal>();
  for (const { row, kind } of rows) {
    if (row.pending || (kind !== "expense" && kind !== "refund")) continue;
    const key = row.category.primary ?? "unknown";
    const group = groups.get(key) ?? { key, netCents: 0, grossCents: 0, refundCents: 0, count: 0 };
    group.netCents += row.outflowCents;
    if (kind === "expense") group.grossCents += row.outflowCents;
    else group.refundCents -= row.outflowCents;
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.netCents - a.netCents || a.key.localeCompare(b.key));
}
export function sourceCategoryIncludes(item: ClassifiedRows[number], category: string): boolean {
  return !item.row.pending && (item.kind === "expense" || item.kind === "refund") && (item.row.category.primary ?? "unknown") === category;
}
