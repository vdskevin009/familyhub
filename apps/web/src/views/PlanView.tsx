import { FormEvent, useMemo, useState } from "react";
import {
  CalendarDays, Check, ChefHat, CirclePlus, Clock3, ShoppingBasket, Sparkles, Trash2
} from "lucide-react";
import { buildAssistantContext, buildGroceryList, dateLabel, generateWeek, nextOccurrence } from "../domain";
import type { HubState } from "../state";
import { EntryKind, Repeat } from "../types";
import { uid } from "../storage";
import { runWorkerTask } from "../worker";

type Props = { hub: HubState };
type Tab = "week" | "groceries" | "plans" | "recipes";

export default function PlanView({ hub }: Props) {
  const [tab, setTab] = useState<Tab>("week");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDate, setTaskDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [groceryName, setGroceryName] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [recipeIngredients, setRecipeIngredients] = useState("");
  const [message, setMessage] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const recipeMap = useMemo(() => new Map(hub.planner.Recipes.map(recipe => [recipe.Id, recipe])), [hub.planner.Recipes]);
  const meals = useMemo(() => [...hub.planner.Meals].sort((a, b) => a.Date.localeCompare(b.Date)), [hub.planner.Meals]);
  const openPlans = useMemo(() => hub.family.Entries.filter(item => !item.Done).sort((a, b) => +new Date(a.Due) - +new Date(b.Due)), [hub.family.Entries]);

  function generateMeals() {
    const next = generateWeek(hub.planner);
    if (!next.length) { setMessage("Add at least one recipe first."); return; }
    hub.setPlanner(previous => ({ ...previous, Meals: next }));
    setMessage("Built a seven-day plan from your saved recipes.");
  }

  function rebuildGroceries() {
    hub.setPlanner(previous => ({ ...previous, GroceryItems: buildGroceryList(previous) }));
    setMessage("Grocery list rebuilt from this week's meals. Manual items were kept.");
  }

  function setMeal(date: string, recipeId: string) {
    hub.setPlanner(previous => ({
      ...previous,
      Meals: previous.Meals.map(meal => meal.Date === date ? { ...meal, RecipeId: recipeId || null } : meal)
    }));
  }

  function toggleGrocery(id: string) {
    hub.setPlanner(previous => ({
      ...previous,
      GroceryItems: previous.GroceryItems.map(item => item.Id === id ? { ...item, Checked: !item.Checked } : item)
    }));
  }

  function addGrocery(event: FormEvent) {
    event.preventDefault();
    if (!groceryName.trim()) return;
    hub.setPlanner(previous => ({
      ...previous,
      GroceryItems: [...previous.GroceryItems, { Id: uid(), Name: groceryName.trim(), Quantity: "", Checked: false, Source: "manual" }]
    }));
    setGroceryName("");
  }

  function addPlan(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    const due = new Date(`${taskDate}T18:00:00`);
    hub.setFamily(previous => ({
      ...previous,
      Entries: [...previous.Entries, {
        Id: uid(), Title: taskTitle.trim(), Owner: "Everyone", Kind: EntryKind.Task,
        Due: due.toISOString(), Repeat: Repeat.Never, Done: false, Notes: ""
      }]
    }));
    setTaskTitle("");
  }

  function completePlan(id: string) {
    hub.setFamily(previous => ({
      ...previous,
      Entries: previous.Entries.map(item => {
        if (item.Id !== id) return item;
        if (item.Repeat === Repeat.Never) return { ...item, Done: !item.Done };
        return { ...item, Due: nextOccurrence(item.Due, item.Repeat), Done: false };
      })
    }));
  }

  function addRecipe(event: FormEvent) {
    event.preventDefault();
    if (!recipeName.trim()) return;
    const ingredients = recipeIngredients.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
      const [name, ...quantity] = line.split("|");
      return { Name: name.trim(), Quantity: quantity.join("|").trim() };
    });
    hub.setPlanner(previous => ({
      ...previous,
      Recipes: [...previous.Recipes, {
        Id: uid(), Name: recipeName.trim(), PrepMinutes: 30, Tags: [], Ingredients: ingredients, Favourite: false
      }]
    }));
    setRecipeName("");
    setRecipeIngredients("");
  }

  async function askWorkerForWeek() {
    if (!hub.worker.Endpoint || !hub.worker.ApiKey) {
      setMessage("Connect the local AI worker in More first.");
      return;
    }
    setAiBusy(true);
    setMessage("");
    try {
      const context = buildAssistantContext(hub.family, hub.reimbursements, hub.savings, hub.planner, hub.spending);
      const task = await runWorkerTask(hub.worker, "meal-plan",
        `Suggest a practical seven-day dinner plan and concise grocery strategy. Prefer existing recipes where possible, reduce waste by reusing ingredients, and keep weekdays simple. Do not claim to place grocery orders. Household summary:\n${context}\nAvailable recipes:\n${JSON.stringify(hub.planner.Recipes)}`
      );
      setMessage(task.result || "Meal-planning request completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Meal-planning request failed.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="view-stack">
      <section className="view-hero compact">
        <div>
          <span className="eyebrow">Plan once, reuse the work</span>
          <h1>Meals, groceries and the week.</h1>
          <p>Build dinner plans from recipes, convert ingredients into one list, and keep everyday tasks beside them.</p>
        </div>
        <span className="hero-icon"><CalendarDays size={26} /></span>
      </section>

      {message && <div className="banner info"><Check size={17} />{message}</div>}

      <div className="segment-tabs">
        {([["week", "Week"], ["groceries", "Groceries"], ["plans", "Plans"], ["recipes", "Recipes"]] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "week" && (
        <>
          <section className="section-heading inline">
            <div><span className="eyebrow">Dinner plan</span><h2>Your next seven days</h2></div>
            <div className="row-actions">
              <button className="mini-button" onClick={generateMeals}><Sparkles size={15} /> Build week</button>
              <button className="mini-button primary" disabled={aiBusy} onClick={askWorkerForWeek}><Sparkles size={15} /> {aiBusy ? "Thinking…" : "Ask worker"}</button>
            </div>
          </section>
          <div className="meal-grid">
            {meals.length === 0 && <div className="empty-state wide"><ChefHat size={30} /><strong>No meals planned</strong><span>Use “Build week” to rotate through your saved recipes.</span></div>}
            {meals.map(meal => {
              const recipe = meal.RecipeId ? recipeMap.get(meal.RecipeId) : undefined;
              return (
                <article className="meal-card" key={meal.Date}>
                  <small>{new Date(meal.Date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })}</small>
                  <strong>{recipe?.Name || "Choose dinner"}</strong>
                  <span>{recipe ? `${recipe.PrepMinutes} min · ${recipe.Tags.join(" · ") || "saved recipe"}` : "Nothing selected"}</span>
                  <select value={meal.RecipeId || ""} onChange={event => setMeal(meal.Date, event.target.value)}>
                    <option value="">No meal</option>
                    {hub.planner.Recipes.map(item => <option key={item.Id} value={item.Id}>{item.Name}</option>)}
                  </select>
                </article>
              );
            })}
          </div>
          <section className="surface callout-surface">
            <div><ShoppingBasket size={22} /><div><strong>Turn meals into the shopping list</strong><p>Ingredients from selected recipes are grouped automatically; manual grocery items stay untouched.</p></div></div>
            <button className="button" onClick={rebuildGroceries}>Build grocery list</button>
          </section>
        </>
      )}

      {tab === "groceries" && (
        <section className="surface">
          <div className="section-heading inline">
            <div><span className="eyebrow">Shopping</span><h2>{hub.planner.GroceryItems.filter(item => !item.Checked).length} items left</h2></div>
            <button className="mini-button" onClick={rebuildGroceries}>Rebuild from meals</button>
          </div>
          <form className="inline-form" onSubmit={addGrocery}>
            <input value={groceryName} onChange={event => setGroceryName(event.target.value)} placeholder="Add an item" />
            <button className="button" aria-label="Add grocery"><CirclePlus size={18} /></button>
          </form>
          <div className="check-list">
            {hub.planner.GroceryItems.map(item => (
              <label className={item.Checked ? "check-row checked" : "check-row"} key={item.Id}>
                <input type="checkbox" checked={item.Checked} onChange={() => toggleGrocery(item.Id)} />
                <span className="grow"><strong>{item.Name}</strong><small>{item.Quantity || (item.Source === "meal" ? "From meal plan" : "Manual")}</small></span>
                <button type="button" className="icon-button subtle" onClick={() => hub.setPlanner(previous => ({ ...previous, GroceryItems: previous.GroceryItems.filter(x => x.Id !== item.Id) }))}><Trash2 size={16} /></button>
              </label>
            ))}
            {!hub.planner.GroceryItems.length && <div className="empty-state"><ShoppingBasket size={28} /><strong>Your list is empty</strong><span>Build it from meals or add items manually.</span></div>}
          </div>
        </section>
      )}

      {tab === "plans" && (
        <section className="two-column">
          <div className="surface">
            <div className="section-heading"><span className="eyebrow">Everyday</span><h2>Open plans</h2></div>
            <div className="check-list">
              {openPlans.map(item => (
                <label className="check-row" key={item.Id}>
                  <input type="checkbox" checked={item.Done} onChange={() => completePlan(item.Id)} />
                  <span className="grow"><strong>{item.Title}</strong><small><Clock3 size={12} /> {dateLabel(item.Due)} · {item.Owner}</small></span>
                </label>
              ))}
              {!openPlans.length && <div className="empty-state"><Check size={28} /><strong>No open plans</strong><span>Nice. Add the next thing when you need it.</span></div>}
            </div>
          </div>
          <form className="surface form-surface" onSubmit={addPlan}>
            <span className="eyebrow">Quick add</span><h2>Add a plan</h2>
            <label>What needs doing?<input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="e.g. Return package" /></label>
            <label>When?<input type="date" value={taskDate} onChange={event => setTaskDate(event.target.value)} /></label>
            <button className="button">Add to FamilyHub</button>
          </form>
        </section>
      )}

      {tab === "recipes" && (
        <section className="two-column">
          <div className="surface">
            <div className="section-heading"><span className="eyebrow">Recipe library</span><h2>{hub.planner.Recipes.length} saved dinners</h2></div>
            <div className="recipe-list">
              {hub.planner.Recipes.map(recipe => (
                <article key={recipe.Id}>
                  <span className="recipe-icon"><ChefHat size={17} /></span>
                  <div className="grow"><strong>{recipe.Name}</strong><small>{recipe.PrepMinutes} min · {recipe.Ingredients.length} ingredients</small></div>
                  <button className="icon-button subtle" onClick={() => hub.setPlanner(previous => ({ ...previous, Recipes: previous.Recipes.filter(item => item.Id !== recipe.Id) }))}><Trash2 size={16} /></button>
                </article>
              ))}
            </div>
          </div>
          <form className="surface form-surface" onSubmit={addRecipe}>
            <span className="eyebrow">Add your own</span><h2>New recipe</h2>
            <label>Name<input value={recipeName} onChange={event => setRecipeName(event.target.value)} placeholder="e.g. Lemon orzo" /></label>
            <label>Ingredients <small>One per line. Use “name | quantity”.</small>
              <textarea value={recipeIngredients} onChange={event => setRecipeIngredients(event.target.value)} placeholder={"Orzo | 1 pack\nLemon | 2\nSpinach | 1 bag"} rows={7} />
            </label>
            <button className="button">Save recipe</button>
          </form>
        </section>
      )}
    </div>
  );
}
