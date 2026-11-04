namespace BlazorWasmClient.Services;

/// <summary>
/// The single undo toast: a new action replaces the current one, and it hides itself after
/// five seconds. Undo runs only the latest action's callback.
/// </summary>
public sealed class ToastService
{
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(5);

    private CancellationTokenSource? _timer;
    private Func<Task>? _undo;

    public string? Message { get; private set; }
    public string? Error { get; private set; }

    public event Action? Changed;

    public void Show(string message, Func<Task> undo)
    {
        Message = message;
        Error = null;
        _undo = undo;
        StartTimer();
        Changed?.Invoke();
    }

    public async Task UndoAsync()
    {
        var undo = _undo;
        Hide();
        if (undo is null) return;
        try
        {
            await undo();
        }
        catch (HttpRequestException ex)
        {
            Message = null;
            Error = $"Could not undo: {ex.Message}";
            StartTimer();
            Changed?.Invoke();
        }
    }

    public void Hide()
    {
        _timer?.Cancel();
        _timer = null;
        _undo = null;
        Message = null;
        Error = null;
        Changed?.Invoke();
    }

    private void StartTimer()
    {
        _timer?.Cancel();
        var cts = _timer = new CancellationTokenSource();
        _ = HideLater(cts.Token);
    }

    private async Task HideLater(CancellationToken token)
    {
        try
        {
            await Task.Delay(Duration, token);
        }
        catch (TaskCanceledException)
        {
            return;
        }
        Hide();
    }
}
