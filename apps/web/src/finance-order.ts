/** UI-only ordering. Source facts, category keys and money calculations remain unchanged. */
import { expenseCategories, type ExpenseCategory } from "../../worker/src/finance-model";

export const sortedExpenseCategories = (Object.entries(expenseCategories) as [ExpenseCategory, string][])
    .sort((a, b) => a[1].localeCompare(b[1], "fr-CA", { sensitivity: "base" }) || a[0].localeCompare(b[0]));

export function byAmountDescending<T extends { outflowCents: number; date: string; id: string }>(a: T, b: T): number {
    return b.outflowCents - a.outflowCents || b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
}
