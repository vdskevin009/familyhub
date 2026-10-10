import { useState } from "react";
import type { WorkerConfig, GroceryItem } from "../types";
import { PageHeader } from "../ui/primitives";
import GroceriesView from "./GroceriesView";
import GroceryPlanningView from "./GroceryPlanningView";
import "../grocery.css";
export default function CoursesView({ config, plannerItems }: { config: WorkerConfig; plannerItems: GroceryItem[] }) {
  const [tab, setTab] = useState<"tickets" | "planning">("tickets");
  return <section className="view-stack grocery-view"><PageHeader title="Courses" subtitle="Vos tickets, votre liste habituelle et des paniers comparés avec leurs sources." />
    <nav className="segment-tabs" aria-label="Outils Courses"><button className={tab === "tickets" ? "active" : ""} aria-current={tab === "tickets" ? "page" : undefined} onClick={() => setTab("tickets")}>Tickets et dépenses</button><button className={tab === "planning" ? "active" : ""} aria-current={tab === "planning" ? "page" : undefined} onClick={() => setTab("planning")}>Liste et paniers</button></nav>
    {tab === "tickets" ? <GroceriesView config={config} /> : <GroceryPlanningView config={config} plannerItems={plannerItems} />}
  </section>;
}
