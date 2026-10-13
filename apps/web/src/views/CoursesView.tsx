import { useState } from "react";
import type { WorkerConfig, GroceryItem } from "../types";
import { PageHeader } from "../ui/primitives";
import GroceriesView from "./GroceriesView";
import GroceryPlanningView from "./GroceryPlanningView";
import GroceryCatalogueView from "./GroceryCatalogueView";
import "../grocery.css";
export default function CoursesView({ config, plannerItems }: { config: WorkerConfig; plannerItems: GroceryItem[] }) {
  const [tab, setTab] = useState<"catalogue" | "target" | "needs" | "compare" | "tickets">("catalogue");
  const [navigation, setNavigation] = useState(0);
  return <section className="view-stack grocery-view"><PageHeader title="Courses" />
    <nav className="segment-tabs grocery-workflow" aria-label="Outils Courses">{([["catalogue", "Catalogue"], ["target", "Moins cher"], ["tickets", "Après achats"]] as const).map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} aria-label={id === "target" ? "Moins cher ailleurs" : undefined} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setNavigation(n => n + 1); }}>{label}</button>)}</nav>
    {(tab === "needs" || tab === "compare") && <nav className="segment-tabs" aria-label="Gestion Courses"><button className={tab === "needs" ? "active" : ""} onClick={() => { setTab("needs"); setNavigation(n => n + 1); }}>Besoins</button><button className={tab === "compare" ? "active" : ""} onClick={() => { setTab("compare"); setNavigation(n => n + 1); }}>Comparer</button></nav>}
    {tab === "tickets" ? <GroceriesView config={config} /> : tab === "catalogue" || tab === "target" ? <GroceryCatalogueView config={config} view={tab} onManage={() => setTab("needs")} /> : <GroceryPlanningView config={config} plannerItems={plannerItems} initialTab={tab === "compare" ? "compare" : "list"} navigation={navigation} />}
  </section>;
}
