namespace Core;

public enum EntryKind { Task, Grocery, Meal, Appointment, Reminder }
public enum Repeat { Never, Daily, Weekly, Monthly }
public sealed class FamilyEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public string Owner { get; set; } = "Everyone";
    public EntryKind Kind { get; set; }
    public DateTime Due { get; set; } = DateTime.Today;
    public Repeat Repeat { get; set; }
    public bool Done { get; set; }
    public string Notes { get; set; } = "";
}
public sealed class FamilyState
{
    public int SchemaVersion { get; set; } = 1;
    public List<FamilyEntry> Entries { get; set; } = [];
    public void Validate()
    {
        if (SchemaVersion != 1 || Entries is null || Entries.Count > 2000) throw new ArgumentException("Unsupported or oversized family backup.");
        if (Entries.Select(x => x.Id).Distinct().Count() != Entries.Count) throw new ArgumentException("Backup contains duplicate entries.");
        foreach (var e in Entries)
            if (e is null || string.IsNullOrWhiteSpace(e.Title) || e.Title.Length > 150 || e.Owner is null || e.Owner.Length > 60 || e.Notes is null || e.Notes.Length > 1000 || !Enum.IsDefined(e.Kind) || !Enum.IsDefined(e.Repeat) || e.Due.Year < 2000 || e.Due.Year > 2100)
                throw new ArgumentException("An entry is invalid. Use titles up to 150 characters and dates between 2000 and 2100.");
    }
    public void Complete(FamilyEntry entry, DateTime today)
    {
        if (entry.Repeat == Repeat.Never) { entry.Done = !entry.Done; return; }
        // Skip missed occurrences, preserving the schedule's time of day.
        var due = entry.Due;
        do { due = Next(due, entry.Repeat); } while (due.Date <= today.Date);
        if (due.Year > 2100) throw new ArgumentException("The next occurrence exceeds the supported date range.");
        entry.Due = due;
        entry.Done = false;
    }
    public static DateTime Next(DateTime date, Repeat repeat) => repeat switch
    {
        Repeat.Daily => date.AddDays(1), Repeat.Weekly => date.AddDays(7), Repeat.Monthly => date.AddMonths(1), _ => date
    };
}
