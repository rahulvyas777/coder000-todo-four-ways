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

    public async Task<TaskList> RestoreListAsync(int id)
    {
        using var res = await http.PostAsync($"api/lists/{id}/restore", null);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskList>())!;
    }

    public async Task<TaskItem> CreateTaskAsync(int listId, string title)
    {
        using var res = await http.PostAsJsonAsync("api/tasks", new { listId, title });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    public async Task<TaskItem> RenameTaskAsync(int id, string title)
    {
        using var res = await http.PatchAsJsonAsync($"api/tasks/{id}", new { title });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    /// <summary>Sends only the given fields (an anonymous object; a null value clears the field).</summary>
    public async Task<TaskItem> PatchTaskAsync(int id, object fields)
    {
        using var res = await http.PatchAsJsonAsync($"api/tasks/{id}", fields);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    /// <summary>Completes the task; the result also carries the next occurrence of a repeating task.</summary>
    public async Task<CompleteResult> CompleteTaskAsync(int id)
    {
        using var res = await http.PostAsync($"api/tasks/{id}/complete", null);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<CompleteResult>())!;
    }

    public async Task<TaskItem> ReopenTaskAsync(int id)
    {
        using var res = await http.PostAsync($"api/tasks/{id}/reopen", null);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    public async Task DeleteTaskAsync(int id)
    {
        using var res = await http.DeleteAsync($"api/tasks/{id}");
        res.EnsureSuccessStatusCode();
    }

    public async Task<TaskItem> RestoreTaskAsync(int id)
    {
        using var res = await http.PostAsync($"api/tasks/{id}/restore", null);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskItem>())!;
    }

    /// <summary>Sets the list's manual order: positions follow the order of the ids.</summary>
    public async Task ReorderTasksAsync(int listId, IReadOnlyList<int> orderedIds)
    {
        using var res = await http.PostAsJsonAsync("api/tasks/reorder", new { listId, orderedIds });
        res.EnsureSuccessStatusCode();
    }

    /// <summary>Applies one action (complete, reopen, delete, restore, move) to many tasks; returns the affected count.</summary>
    public async Task<int> BulkAsync(IReadOnlyCollection<int> ids, string action, int? targetListId = null)
    {
        using var res = await http.PostAsJsonAsync("api/tasks/bulk", new { ids, action, targetListId });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<BulkResult>())!.Affected;
    }

    public async Task<Subtask> AddSubtaskAsync(int taskId, string title)
    {
        using var res = await http.PostAsJsonAsync($"api/tasks/{taskId}/subtasks", new { title });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<Subtask>())!;
    }

    public async Task<Subtask> SetSubtaskDoneAsync(int id, bool done)
    {
        using var res = await http.PatchAsJsonAsync($"api/subtasks/{id}", new { done });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<Subtask>())!;
    }

    public async Task DeleteSubtaskAsync(int id)
    {
        using var res = await http.DeleteAsync($"api/subtasks/{id}");
        res.EnsureSuccessStatusCode();
    }

    /// <summary>The API's export download (json or csv); the caller disposes the response.</summary>
    public Task<HttpResponseMessage> ExportListAsync(int id, string format) =>
        http.GetAsync($"api/lists/{id}/export?format={Uri.EscapeDataString(format)}", HttpCompletionOption.ResponseHeadersRead);

    /// <summary>Posts an exported list (the JSON document as is) and returns the created list.</summary>
    public async Task<TaskList> ImportListAsync(string json)
    {
        using var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        using var res = await http.PostAsync("api/lists/import", content);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskList>())!;
    }
}

public sealed class CompleteResult
{
    public TaskItem Task { get; set; } = new();
    public TaskItem? Next { get; set; }
}

public sealed class BulkResult
{
    public int Affected { get; set; }
}
