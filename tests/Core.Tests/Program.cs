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
