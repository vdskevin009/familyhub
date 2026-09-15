namespace Core;

public enum BillingCycle { Monthly, Annual, Weekly }
public sealed class Subscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public BillingCycle Cycle { get; set; }
    public DateTime Renewal { get; set; } = DateTime.Today.AddMonths(1);
    public bool Review { get; set; }
    public bool Cancelled { get; set; }
    public decimal AnnualCost => Price * (Cycle == BillingCycle.Annual ? 1 : Cycle == BillingCycle.Weekly ? 52 : 12);
}
public enum GroceryUnit { Kg, Litre, Each }
public sealed class GroceryOffer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Product { get; set; } = "";
    public string Store { get; set; } = "";
    public decimal Price { get; set; }
    public decimal Size { get; set; } = 1;
    public GroceryUnit Unit { get; set; }
    public DateTime ValidUntil { get; set; } = DateTime.Today.AddDays(7);
    public decimal UnitPrice => Price / Size;
}
public sealed class MortgageScenario
{
    public decimal Balance { get; set; }
    public decimal BaseRate { get; set; }
    public decimal OfferRate { get; set; }
    public int Years { get; set; } = 25;
    public int TermMonths { get; set; } = 60;
    public decimal Fees { get; set; }
    public DateTime Renewal { get; set; } = DateTime.Today.AddYears(1);
    public void Validate()
    {
        if (Balance < 0 || Balance > 100_000_000 || BaseRate < 0 || BaseRate > 30 || OfferRate < 0 || OfferRate > 30 || Years < 1 || Years > 40 || TermMonths < 1 || TermMonths > Years * 12 || Fees < 0 || Fees > 1_000_000 || Renewal.Year < 2000 || Renewal.Year > 2100)
            throw new ArgumentException("Check mortgage inputs: rates 0–30%, amortization 1–40 years, and term no longer than amortization.");
    }
}
public record MortgageResult(decimal Payment, decimal Interest, decimal Remaining);
public static class SavingsMath
{
    // Canadian fixed-rate convention: nominal annual interest compounded semi-annually.
    public static MortgageResult Mortgage(decimal balance, decimal annualRate, int years, int months)
    {
        new MortgageScenario { Balance = balance, BaseRate = annualRate, Years = years, TermMonths = months }.Validate();
        var r = Math.Pow(1 + (double)annualRate / 200, 1d / 6) - 1;
        var payment = r == 0 ? balance / (years * 12) : balance * (decimal)(r / (1 - Math.Pow(1 + r, -years * 12)));
        decimal remaining = balance, interest = 0;
        for (var i = 0; i < months; i++) { var charge = remaining * (decimal)r; interest += charge; remaining = Math.Max(0, remaining + charge - payment); }
        return new(payment, interest, remaining);
    }
    public static IEnumerable<GroceryOffer> Compare(IEnumerable<GroceryOffer> offers, string product, GroceryUnit unit, DateTime today) =>
        offers.Where(x => x.Product.Trim().Equals(product.Trim(), StringComparison.OrdinalIgnoreCase) && x.Unit == unit && x.ValidUntil.Date >= today.Date).OrderBy(x => x.UnitPrice).ThenBy(x => x.Price);
}
public sealed class SavingsState
{
    public int SchemaVersion { get; set; } = 1;
    public List<Subscription> Subscriptions { get; set; } = [];
    public List<GroceryOffer> Offers { get; set; } = [];
    public MortgageScenario Mortgage { get; set; } = new();
    public void Validate()
    {
        if (SchemaVersion != 1 || Subscriptions is null || Offers is null || Mortgage is null || Subscriptions.Count > 1000 || Offers.Count > 2000) throw new ArgumentException("Unsupported savings backup.");
        foreach (var s in Subscriptions)
            if (s is null || string.IsNullOrWhiteSpace(s.Name) || s.Name.Length > 100 || s.Price < 0 || s.Price > 100_000 || !Enum.IsDefined(s.Cycle) || s.Renewal.Year < 2000 || s.Renewal.Year > 2100) throw new ArgumentException("Invalid subscription.");
        foreach (var o in Offers)
            if (o is null || string.IsNullOrWhiteSpace(o.Product) || o.Product.Length > 100 || string.IsNullOrWhiteSpace(o.Store) || o.Store.Length > 100 || o.Price < 0 || o.Price > 100_000 || o.Size <= 0 || o.Size > 100_000 || !Enum.IsDefined(o.Unit) || o.ValidUntil.Year < 2000 || o.ValidUntil.Year > 2100) throw new ArgumentException("Invalid grocery offer.");
        if (Subscriptions.Select(x => x.Id).Distinct().Count() != Subscriptions.Count || Offers.Select(x => x.Id).Distinct().Count() != Offers.Count) throw new ArgumentException("Duplicate savings records.");
        Mortgage.Validate();
    }
}
