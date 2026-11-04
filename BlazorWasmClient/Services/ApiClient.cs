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

    public async Task<TaskItem> CreateTaskAsync(int listId, string title)
    {
        var response = await http.PostAsJsonAsync("api/tasks", new { listId, title });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    public async Task<TaskItem> RenameTaskAsync(int id, string title)
    {
        var response = await http.PatchAsJsonAsync($"api/tasks/{id}", new { title });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    /// <summary>Sends only the fields set on <paramref name="patch"/> (an anonymous object).</summary>
    public async Task<TaskItem> UpdateTaskAsync(int id, object patch)
    {
        var response = await http.PatchAsJsonAsync($"api/tasks/{id}", patch);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    public async Task<CompleteResult> CompleteTaskAsync(int id)
    {
        var response = await http.PostAsync($"api/tasks/{id}/complete", null);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CompleteResult>())!;
    }

    public async Task<TaskItem> ReopenTaskAsync(int id)
    {
        var response = await http.PostAsync($"api/tasks/{id}/reopen", null);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    /// <summary>Sets the positions of the list's tasks to the order of <paramref name="orderedIds"/>.</summary>
    public async Task ReorderTasksAsync(int listId, IReadOnlyList<int> orderedIds)
    {
        var response = await http.PostAsJsonAsync("api/tasks/reorder", new { listId, orderedIds });
        response.EnsureSuccessStatusCode();
    }

    public async Task DeleteTaskAsync(int id)
    {
        var response = await http.DeleteAsync($"api/tasks/{id}");
        response.EnsureSuccessStatusCode();
    }
}
