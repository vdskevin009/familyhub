using Microsoft.JSInterop;
using Core;

namespace Web;

public sealed class GmailAccount
{
    public string Slot { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class GmailScanResponse
{
    public string Email { get; set; } = "";
    public List<EmailCandidate> Messages { get; set; } = [];
}

public sealed class GmailBridge(IJSRuntime js)
{
    public Task<GmailAccount> Connect(string clientId, string slot) =>
        js.InvokeAsync<GmailAccount>("familyhubGmail.connect", clientId, slot).AsTask();

    public Task<GmailScanResponse> Scan(string slot, int months) =>
        js.InvokeAsync<GmailScanResponse>("familyhubGmail.scan", slot, months).AsTask();

    public Task Disconnect(string slot) =>
        js.InvokeVoidAsync("familyhubGmail.disconnect", slot).AsTask();

    public Task DownloadAttachment(string slot, string messageId, ReimbursementAttachment attachment) =>
        js.InvokeVoidAsync(
            "familyhubGmail.downloadAttachment",
            slot,
            messageId,
            attachment.Id,
            attachment.FileName,
            attachment.MimeType).AsTask();

    public Task OpenMessage(string accountEmail, string internetMessageId, string gmailMessageId) =>
        js.InvokeVoidAsync("familyhubGmail.openMessage", accountEmail, internetMessageId, gmailMessageId).AsTask();
}
