import { useEffect, useState } from "react";
import type { WorkerConfig, GroceryItem } from "../types";
import { PageHeader } from "../ui/primitives";
import GroceriesView from "./GroceriesView";
import "../grocery.css";

export default function CoursesView({ config }: { config: WorkerConfig; plannerItems: GroceryItem[] }) {
  const [initialRecord] = useState(() => new URLSearchParams(location.search).get("record") || undefined);
  useEffect(() => {
    // Old bookmarks converge on Achats without deleting shared planning/catalogue data.
    const url = new URL(location.href);
    if (url.searchParams.get("tab") !== "tickets") { url.searchParams.set("tab", "tickets"); history.replaceState(history.state, "", url); }
  }, []);
  return <section className="view-stack grocery-view"><PageHeader title="Groceries" />
    <nav className="segment-tabs grocery-workflow" aria-label="Grocery tools"><button type="button" className="active" aria-current="page">Purchases</button></nav>
    <GroceriesView config={config} initialRecordId={initialRecord} />
  </section>;
}
