using Microsoft.EntityFrameworkCore;

namespace TasksApi.Data;

public class TasksDb(DbContextOptions<TasksDb> options) : DbContext(options)
{
    public DbSet<TaskList> Lists => Set<TaskList>();
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
    public DbSet<Subtask> Subtasks => Set<Subtask>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TaskList>(e =>
        {
            e.ToTable("Lists");
            e.Property(x => x.Name).HasMaxLength(80);
            e.HasMany(x => x.Tasks).WithOne().HasForeignKey(t => t.ListId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<TaskItem>(e =>
        {
            e.ToTable("Tasks");
            e.Property(x => x.Title).HasMaxLength(200);
            e.HasIndex(x => new { x.ListId, x.Position });
            e.HasMany(x => x.Subtasks).WithOne().HasForeignKey(s => s.TaskId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<Subtask>(e =>
        {
            e.ToTable("Subtasks");
            e.Property(x => x.Title).HasMaxLength(200);
            e.HasIndex(x => x.TaskId);
        });
    }
}

/// <summary>Where the database file lives: --db, then TASKS_DB, then ./data.db.</summary>
public sealed class DbSettings
{
    public string Path { get; }
    public string ConnectionString => $"Data Source={Path};Pooling=True";

    public DbSettings(string path) => Path = System.IO.Path.GetFullPath(path);

    public static DbSettings From(IConfiguration config)
    {
        var p = config["db"];
        if (string.IsNullOrWhiteSpace(p)) p = config["TASKS_DB"];
        if (string.IsNullOrWhiteSpace(p)) p = Environment.GetEnvironmentVariable("TASKS_DB");
        if (string.IsNullOrWhiteSpace(p)) p = "data.db";
        return new DbSettings(p);
    }
}
