using System.Text.Json;
using Microsoft.JSInterop;
namespace Web;
public sealed class BrowserStore(IJSRuntime js)
{
 public async Task<T?> Load<T>(string key) { var raw=await js.InvokeAsync<string?>("portfolio.load",key); return raw is null ? default : JsonSerializer.Deserialize<T>(raw); }
 public Task Save<T>(string key,T value)=>js.InvokeVoidAsync("portfolio.save",key,JsonSerializer.Serialize(value)).AsTask();
 public Task Download(string name,string content,string type="application/json")=>js.InvokeVoidAsync("portfolio.download",name,content,type).AsTask();
}
