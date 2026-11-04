namespace BlazorWasmClient.Services;

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
    public string? DueDate { get; set; }
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
