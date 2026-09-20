import { useStoredState } from "./storage";
import { defaultAdmin, defaultFamily, defaultPlanner, defaultReimbursements, defaultResearch, defaultSavings, defaultSpending, defaultWorker } from "./defaults";
import type { AdminSettings, FamilyState, PlannerState, ResearchState, ReimbursementState, SavingsState, SpendingState, WorkerConfig } from "./types";

export type StoreSetter<T> = (value: T | ((previous: T) => T)) => void;

export type HubState = {
  family: FamilyState; setFamily: StoreSetter<FamilyState>;
  savings: SavingsState; setSavings: StoreSetter<SavingsState>;
  reimbursements: ReimbursementState; setReimbursements: StoreSetter<ReimbursementState>;
  planner: PlannerState; setPlanner: StoreSetter<PlannerState>;
  spending: SpendingState; setSpending: StoreSetter<SpendingState>;
  research: ResearchState; setResearch: StoreSetter<ResearchState>;
  worker: WorkerConfig; setWorker: StoreSetter<WorkerConfig>;
  admin: AdminSettings; setAdmin: StoreSetter<AdminSettings>;
};

export function useFamilyHubState(): HubState {
  const [family, setFamily] = useStoredState<FamilyState>("familyhub.v1", defaultFamily);
  const [savings, setSavings] = useStoredState<SavingsState>("familyhub.savings.v1", defaultSavings);
  const [reimbursements, setReimbursements] = useStoredState<ReimbursementState>("familyhub.reimbursements.v1", defaultReimbursements);
  const [planner, setPlanner] = useStoredState<PlannerState>("familyhub.planner.v1", defaultPlanner);
  const [spending, setSpending] = useStoredState<SpendingState>("familyhub.spending.v1", defaultSpending);
  const [research, setResearch] = useStoredState<ResearchState>("familyhub.research.v1", defaultResearch);
  const [worker, setWorker] = useStoredState<WorkerConfig>("familyhub.worker.v1", defaultWorker);
  const [admin, setAdmin] = useStoredState<AdminSettings>("familyhub.admin.v1", defaultAdmin);
  return {
    family, setFamily, savings, setSavings, reimbursements, setReimbursements,
    planner, setPlanner, spending, setSpending, research, setResearch,
    worker, setWorker, admin, setAdmin
  };
}
