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
}
