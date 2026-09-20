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
    public async Task<GmailAccount> Connect(string clientId, string slot)
    {
        try { return await js.InvokeAsync<GmailAccount>("familyhubGmail.connect", clientId, slot); }
        catch (JSException) { throw; }
    }

    public async Task<GmailScanResponse> Scan(string slot, int months)
    {
        try { return await js.InvokeAsync<GmailScanResponse>("familyhubGmail.scan", slot, months); }
        catch (JSException) { throw; }
    }

    public async Task Disconnect(string slot)
    {
        try { await js.InvokeVoidAsync("familyhubGmail.disconnect", slot); }
        catch (JSException) { throw; }
    }

    public async Task DownloadAttachment(string slot, string messageId, ReimbursementAttachment attachment)
    {
        try
        {
            await js.InvokeVoidAsync(
                "familyhubGmail.downloadAttachment",
                slot,
                messageId,
                attachment.Id,
                attachment.FileName,
                attachment.MimeType);
        }
        catch (JSException) { throw; }
    }

    public async Task OpenMessage(string accountEmail, string internetMessageId, string gmailMessageId)
    {
        try { await js.InvokeVoidAsync("familyhubGmail.openMessage", accountEmail, internetMessageId, gmailMessageId); }
        catch (JSException) { throw; }
    }
}
