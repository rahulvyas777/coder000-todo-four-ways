namespace BlazorWasmClient.Services;

/// <summary>The lists shown in the sidebar, shared by the layout and the pages.</summary>
public sealed class AppState(ApiClient api)
{
    private Task? _loading;

    public List<TaskList> Lists { get; private set; } = [];
    public bool ListsLoaded { get; private set; }
    public string? Error { get; private set; }

    public event Action? Changed;

    /// <summary>Loads the lists once; later callers await the same request.</summary>
    public Task EnsureListsAsync() => _loading ??= ReloadListsAsync();

    public async Task ReloadListsAsync()
    {
        try
        {
            Lists = await api.GetListsAsync();
            Error = null;
        }
        catch (Exception ex)
        {
            Error = $"Could not load the lists: {ex.Message}";
        }
        ListsLoaded = true;
        Changed?.Invoke();
    }

    public TaskList? FindList(int id) => Lists.FirstOrDefault(l => l.Id == id);

    // Each change goes through the API, then the lists (and their counts) are re-read from it.
    public async Task<TaskList> AddListAsync(string name)
    {
        var list = await api.CreateListAsync(name);
        await ReloadListsAsync();
        return list;
    }

    public async Task RenameListAsync(int id, string name)
    {
        await api.RenameListAsync(id, name);
        await ReloadListsAsync();
    }

    public async Task DeleteListAsync(int id)
    {
        await api.DeleteListAsync(id);
        await ReloadListsAsync();
    }

    /// <summary>Restores a soft-deleted list (the API restores its tasks with it).</summary>
    public async Task RestoreListAsync(int id)
    {
        await api.RestoreListAsync(id);
        await ReloadListsAsync();
    }

    /// <summary>Raised after an undo changed tasks on the server, so a page showing them re-reads.</summary>
    public event Action<int>? TasksChanged;

    public void NotifyTasksChanged(int listId) => TasksChanged?.Invoke(listId);
}
