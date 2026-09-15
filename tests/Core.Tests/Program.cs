using Core;
static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
var state = new FamilyState();
var recurring = new FamilyEntry { Title="Weekly shop", Due=new(2026,9,1,18,30,0), Repeat=Repeat.Weekly };
state.Complete(recurring,new(2026,9,12));
Check(recurring.Due == new DateTime(2026,9,15,18,30,0), "Weekly completion skips overdue occurrences and preserves time");
Check(!recurring.Done, "Recurring task remains active");
Check(FamilyState.Next(new(2028,1,31),Repeat.Monthly)==new DateTime(2028,2,29),"Month-end leap year");
var task = new FamilyEntry { Title="Dinner" }; state.Complete(task,DateTime.Today); Check(task.Done,"One-off completion"); state.Complete(task,DateTime.Today); Check(!task.Done,"Undo completion");
try { new FamilyState { SchemaVersion=2 }.Validate(); throw new Exception("Accepted invalid schema"); } catch(ArgumentException) { }
try { new FamilyState { Entries=[task,task] }.Validate(); throw new Exception("Accepted duplicate IDs"); } catch(ArgumentException) { }
Console.WriteLine("PASS: recurrence, leap year, completion, schema and duplicate validation (6 checks)");
var monthly = new Subscription { Name = "Example", Price = 10, Cycle = BillingCycle.Monthly };
Check(monthly.AnnualCost == 120, "Monthly annualization");
Check(new Subscription { Price = 10, Cycle = BillingCycle.Weekly }.AnnualCost == 520, "Weekly annualization");
Check(new Subscription { Price = 99, Cycle = BillingCycle.Annual }.AnnualCost == 99, "Annual billing is not multiplied");
var zero = SavingsMath.Mortgage(120000, 0, 10, 12);
Check(zero.Payment == 1000 && zero.Interest == 0 && zero.Remaining == 108000, "Zero rate amortization");
var loan = SavingsMath.Mortgage(100000, 5, 25, 60);
Check(Math.Abs(loan.Payment - 581.60m) < .01m, "Canadian semi-annual compounding benchmark");
Check(Math.Abs(loan.Payment * 60 - loan.Interest - (100000 - loan.Remaining)) < .001m, "Payment accounting identity");
Check(SavingsMath.Mortgage(100000, 5, 25, 300).Remaining < .01m, "Loan amortizes fully");
try { SavingsMath.Mortgage(100000, -1, 25, 60); throw new Exception("Accepted negative rate"); } catch (ArgumentException) { }
try { SavingsMath.Mortgage(100000, 5, 1, 60); throw new Exception("Accepted term beyond amortization"); } catch (ArgumentException) { }
var today = new DateTime(2026, 9, 15);
var offers = new[] {
 new GroceryOffer { Product = "Apples", Store = "A", Price = 6, Size = 2, Unit = GroceryUnit.Kg, ValidUntil = today },
 new GroceryOffer { Product = "apples", Store = "B", Price = 4, Size = 1, Unit = GroceryUnit.Kg, ValidUntil = today.AddDays(1) },
 new GroceryOffer { Product = "Apples", Store = "Expired", Price = 1, Size = 2, Unit = GroceryUnit.Kg, ValidUntil = today.AddDays(-1) },
 new GroceryOffer { Product = "Apples", Store = "Each", Price = 1, Size = 1, Unit = GroceryUnit.Each, ValidUntil = today }
};
var comparison = SavingsMath.Compare(offers, " APPLES ", GroceryUnit.Kg, today).ToList();
Check(comparison.Count == 2 && comparison[0].Store == "A", "Normalize names; exclude expired and incompatible units");
Check(comparison.OrderBy(o => Math.Ceiling(1m / o.Size) * o.Price).First().Store == "B", "Whole-pack cost can reverse unit-price ranking");
try { new SavingsState { Offers = [new() { Product="Rice", Store="A", Size=0 }] }.Validate(); throw new Exception("Accepted zero pack size"); } catch (ArgumentException) { }
try { new SavingsState { Subscriptions = [monthly,monthly] }.Validate(); throw new Exception("Accepted duplicate subscriptions"); } catch (ArgumentException) { }
var saved = new SavingsState { Subscriptions=[monthly], Offers=offers.ToList() };
var restored = System.Text.Json.JsonSerializer.Deserialize<SavingsState>(System.Text.Json.JsonSerializer.Serialize(saved))!;
restored.Validate(); Check(restored.Subscriptions[0].AnnualCost == 120 && restored.Offers.Count == 4, "Savings backup roundtrip");
Check(System.Text.Json.JsonSerializer.Deserialize<FamilyState>("{\"SchemaVersion\":1,\"Entries\":[]}")!.Entries.Count == 0, "Existing family data schema unchanged");
Console.WriteLine("PASS: savings, offer expiry/units/pack costs, mortgage math and backup compatibility");
