using System.Net.Http.Json;

namespace BlazorWasmClient.Services;

/// <summary>Typed access to the Tasks API (JSON is camelCase, which the web defaults handle).</summary>
public sealed class ApiClient(HttpClient http)
{
    public async Task<List<TaskList>> GetListsAsync() =>
        await http.GetFromJsonAsync<List<TaskList>>("api/lists") ?? [];

    public async Task<TaskList> CreateListAsync(string name)
    {
        var response = await http.PostAsJsonAsync("api/lists", new { name });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TaskList>())!;
    }

    public async Task<TaskList> RenameListAsync(int id, string name)
    {
        var response = await http.PatchAsJsonAsync($"api/lists/{id}", new { name });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TaskList>())!;
    }

    public async Task DeleteListAsync(int id)
    {
        var response = await http.DeleteAsync($"api/lists/{id}");
        response.EnsureSuccessStatusCode();
    }

    public async Task<List<TaskItem>> GetTasksAsync(int listId) =>
        await http.GetFromJsonAsync<List<TaskItem>>($"api/lists/{listId}/tasks") ?? [];
}
