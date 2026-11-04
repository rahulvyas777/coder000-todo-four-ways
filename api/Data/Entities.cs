namespace TasksApi.Data;

public class TaskList
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int Position { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public List<TaskItem> Tasks { get; set; } = new();
}

public class TaskItem
{
    public int Id { get; set; }
    public int ListId { get; set; }
    public string Title { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateOnly? DueDate { get; set; }
    public int Priority { get; set; }
    public List<string> Tags { get; set; } = new();
    public bool Completed { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int Position { get; set; }
    public string Repeat { get; set; } = "none";
    public DateTime? DeletedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<Subtask> Subtasks { get; set; } = new();
}

public class Subtask
{
    public int Id { get; set; }
    public int TaskId { get; set; }
    public string Title { get; set; } = "";
    public bool Done { get; set; }
    public int Position { get; set; }
}
