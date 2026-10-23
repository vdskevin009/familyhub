import { useState } from "react";
import type { WorkerConfig, GroceryItem } from "../types";
import { PageHeader } from "../ui/primitives";
import GroceriesView from "./GroceriesView";
import GroceryPlanningView from "./GroceryPlanningView";
import GroceryCatalogueView from "./GroceryCatalogueView";
import "../grocery.css";

type CourseTab = "catalogue" | "target" | "needs" | "compare" | "tickets";
const courseTabs: CourseTab[] = ["catalogue", "target", "needs", "compare", "tickets"];
function initialTab(): CourseTab {
  const value = new URLSearchParams(location.search).get("tab");
  return courseTabs.includes(value as CourseTab) ? value as CourseTab : "catalogue";
}
export default function CoursesView({ config, plannerItems }: { config: WorkerConfig; plannerItems: GroceryItem[] }) {
  const [tab, setTab] = useState<CourseTab>(initialTab);
  const [navigation, setNavigation] = useState(0);
  const [initialRecord] = useState(() => new URLSearchParams(location.search).get("record") || undefined);
  function selectTab(next: CourseTab) {
    setTab(next); setNavigation(n => n + 1);
    const url = new URL(location.href);
    url.searchParams.set("tab", next);
    if (next !== "tickets") url.searchParams.delete("record");
    history.replaceState(history.state, "", url);
  }
  return <section className={`view-stack grocery-view${tab === "catalogue" || tab === "target" ? " grocery-card-workspace" : ""}`}><PageHeader title="Courses" />
    <nav className="segment-tabs grocery-workflow" aria-label="Outils Courses">{([["catalogue", "Catalogue"], ["target", "Moins cher"], ["tickets", "Achats"]] as const).map(([id, label]) => <button type="button" key={id} className={tab === id ? "active" : ""} aria-label={id === "target" ? "Moins cher ailleurs" : undefined} aria-current={tab === id ? "page" : undefined} onClick={() => selectTab(id)}>{label}</button>)}</nav>
    {(tab === "needs" || tab === "compare") && <nav className="segment-tabs" aria-label="Gestion Courses"><button type="button" className={tab === "needs" ? "active" : ""} onClick={() => selectTab("needs")}>Besoins</button><button type="button" className={tab === "compare" ? "active" : ""} onClick={() => selectTab("compare")}>Comparer</button></nav>}
    {tab === "tickets" ? <GroceriesView config={config} initialRecordId={initialRecord} /> : tab === "catalogue" || tab === "target" ? <GroceryCatalogueView config={config} view={tab} onManage={() => selectTab("needs")} /> : <GroceryPlanningView config={config} plannerItems={plannerItems} initialTab={tab === "compare" ? "compare" : "list"} navigation={navigation} />}
  </section>;
}
