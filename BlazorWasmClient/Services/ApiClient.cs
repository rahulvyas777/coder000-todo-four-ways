using System.Net.Http.Json;

namespace BlazorWasmClient.Services;

/// <summary>Typed access to the Tasks API (JSON is camelCase, which the web defaults handle).</summary>
public sealed class ApiClient(HttpClient http)
{
    public async Task<List<TaskList>> GetListsAsync() =>
        await http.GetFromJsonAsync<List<TaskList>>("api/lists") ?? [];

    public async Task<List<TaskItem>> GetTasksAsync(int listId) =>
        await http.GetFromJsonAsync<List<TaskItem>>($"api/lists/{listId}/tasks") ?? [];
}
