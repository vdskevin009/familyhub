import {
  AdminSettings, FamilyState, PlannerState, ResearchState, ReimbursementState, SavingsState, SpendingState, WorkerConfig
} from "./types";
import { emptyMortgage, isoDay } from "./domain";

const today = new Date();
const day = (offset: number) => {
  const value = new Date(today);
  value.setDate(value.getDate() + offset);
  return isoDay(value);
};

export const defaultFamily: FamilyState = { SchemaVersion: 1, Entries: [] };
export const defaultSavings: SavingsState = { SchemaVersion: 1, Subscriptions: [], Offers: [], Mortgage: emptyMortgage() };
export const defaultReimbursements: ReimbursementState = { SchemaVersion: 2, Items: [], Reconciliations: [], CleanupSuggestions: [], ImportantMail: [], LearningDecisions: 0 };
export const defaultSpending: SpendingState = { SchemaVersion: 1, Transactions: [] };
export const defaultResearch: ResearchState = { SchemaVersion: 1, Watches: [] };
export const defaultWorker: WorkerConfig = { Endpoint: "", ApiKey: "" };
export const defaultAdmin: AdminSettings = { DriveRootName: "FamilyHub", ArchiveEnabled: true };

export const defaultPlanner: PlannerState = {
  SchemaVersion: 1,
  Recipes: [
    {
      Id: "recipe-pasta",
      Name: "Tomato basil pasta",
      PrepMinutes: 25,
      Tags: ["quick", "vegetarian"],
      Favourite: true,
      Ingredients: [
        { Name: "Pasta", Quantity: "1 pack" },
        { Name: "Tomatoes", Quantity: "5" },
        { Name: "Basil", Quantity: "1 bunch" },
        { Name: "Parmesan", Quantity: "1 small pack" }
      ]
    },
    {
      Id: "recipe-tacos",
      Name: "Black bean tacos",
      PrepMinutes: 25,
      Tags: ["quick", "vegetarian"],
      Favourite: true,
      Ingredients: [
        { Name: "Tortillas", Quantity: "1 pack" },
        { Name: "Black beans", Quantity: "2 cans" },
        { Name: "Avocado", Quantity: "2" },
        { Name: "Lime", Quantity: "2" },
        { Name: "Salsa", Quantity: "1 jar" }
      ]
    },
    {
      Id: "recipe-curry",
      Name: "Chickpea coconut curry",
      PrepMinutes: 35,
      Tags: ["batch", "vegetarian"],
      Favourite: false,
      Ingredients: [
        { Name: "Chickpeas", Quantity: "2 cans" },
        { Name: "Coconut milk", Quantity: "1 can" },
        { Name: "Spinach", Quantity: "1 bag" },
        { Name: "Rice", Quantity: "2 cups" }
      ]
    }
  ],
  Meals: [
    { Date: day(0), RecipeId: null, Note: "" },
    { Date: day(1), RecipeId: null, Note: "" }
  ],
  GroceryItems: []
};
