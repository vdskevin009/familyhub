export type AppView = "today" | "inbox" | "plan" | "money" | "more";

export enum EntryKind { Task = 0, Grocery = 1, Meal = 2, Appointment = 3, Reminder = 4 }
export enum Repeat { Never = 0, Daily = 1, Weekly = 2, Monthly = 3 }

export type FamilyEntry = {
  Id: string;
  Title: string;
  Owner: string;
  Kind: EntryKind;
  Due: string;
  Repeat: Repeat;
  Done: boolean;
  Notes: string;
};

export type FamilyState = {
  SchemaVersion: number;
  Entries: FamilyEntry[];
};

export enum BillingCycle { Monthly = 0, Annual = 1, Weekly = 2 }
export type Subscription = {
  Id: string;
  Name: string;
  Price: number;
  Cycle: BillingCycle;
  Renewal: string;
  Review: boolean;
  Cancelled: boolean;
};

export enum GroceryUnit { Kg = 0, Litre = 1, Each = 2 }
export type GroceryOffer = {
  Id: string;
  Product: string;
  Store: string;
  Price: number;
  Size: number;
  Unit: GroceryUnit;
  ValidUntil: string;
};

export type MortgageScenario = {
  Balance: number;
  BaseRate: number;
  OfferRate: number;
  Years: number;
  TermMonths: number;
  Fees: number;
  Renewal: string;
};

export type SavingsState = {
  SchemaVersion: number;
  Subscriptions: Subscription[];
  Offers: GroceryOffer[];
  Mortgage: MortgageScenario;
};

export enum ReimbursementCategory { HealthBenefit = 0, Travel = 1, Other = 2 }
export enum ReimbursementStatus { ToReview = 0, ReadyToClaim = 1, Claimed = 2, Reimbursed = 3, Ignored = 4 }

export type ReimbursementAttachment = {
  Id: string;
  FileName: string;
  MimeType: string;
  Size: number;
};

export type ReimbursementItem = {
  Id: string;
  AccountLabel: string;
  AccountEmail: string;
  SourceMessageId: string;
  ThreadId: string;
  InternetMessageId: string;
  Subject: string;
  Sender: string;
  Provider: string;
  ReceivedAt: string;
  Category: ReimbursementCategory;
  Status: ReimbursementStatus;
  DetectedAmount: number | null;
  Currency: string;
  Confidence: number;
  Notes: string;
  Attachments: ReimbursementAttachment[];
  DocumentType?: "receipt" | "invoice" | "claim" | "bill" | "administrative" | "other" | "marketing" | "ignore";
  WorkerManaged?: boolean;
  NeedsReview?: boolean;
  ReimbursementEligibility?: "possible" | "unknown" | "no";
  ClassificationSource?: "rules" | "codex" | "manual" | "unavailable";
  CorrectedAt?: string;
  UpdatedAt?: string;
  Reasons?: string[];
  DriveFileId?: string;
  DrivePath?: string;
  ArchivedAt?: string;
};

export type ReimbursementState = {
  SchemaVersion: number;
  Items: ReimbursementItem[];
};

export type ScanStats = {
  scanned: number;
  kept: number;
  filteredNoise: number;
  noDocumentSignal: number;
};

export type GroceryItem = {
  Id: string;
  Name: string;
  Quantity: string;
  Checked: boolean;
  Source: "manual" | "meal";
};

export type RecipeIngredient = { Name: string; Quantity: string };
export type Recipe = {
  Id: string;
  Name: string;
  PrepMinutes: number;
  Tags: string[];
  Ingredients: RecipeIngredient[];
  Favourite: boolean;
};

export type MealAssignment = {
  Date: string;
  RecipeId: string | null;
  Note: string;
};

export type PlannerState = {
  SchemaVersion: number;
  Recipes: Recipe[];
  Meals: MealAssignment[];
  GroceryItems: GroceryItem[];
};

export type SpendingTransaction = {
  Id: string;
  Date: string;
  Description: string;
  Amount: number;
  Category: string;
  SourceFile: string;
};

export type SpendingState = {
  SchemaVersion: number;
  Transactions: SpendingTransaction[];
  LastImportAt?: string;
};

export type ResearchWatch = {
  Id: string;
  Query: string;
  TargetPrice?: number | null;
  Sources: string;
  Auto: boolean;
  CadenceHours: number;
  LastRunAt?: string;
  LastResult?: string;
  LastResultAt?: string;
};

export type ResearchState = {
  SchemaVersion: number;
  Watches: ResearchWatch[];
};

export type WorkerConfig = {
  Endpoint: string;
  ApiKey: string;
  ConnectedAt?: string;
};

export type AdminSettings = {
  DriveRootName: string;
  ArchiveEnabled: boolean;
};

export type AssistantInsight = {
  id: string;
  tone: "urgent" | "money" | "plan" | "info";
  eyebrow: string;
  title: string;
  detail: string;
  action?: AppView;
};

export type WorkerTaskType = "general" | "meal-plan" | "research" | "financial-review" | "admin-classify";

export type WorkerTask = {
  id: string;
  type: WorkerTaskType;
  status: "queued" | "running" | "complete" | "failed";
  prompt: string;
  result?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
};
