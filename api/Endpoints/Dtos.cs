using System.Globalization;
using System.Text.Json;
using TasksApi.Data;

namespace TasksApi.Endpoints;

public sealed record ListDto(int Id, string Name, int Position, DateTime CreatedAt, DateTime? DeletedAt, int TaskCount, int OpenCount);

public sealed record SubtaskDto(int Id, int TaskId, string Title, bool Done, int Position);

public sealed record TaskDto(
    int Id, int ListId, string Title, string Notes, DateOnly? DueDate, int Priority, string[] Tags, bool Completed,
    DateTime? CompletedAt, int Position, string Repeat, DateTime? DeletedAt, DateTime CreatedAt, DateTime UpdatedAt,
    SubtaskDto[] Subtasks);

public sealed record CompleteResult(TaskDto Task, TaskDto? Next);

public sealed record BulkResult(int Affected);

public sealed record CreateListBody(string? Name);

public sealed record CreateTaskBody(int? ListId, string? Title, string? Notes, string? DueDate, int? Priority, string[]? Tags, string? Repeat);

public sealed record CreateSubtaskBody(string? Title);

public sealed record ReorderBody(int? ListId, int[]? OrderedIds);

public sealed record BulkBody(int[]? Ids, string? Action, int? TargetListId);

public sealed record ImportSubtask(string? Title, bool? Done);

public sealed record ImportTask(string? Title, string? Notes, string? DueDate, int? Priority, string[]? Tags, bool? Completed, string? Repeat, ImportSubtask[]? Subtasks);

public sealed record ImportBody(string? Name, ImportTask[]? Tasks);

public sealed record ExportSubtask(string Title, bool Done);

public sealed record ExportTask(string Title, string Notes, DateOnly? DueDate, int Priority, string[] Tags, bool Completed, string Repeat, ExportSubtask[] Subtasks);

public sealed record ExportFile(string Name, ExportTask[] Tasks);

public static class Map
{
    // SQLite returns DateTime with Kind=Unspecified; every stored timestamp is UTC, so mark it as such
    // and System.Text.Json writes the trailing "Z".
    public static DateTime Utc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc);
    public static DateTime? Utc(DateTime? d) => d is { } v ? Utc(v) : null;

    public static ListDto List(TaskList l, int taskCount, int openCount) =>
        new(l.Id, l.Name, l.Position, Utc(l.CreatedAt), Utc(l.DeletedAt), taskCount, openCount);

    public static SubtaskDto Subtask(Subtask s) => new(s.Id, s.TaskId, s.Title, s.Done, s.Position);

    public static TaskDto Task(TaskItem t) => new(
        t.Id, t.ListId, t.Title, t.Notes, t.DueDate, t.Priority, t.Tags.ToArray(), t.Completed, Utc(t.CompletedAt),
        t.Position, t.Repeat, Utc(t.DeletedAt), Utc(t.CreatedAt), Utc(t.UpdatedAt),
        t.Subtasks.OrderBy(s => s.Position).ThenBy(s => s.Id).Select(Subtask).ToArray());
}

/// <summary>Collects validation errors in the shape Results.ValidationProblem expects.</summary>
public sealed class Errors
{
    readonly Dictionary<string, List<string>> _e = new();
    public bool Any => _e.Count > 0;
    public void Add(string key, string message)
    {
        if (!_e.TryGetValue(key, out var l)) _e[key] = l = new List<string>();
        l.Add(message);
    }
    public IResult Result() => Results.ValidationProblem(_e.ToDictionary(k => k.Key, k => k.Value.ToArray()));
}

public static class Rules
{
    public static readonly string[] Repeats = ["none", "daily", "weekly", "monthly"];

    public static string? Title(string? value, string key, Errors e, int max = 200)
    {
        var t = value?.Trim() ?? "";
        if (t.Length == 0) { e.Add(key, $"The {key} field is required."); return null; }
        if (t.Length > max) { e.Add(key, $"The {key} field must be at most {max} characters."); return null; }
        return t;
    }

    public static bool Due(string? value, string key, Errors e, out DateOnly? due)
    {
        due = null;
        if (value is null) return true;
        if (DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) { due = d; return true; }
        e.Add(key, $"The {key} field must be a date in the form yyyy-MM-dd.");
        return false;
    }

    public static bool Priority(int? value, string key, Errors e)
    {
        if (value is null or (>= 0 and <= 3)) return true;
        e.Add(key, $"The {key} field must be 0, 1, 2 or 3.");
        return false;
    }

    public static bool Repeat(string? value, string key, Errors e)
    {
        if (value is null || Repeats.Contains(value)) return true;
        e.Add(key, $"The {key} field must be one of none, daily, weekly, monthly.");
        return false;
    }

    /// <summary>Lower-case, trimmed, non-empty, unique, first occurrence order kept.</summary>
    public static List<string> Tags(IEnumerable<string?>? tags, string key, Errors e)
    {
        var result = new List<string>();
        if (tags is null) return result;
        foreach (var raw in tags)
        {
            var t = raw?.Trim().ToLowerInvariant() ?? "";
            if (t.Length == 0) continue;
            if (t.Length > 40) { e.Add(key, "A tag must be at most 40 characters."); continue; }
            if (!result.Contains(t)) result.Add(t);
        }
        return result;
    }

    // PATCH bodies are read as JsonElement so that "dueDate": null (clear) differs from an absent key.
    public static bool Has(JsonElement body, string name, out JsonElement value)
    {
        foreach (var p in body.EnumerateObject())
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)) { value = p.Value; return true; }
        value = default;
        return false;
    }

    public static string? AsString(JsonElement v, string key, Errors e, bool allowNull)
    {
        if (v.ValueKind == JsonValueKind.String) return v.GetString();
        if (v.ValueKind == JsonValueKind.Null && allowNull) return null;
        e.Add(key, $"The {key} field must be a string{(allowNull ? " or null" : "")}.");
        return null;
    }

    public static int? AsInt(JsonElement v, string key, Errors e)
    {
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)) return i;
        e.Add(key, $"The {key} field must be an integer.");
        return null;
    }

    public static bool? AsBool(JsonElement v, string key, Errors e)
    {
        if (v.ValueKind is JsonValueKind.True or JsonValueKind.False) return v.GetBoolean();
        e.Add(key, $"The {key} field must be true or false.");
        return null;
    }

    public static string?[]? AsStringArray(JsonElement v, string key, Errors e)
    {
        if (v.ValueKind == JsonValueKind.Null) return [];
        if (v.ValueKind != JsonValueKind.Array) { e.Add(key, $"The {key} field must be an array of strings."); return null; }
        var list = new List<string?>();
        foreach (var item in v.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) { e.Add(key, $"The {key} field must be an array of strings."); return null; }
            list.Add(item.GetString());
        }
        return list.ToArray();
    }

    /// <summary>Letters, digits, '-' and '_' only; "list" when nothing is left.</summary>
    public static string FileName(string name)
    {
        var s = new string(name.Where(c => char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_').ToArray());
        return s.Length == 0 ? "list" : s;
    }
}
