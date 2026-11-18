import type { AppView } from "./types";

/** Every route belongs to exactly one primary destination, including deep links. */
export function primaryDestination(view: AppView): AppView {
  if (["projects", "property", "vehicle", "groceries", "mortgage"].includes(view)) return "projects";
  if (view === "finances" || view === "contributions") return "finances";
  if (view === "today" || view === "reimbursements") return view;
  return "other";
}
