import { useState } from "react";
import type { WorkerConfig, GroceryItem } from "../types";
import { PageHeader } from "../ui/primitives";
import GroceriesView from "./GroceriesView";
import GroceryPlanningView from "./GroceryPlanningView";
import "../grocery.css";
export default function CoursesView({ config, plannerItems }: { config: WorkerConfig; plannerItems: GroceryItem[] }) {
  const [tab, setTab] = useState<"needs" | "compare" | "tickets">("needs");
  return <section className="view-stack grocery-view"><PageHeader title="Courses" subtitle="Préparer les besoins, comparer, puis vérifier les achats." />
    <nav className="segment-tabs grocery-workflow" aria-label="Outils Courses">{([["needs", "Besoins"], ["compare", "Comparer"], ["tickets", "Après achats"]] as const).map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === "tickets" ? <GroceriesView config={config} /> : <GroceryPlanningView config={config} plannerItems={plannerItems} initialTab={tab === "compare" ? "compare" : "list"} />}
  </section>;
}
