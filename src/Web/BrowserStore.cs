using System.Text.Json;
using Microsoft.JSInterop;

namespace Web;

public sealed class BrowserStore(IJSRuntime js)
{
    public async Task<string?> LoadRaw(string key)
    {
        try { return await js.InvokeAsync<string?>("portfolio.load", key); }
        catch (JSException) { throw; }
    }
    public async Task<T?> Load<T>(string key)
    {
        try
        {
            var raw = await js.InvokeAsync<string?>("portfolio.load", key);
            return raw is null ? default : JsonSerializer.Deserialize<T>(raw);
        }
        catch (JSException)
        {
            // Preserve the failure for the caller's existing recovery UI.
            throw;
        }
    }

    public async Task Save<T>(string key, T value)
    {
        try
        {
            await js.InvokeVoidAsync("portfolio.save", key, JsonSerializer.Serialize(value));
        }
        catch (JSException)
        {
            // Never report a failed storage write as successful.
            throw;
        }
    }

    public async Task Download(string name, string content, string type = "application/json")
    {
        try
        {
            await js.InvokeVoidAsync("portfolio.download", name, content, type);
        }
        catch (JSException)
        {
            // Preserve download failures for the caller.
            throw;
        }
    }
}
