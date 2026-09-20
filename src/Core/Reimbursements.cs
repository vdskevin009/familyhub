using System.Globalization;
using System.Text.RegularExpressions;

namespace Core;

public enum ReimbursementCategory { HealthBenefit, Travel, Other }
public enum ReimbursementStatus { ToReview, ReadyToClaim, Claimed, Reimbursed, Ignored }

public sealed class ReimbursementAttachment
{
    public string Id { get; set; } = "";
    public string FileName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public long Size { get; set; }
}

public sealed class EmailCandidate
{
    public string MessageId { get; set; } = "";
    public string ThreadId { get; set; } = "";
    public string InternetMessageId { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Sender { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
    public string BodyText { get; set; } = "";
    public List<ReimbursementAttachment> Attachments { get; set; } = [];
}

public sealed class ReimbursementItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string AccountLabel { get; set; } = "";
    public string AccountEmail { get; set; } = "";
    public string SourceMessageId { get; set; } = "";
    public string ThreadId { get; set; } = "";
    public string InternetMessageId { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Sender { get; set; } = "";
    public string Provider { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
    public ReimbursementCategory Category { get; set; }
    public ReimbursementStatus Status { get; set; } = ReimbursementStatus.ToReview;
    public decimal? DetectedAmount { get; set; }
    public string Currency { get; set; } = "";
    public int Confidence { get; set; }
    public string Notes { get; set; } = "";
    public List<ReimbursementAttachment> Attachments { get; set; } = [];
}

public sealed record ReimbursementMergeResult(int Added, int Updated);

public sealed class ReimbursementState
{
    public int SchemaVersion { get; set; } = 1;
    public List<ReimbursementItem> Items { get; set; } = [];

    public ReimbursementMergeResult MergeScan(IEnumerable<ReimbursementItem> scanned)
    {
        var added = 0;
        var updated = 0;
        foreach (var incoming in scanned.GroupBy(Key, StringComparer.OrdinalIgnoreCase).Select(g => g.First()))
        {
            var existing = Items.FirstOrDefault(x => Key(x).Equals(Key(incoming), StringComparison.OrdinalIgnoreCase));
            if (existing is null)
            {
                Items.Add(incoming);
                added++;
                continue;
            }

            existing.AccountLabel = incoming.AccountLabel;
            existing.Subject = incoming.Subject;
            existing.Sender = incoming.Sender;
            existing.Provider = incoming.Provider;
            existing.ThreadId = incoming.ThreadId;
            existing.InternetMessageId = incoming.InternetMessageId;
            existing.ReceivedAt = incoming.ReceivedAt;
            existing.Category = incoming.Category;
            existing.DetectedAmount = incoming.DetectedAmount;
            existing.Currency = incoming.Currency;
            existing.Confidence = incoming.Confidence;
            existing.Attachments = incoming.Attachments;
            updated++;
        }

        Validate();
        return new(added, updated);
    }

    public void Validate()
    {
        if (SchemaVersion != 1 || Items is null || Items.Count > 2000)
            throw new ArgumentException("Unsupported or oversized reimbursement data.");
        if (Items.Select(x => x.Id).Distinct().Count() != Items.Count)
            throw new ArgumentException("Reimbursement data contains duplicate IDs.");
        if (Items.Select(Key).Distinct(StringComparer.OrdinalIgnoreCase).Count() != Items.Count)
            throw new ArgumentException("Reimbursement data contains duplicate email sources.");

        foreach (var item in Items)
        {
            if (item is null
                || item.AccountLabel is null || item.AccountLabel.Length > 40
                || string.IsNullOrWhiteSpace(item.AccountEmail) || item.AccountEmail.Length > 254
                || string.IsNullOrWhiteSpace(item.SourceMessageId) || item.SourceMessageId.Length > 500
                || item.ThreadId is null || item.ThreadId.Length > 500
                || item.InternetMessageId is null || item.InternetMessageId.Length > 500
                || item.Subject is null || item.Subject.Length > 500
                || item.Sender is null || item.Sender.Length > 500
                || item.Provider is null || item.Provider.Length > 160
                || item.Notes is null || item.Notes.Length > 1000
                || item.Currency is null || item.Currency.Length > 8
                || item.Confidence is < 0 or > 100
                || item.DetectedAmount is < 0 or > 1_000_000
                || item.ReceivedAt.Year is < 2000 or > 2100
                || !Enum.IsDefined(item.Category)
                || !Enum.IsDefined(item.Status)
                || item.Attachments is null
                || item.Attachments.Count > 30)
                throw new ArgumentException("A reimbursement item is invalid.");

            foreach (var attachment in item.Attachments)
                if (attachment is null
                    || string.IsNullOrWhiteSpace(attachment.Id) || attachment.Id.Length > 500
                    || attachment.FileName is null || attachment.FileName.Length > 255
                    || attachment.MimeType is null || attachment.MimeType.Length > 120
                    || attachment.Size < 0 || attachment.Size > 50_000_000)
                    throw new ArgumentException("A reimbursement attachment is invalid.");
        }
    }

    static string Key(ReimbursementItem item) =>
        $"{item.AccountEmail.Trim().ToLowerInvariant()}:{item.SourceMessageId.Trim()}";
}

public static class ReimbursementDetector
{
    static readonly string[] HealthKeywords =
    [
        "physio", "physiotherapy", "physical therapy", "massage therapy", " rmt ", "chiro",
        "chiropractor", "chiropractic", "osteo", "osteopath", "dental", "dentist",
        "orthodont", "pharmacy", "prescription", "optomet", "vision", "eyeglass", "clinic",
        "medical", "therapy"
    ];

    static readonly string[] TravelKeywords =
    [
        "flight", "airline", "air canada", "westjet", "hotel", "airbnb", "booking.com",
        "expedia", "travel", "train", "rail", "car rental", "rental car"
    ];

    static readonly string[] DocumentKeywords =
    [
        "receipt", "invoice", "facture", "reçu", "recu", "statement", "paid", "payment",
        "payment confirmation", "proof of payment"
    ];

    static readonly string[] ClaimKeywords =
    [
        "reimbursement", "remboursement", "claim", "benefit", "benefits", "insurance",
        "assurance", "eligible expense", "health spending"
    ];

    static readonly Regex LabelledMoney = new(
        @"(?:total(?:\s+paid)?|amount(?:\s+(?:paid|due))?|paid|montant(?:\s+pay[ée])?|total\s+pay[ée])\s*[:\-]?\s*(?<currency>CAD|C\$|\$|EUR|€)?\s*(?<amount>\d{1,6}(?:[\.,]\d{2})?)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    static readonly Regex CurrencyMoney = new(
        @"(?<currency>CAD|C\$|\$|EUR|€)\s*(?<amount>\d{1,6}(?:[\.,]\d{2})?)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static ReimbursementItem? Analyze(EmailCandidate message, string accountLabel, string accountEmail)
    {
        var attachmentText = string.Join(' ', message.Attachments.Select(x => x.FileName));
        var text = $" {message.Subject} {message.Sender} {message.BodyText} {attachmentText} ".ToLowerInvariant();

        var healthHits = Hits(text, HealthKeywords);
        var travelHits = Hits(text, TravelKeywords);
        var documentHits = Hits(text, DocumentKeywords);
        var claimHits = Hits(text, ClaimKeywords);
        var invoiceAttachment = message.Attachments.Any(a =>
            ContainsAny(a.FileName.ToLowerInvariant(), ["receipt", "invoice", "facture", "recu", "reçu", "statement"]));

        var themed = healthHits > 0 || travelHits > 0;
        var documentary = documentHits > 0 || invoiceAttachment;
        var claimContext = claimHits > 0;
        if (!documentary && !claimContext) return null;

        var score = Math.Min(12,
            Math.Min(2, healthHits) * 2
            + Math.Min(2, travelHits) * 2
            + Math.Min(2, documentHits)
            + Math.Min(2, claimHits) * 2
            + (message.Attachments.Count > 0 ? 1 : 0)
            + (invoiceAttachment ? 2 : 0));

        if (!themed && !claimContext && score < 5) return null;

        var category = healthHits > 0 && healthHits >= travelHits
            ? ReimbursementCategory.HealthBenefit
            : travelHits > 0
                ? ReimbursementCategory.Travel
                : ReimbursementCategory.Other;

        var (amount, currency) = DetectAmount($"{message.Subject}\n{message.BodyText}");
        return new ReimbursementItem
        {
            AccountLabel = Limit(accountLabel, 40),
            AccountEmail = Limit(accountEmail, 254),
            SourceMessageId = Limit(message.MessageId, 500),
            ThreadId = Limit(message.ThreadId, 500),
            InternetMessageId = Limit(message.InternetMessageId, 500),
            Subject = Limit(message.Subject, 500),
            Sender = Limit(message.Sender, 500),
            Provider = Limit(Provider(message.Sender), 160),
            ReceivedAt = message.ReceivedAt,
            Category = category,
            DetectedAmount = amount,
            Currency = currency,
            Confidence = Math.Min(95, 35 + score * 5),
            Attachments = message.Attachments.Take(30).Select(a => new ReimbursementAttachment
            {
                Id = Limit(a.Id, 500),
                FileName = Limit(a.FileName, 255),
                MimeType = Limit(a.MimeType, 120),
                Size = Math.Clamp(a.Size, 0, 50_000_000)
            }).ToList()
        };
    }

    static int Hits(string text, IEnumerable<string> keywords) => keywords.Count(text.Contains);

    static bool ContainsAny(string text, IEnumerable<string> terms) => terms.Any(text.Contains);

    static string Provider(string sender)
    {
        if (string.IsNullOrWhiteSpace(sender)) return "Unknown provider";
        var display = sender.Split('<')[0].Trim(' ', '"', '\'');
        if (!string.IsNullOrWhiteSpace(display) && !display.Contains('@')) return display;
        var email = Regex.Match(sender, @"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+", RegexOptions.IgnoreCase).Value;
        if (string.IsNullOrWhiteSpace(email)) return Limit(sender.Trim(), 160);
        var domain = email.Split('@').LastOrDefault() ?? email;
        return domain.Split('.').FirstOrDefault() ?? domain;
    }

    static (decimal? Amount, string Currency) DetectAmount(string text)
    {
        foreach (var regex in new[] { LabelledMoney, CurrencyMoney })
        {
            foreach (Match match in regex.Matches(text))
            {
                if (!TryMoney(match.Groups["amount"].Value, out var amount) || amount <= 0) continue;
                var token = match.Groups["currency"].Value.ToUpperInvariant();
                var currency = token is "EUR" or "€" ? "EUR" : token.Length > 0 ? "CAD" : "";
                return (amount, currency);
            }
        }
        return (null, "");
    }

    static bool TryMoney(string value, out decimal amount)
    {
        var normalized = value.Trim();
        if (normalized.Contains('.') && normalized.Contains(',')) normalized = normalized.Replace(",", "");
        else if (normalized.Contains(',')) normalized = normalized.Replace(',', '.');
        return decimal.TryParse(normalized, NumberStyles.Number, CultureInfo.InvariantCulture, out amount);
    }

    static string Limit(string? value, int max)
    {
        value ??= "";
        return value.Length <= max ? value : value[..max];
    }
}
