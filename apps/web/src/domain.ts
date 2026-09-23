import {
  AppView, AssistantInsight, BillingCycle, EntryKind, FamilyState, GroceryItem, MealAssignment,
  MortgageScenario, PlannerState, ReimbursementCategory, ReimbursementState, ReimbursementStatus, Repeat, SavingsState,
  SpendingState, SpendingTransaction
} from "./types";

export const currency = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function objectArray<T extends object>(value: T[] | undefined | null): T[] {
  return Array.isArray(value)
    ? value.filter((item): item is T => item !== null && typeof item === "object")
    : [];
}

export function annualSubscriptionCost(price: number, cycle: BillingCycle): number {
  return price * (cycle === BillingCycle.Annual ? 1 : cycle === BillingCycle.Weekly ? 52 : 12);
}

export function nextOccurrence(value: string, repeat: Repeat, today = new Date()): string {
  let date = new Date(value);
  const clock = { h: date.getHours(), m: date.getMinutes() };
  do {
    if (repeat === Repeat.Daily) date.setDate(date.getDate() + 1);
    else if (repeat === Repeat.Weekly) date.setDate(date.getDate() + 7);
    else if (repeat === Repeat.Monthly) date.setMonth(date.getMonth() + 1);
    else return value;
  } while (startOfDay(date).getTime() <= startOfDay(today).getTime());
  date.setHours(clock.h, clock.m, 0, 0);
  return date.toISOString();
}

export function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isoDay(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function mortgage(balance: number, annualRate: number, years: number, months: number) {
  if (balance <= 0 || years <= 0 || months <= 0) return { payment: 0, interest: 0, remaining: balance };
  const r = Math.pow(1 + annualRate / 200, 1 / 6) - 1;
  const payment = r === 0 ? balance / (years * 12) : balance * (r / (1 - Math.pow(1 + r, -years * 12)));
  let remaining = balance;
  let interest = 0;
  for (let i = 0; i < months; i += 1) {
    const charge = remaining * r;
    interest += charge;
    remaining = Math.max(0, remaining + charge - payment);
  }
  return { payment, interest, remaining };
}

const categoryRules: Array<[string, string[]]> = [
  ["Groceries", ["save-on", "whole foods", "costco", "superstore", "loblaws", "safeway", "grocery", "market"]],
  ["Dining", ["restaurant", "cafe", "coffee", "pizza", "sushi", "doordash", "uber eats", "skip"]],
  ["Home", ["hydro", "fortis", "internet", "telus", "rogers", "strata", "home depot", "ikea"]],
  ["Transport", ["translink", "uber", "lyft", "shell", "esso", "chevron", "parking"]],
  ["Health", ["pharmacy", "dental", "physio", "massage", "clinic", "medical"]],
  ["Subscriptions", ["netflix", "spotify", "apple.com/bill", "crave", "prime", "adobe", "microsoft"]],
  ["Travel", ["air canada", "westjet", "hotel", "airbnb", "booking", "expedia", "rail"]],
  ["Shopping", ["amazon", "walmart", "best buy", "canadian tire"]],
];

export function categorize(description: string): string {
  const value = description.toLowerCase();
  for (const [category, terms] of categoryRules) if (terms.some(term => value.includes(term))) return category;
  return "Other";
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "").replace(/[()]/g, match => match === "(" ? "-" : "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTransactionsCsv(text: string, sourceFile: string): SpendingTransaction[] {
  const lines = text.replace(/\r/g, "").split("\n").filter(line => line.trim().length > 0);
  if (lines.length < 2) throw new Error("The CSV needs a header row and at least one transaction.");
  const headers = splitCsvLine(lines[0]).map(value => value.toLowerCase());
  const find = (...candidates: string[]) => headers.findIndex(header => candidates.some(candidate => header.includes(candidate)));
  const dateIndex = find("date", "transaction date", "posted");
  const descriptionIndex = find("description", "merchant", "details", "name", "memo");
  const amountIndex = find("amount");
  const debitIndex = find("debit", "withdrawal");
  const creditIndex = find("credit", "deposit");
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0)) {
    throw new Error("Could not identify date, description and amount/debit columns. Export a standard transaction CSV.");
  }

  const output: SpendingTransaction[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const description = cells[descriptionIndex]?.trim();
    if (!description) continue;
    let amount: number | null = amountIndex >= 0 ? parseAmount(cells[amountIndex] ?? "") : null;
    if (amount === null && debitIndex >= 0) amount = parseAmount(cells[debitIndex] ?? "");
    if (amount === null) continue;
    if (creditIndex >= 0 && debitIndex >= 0 && !cells[debitIndex]?.trim()) {
      const credit = parseAmount(cells[creditIndex] ?? "");
      if (credit !== null) amount = -Math.abs(credit);
    }
    amount = Math.abs(amount);
    const parsedDate = new Date(cells[dateIndex] ?? "");
    if (Number.isNaN(parsedDate.getTime())) continue;
    output.push({
      Id: crypto.randomUUID(),
      Date: parsedDate.toISOString(),
      Description: description.slice(0, 180),
      Amount: amount,
      Category: categorize(description),
      SourceFile: sourceFile.slice(0, 120)
    });
  }
  if (output.length === 0) throw new Error("No valid transactions were found in the CSV.");
  return output;
}

export function currentMonthSpend(state: SpendingState): number {
  const now = new Date();
  return objectArray(state.Transactions)
    .filter(tx => {
      const date = new Date(tx.Date);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    })
    .reduce((sum, tx) => sum + (Number.isFinite(Number(tx.Amount)) ? Number(tx.Amount) : 0), 0);
}

function merchantKey(description: string): string {
  return description.toLowerCase().replace(/[0-9#*_.-]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
}

export function recurringCandidates(state: SpendingState): Array<{ merchant: string; count: number; average: number }> {
  const map = new Map<string, number[]>();
  for (const tx of objectArray(state.Transactions)) {
    const key = merchantKey(tx.Description);
    if (!key) continue;
    const values = map.get(key) ?? [];
    values.push(tx.Amount);
    map.set(key, values);
  }
  return [...map.entries()]
    .filter(([, values]) => values.length >= 2)
    .map(([merchant, values]) => ({ merchant, count: values.length, average: values.reduce((a, b) => a + b, 0) / values.length }))
    .filter(item => item.average >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export function buildGroceryList(planner: PlannerState): GroceryItem[] {
  const recipeMap = new Map(planner.Recipes.map(recipe => [recipe.Id, recipe]));
  const existingManual = planner.GroceryItems.filter(item => item.Source === "manual");
  const ingredientMap = new Map<string, string[]>();
  for (const meal of planner.Meals) {
    if (!meal.RecipeId) continue;
    const recipe = recipeMap.get(meal.RecipeId);
    for (const ingredient of recipe?.Ingredients ?? []) {
      const key = ingredient.Name.trim().toLowerCase();
      const list = ingredientMap.get(key) ?? [];
      if (ingredient.Quantity.trim()) list.push(ingredient.Quantity.trim());
      ingredientMap.set(key, list);
    }
  }
  const mealItems = [...ingredientMap.entries()].map(([name, quantities]) => ({
    Id: crypto.randomUUID(),
    Name: name.replace(/\b\w/g, char => char.toUpperCase()),
    Quantity: [...new Set(quantities)].join(" + "),
    Checked: false,
    Source: "meal" as const
  }));
  return [...existingManual, ...mealItems];
}

export function generateWeek(planner: PlannerState, start = new Date()): MealAssignment[] {
  const recipes = [...planner.Recipes].sort((a, b) => Number(b.Favourite) - Number(a.Favourite) || a.Name.localeCompare(b.Name));
  if (recipes.length === 0) return [];
  const monday = new Date(start);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const recipe = recipes[index % recipes.length];
    return { Date: isoDay(date), RecipeId: recipe.Id, Note: "" };
  });
}

export function assistantInsights(
  family: FamilyState,
  reimbursements: ReimbursementState,
  savings: SavingsState,
  planner: PlannerState,
  spending: SpendingState
): AssistantInsight[] {
  const insights: AssistantInsight[] = [];
  const today = startOfDay(new Date());
  const familyEntries = objectArray(family.Entries);
  const reimbursementItems = objectArray(reimbursements.Items);
  const reconciliations = objectArray(reimbursements.Reconciliations);
  const subscriptions = objectArray(savings.Subscriptions);
  const meals = objectArray(planner.Meals);
  const overdue = familyEntries.filter(entry => !entry.Done && startOfDay(new Date(entry.Due)) < today);
  if (overdue.length) insights.push({
    id: "overdue", tone: "urgent", eyebrow: "Needs attention", title: `${overdue.length} overdue plan${overdue.length > 1 ? "s" : ""}`,
    detail: "Clear the oldest items first so they stop getting lost in the week.", action: "plan"
  });

  const reconciled = reconciliations.filter(item => item.Action !== "complete");
  const claims = reimbursementItems.filter(item => !item.NeedsReview
    && (item.Status === ReimbursementStatus.ToReview || item.Status === ReimbursementStatus.ReadyToClaim)
    && (item.ReimbursementEligibility === "possible" || item.DocumentType === "claim" || item.Category === ReimbursementCategory.HealthBenefit));
  const claimAmount = reconciled.length
    ? reconciled.filter(item => item.Currency === "CAD").reduce((sum, item) => sum + (item.PotentialRemaining ?? 0), 0)
    : claims.filter(item => item.Currency === "CAD").reduce((sum, item) => sum + (item.DetectedAmount ?? 0), 0);
  if (claims.length || reconciled.length) insights.push({
    id: "claims", tone: "money", eyebrow: "Remboursements", title: `${reconciled.length || claims.length} dossier${(reconciled.length || claims.length) > 1 ? "s" : ""} à terminer`,
    detail: claimAmount > 0 ? `${currency.format(claimAmount)} reste potentiellement à vérifier auprès des assureurs; ce n'est pas un montant garanti.` : "Vérifiez les montants et les preuves avant toute demande.",
    action: "reimbursements"
  });

  const activeSubs = subscriptions.filter(item => !item.Cancelled);
  const flagged = activeSubs.filter(item => item.Review);
  if (flagged.length) {
    const annual = flagged.reduce((sum, item) => sum + annualSubscriptionCost(item.Price, item.Cycle), 0);
    insights.push({
      id: "subs", tone: "money", eyebrow: "Savings opportunity", title: `${flagged.length} subscription${flagged.length > 1 ? "s" : ""} flagged for review`,
      detail: `${currency.format(annual)} annualized cost is sitting in your review list.`, action: "money"
    });
  }

  const mortgage = savings.Mortgage;
  if (mortgage?.Renewal) {
    const days = Math.ceil((startOfDay(new Date(mortgage.Renewal)).getTime() - today.getTime()) / 86_400_000);
    if (days >= 0 && days <= 240) insights.push({
      id: "mortgage", tone: "money", eyebrow: "Upcoming renewal", title: `Mortgage renewal in ${days} days`,
      detail: "Keep the balance and comparison rates current so FamilyHub can surface the cost difference.", action: "money"
    });
  }

  if (meals.length === 0) insights.push({
    id: "meals", tone: "plan", eyebrow: "Make the week easier", title: "No meal plan yet",
    detail: "Build the week from your recipe list, then turn it into one grocery list.", action: "plan"
  });

  const spend = currentMonthSpend(spending);
  if (spend > 0) insights.push({
    id: "spend", tone: "info", eyebrow: "This month", title: `${currency.format(spend)} imported spending`,
    detail: "FamilyHub uses imported transactions to spot categories and recurring merchants. Bank data is not connected live.", action: "money"
  });

  if (!insights.length) insights.push({
    id: "clear", tone: "info", eyebrow: "All clear", title: "Nothing urgent is competing for attention",
    detail: "You can use the quick actions below to plan meals, scan the inbox or review money."
  });
  return insights.slice(0, 5);
}

export function buildAssistantContext(
  family: FamilyState,
  reimbursements: ReimbursementState,
  savings: SavingsState,
  planner: PlannerState,
  spending: SpendingState
): string {
  const upcoming = objectArray(family.Entries).filter(entry => !entry.Done).sort((a, b) => +new Date(a.Due) - +new Date(b.Due)).slice(0, 8);
  const activeSubs = objectArray(savings.Subscriptions).filter(item => !item.Cancelled);
  const reimbursementItems = objectArray(reimbursements.Items);
  const reconciliations = objectArray(reimbursements.Reconciliations);
  const spendingTransactions = objectArray(spending.Transactions);
  const categoryTotals = Object.entries(spendingTransactions.reduce<Record<string, number>>((acc, tx) => {
    acc[tx.Category] = (acc[tx.Category] ?? 0) + tx.Amount;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return JSON.stringify({
    upcomingPlans: upcoming.map(entry => ({ title: entry.Title, due: entry.Due, kind: EntryKind[entry.Kind], owner: entry.Owner })),
    reimbursementQueue: reimbursementItems.filter(item => !item.NeedsReview
      && item.Status <= ReimbursementStatus.ReadyToClaim
      && (item.ReimbursementEligibility === "possible" || item.DocumentType === "claim" || item.Category === ReimbursementCategory.HealthBenefit)).map(item => ({
      provider: item.Provider, member: item.Member, amount: item.DetectedAmount, billed: item.BilledAmount, reimbursed: item.ReimbursedAmount,
      insurer: item.Insurer, currency: item.Currency, type: item.DocumentType
    })).slice(0, 12),
    reimbursementAttention: reconciliations.slice(0, 8),
    subscriptions: activeSubs.map(item => ({ name: item.Name, annualized: annualSubscriptionCost(item.Price, item.Cycle), review: item.Review })),
    mortgage: savings.Mortgage,
    mealPlan: planner.Meals,
    spendingCategories: categoryTotals
  }, null, 2);
}

export const viewFromQuery = (): AppView => {
  const value = new URLSearchParams(location.search).get("view");
  return value === "inbox" || value === "reimbursements" || value === "plan" || value === "money" || value === "more" ? value : "today";
};

export const emptyMortgage = (): MortgageScenario => ({
  Balance: 0, BaseRate: 0, OfferRate: 0, Years: 25, TermMonths: 60, Fees: 0,
  Renewal: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString()
});
