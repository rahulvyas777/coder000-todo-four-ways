using System.Net;
using System.Net.Http.Json;

namespace BlazorServerClient.Services;

public sealed class TaskList
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int Position { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public int TaskCount { get; set; }
    public int OpenCount { get; set; }
}

public sealed class TaskItem
{
    public int Id { get; set; }
    public int ListId { get; set; }
    public string Title { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateOnly? DueDate { get; set; }
    public int Priority { get; set; }
    public List<string> Tags { get; set; } = [];
    public bool Completed { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int Position { get; set; }
    public string Repeat { get; set; } = "none";
    public DateTime? DeletedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<Subtask> Subtasks { get; set; } = [];
}

public sealed class Subtask
{
    public int Id { get; set; }
    public int TaskId { get; set; }
    public string Title { get; set; } = "";
    public bool Done { get; set; }
    public int Position { get; set; }
}

/// <summary>Server-side client of the Tasks API (the browser never calls the API directly).</summary>
public sealed class TasksApi(HttpClient http)
{
    public async Task<List<TaskList>> GetListsAsync() =>
        await http.GetFromJsonAsync<List<TaskList>>("api/lists") ?? [];

    /// <summary>The list's tasks in manual order, or null when the list does not exist.</summary>
    public async Task<List<TaskItem>?> GetTasksAsync(int listId)
    {
        using var res = await http.GetAsync($"api/lists/{listId}/tasks");
        if (res.StatusCode == HttpStatusCode.NotFound) return null;
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<List<TaskItem>>() ?? [];
    }

    public async Task<TaskList> CreateListAsync(string name)
    {
        using var res = await http.PostAsJsonAsync("api/lists", new { name });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskList>())!;
    }

    public async Task<TaskList> RenameListAsync(int id, string name)
    {
        using var res = await http.PatchAsJsonAsync($"api/lists/{id}", new { name });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskList>())!;
    }

    public async Task DeleteListAsync(int id)
    {
        using var res = await http.DeleteAsync($"api/lists/{id}");
        res.EnsureSuccessStatusCode();
    }
}
