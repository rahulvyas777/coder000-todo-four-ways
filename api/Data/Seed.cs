using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace TasksApi.Data;

/// <summary>
/// Builds the deterministic seed. The content comes from System.Random(20261104) and never changes;
/// only the dates move, because every due date is an offset from the server's local date at the
/// moment the database is created (so "today" is always the real today).
/// Task ids are fixed by creation order: Work 1..40, Home 41..78, Reading 79..114,
/// Archive 10k 115..10114.
/// </summary>
public static class SeedData
{
    public const int RandomSeed = 20261104;

    static readonly string[] Names =
        ["Maria Garcia", "David Chen", "Aisha Khan", "Tomasz Nowak", "Yuki Tanaka", "Fatima Al-Sayed", "Lucas Oliveira", "Priya Raman"];

    static readonly string[] TagPool = ["invoice", "call", "errand", "book", "urgent", "email", "repair", "study"];

    static readonly string[] WorkTitles =
    [
        "Send the invoice to {n}", "Call {n} about the contract renewal", "Prepare the quarterly report for {n}",
        "Review the budget draft from {n}", "Email {n} the meeting notes", "Book a meeting room for {n}",
        "Update the project plan with {n}", "Check the expense claims from {n}", "Reply to {n} about the delivery date",
        "Draft the proposal for {n}",
    ];

    static readonly string[] HomeTitles =
    [
        "Call {n} about the roof repair", "Buy groceries for dinner with {n}", "Fix the kitchen tap before {n} visits",
        "Pay the electricity bill", "Pick up the parcel for {n}", "Return the drill to {n}", "Water the plants",
        "Book the car service", "Clean the garage with {n}", "Order a birthday gift for {n}",
    ];

    static readonly string[] ReadingTitles =
    [
        "Finish chapter {k} of the database book", "Read the article {n} recommended",
        "Write notes on chapter {k} of the networking book", "Return the library book to {n}",
        "Study the sorting algorithms chapter", "Summarise the design patterns book for {n}",
        "Read two papers on caching", "Lend the novel to {n}", "Review the study plan with {n}",
        "Practise the exercises in chapter {k}",
    ];

    static readonly string[] NotesPool =
    [
        "Ask {n} for the details first.", "Keep the receipt.", "Needs about an hour.",
        "Check the shared folder before starting.", "Follow up next week if there is no answer.",
    ];

    static readonly string[] SubtaskTitles =
    [
        "Draft the outline", "Check the figures", "Ask {n} for feedback", "Print two copies",
        "Collect the documents", "Set a reminder", "Write the summary",
    ];

    static readonly string[] Verbs = ["Fix", "Review", "Update", "Check", "Close", "Test", "Deploy", "Document", "Migrate", "Archive"];

    static readonly string[] Objects =
    [
        "the login page", "the invoice export", "the search index", "the backup job", "the mobile layout",
        "the report filter", "the email template", "the import script", "the audit log", "the user settings",
    ];

    static readonly string[] ArchiveTags =
        ["backend", "frontend", "bug", "feature", "docs", "ops", "security", "ui", "api", "data", "test", "release"];

    public sealed record Result(List<TaskList> Lists, List<TaskItem> Tasks, List<Subtask> Subtasks);

    public static Result Build(DateOnly today, DateTime nowUtc)
    {
        var rng = new Random(RandomSeed);
        var lists = new List<TaskList>();
        var tasks = new List<TaskItem>();
        var subs = new List<Subtask>();
        const int total = 40 + 38 + 36 + 10_000;
        int taskId = 0, subId = 0;

        DateTime Created(int id) => nowUtc.AddSeconds(-(total - id) - 60);

        string Fill(string template) => template
            .Replace("{n}", Names[rng.Next(Names.Length)])
            .Replace("{k}", rng.Next(1, 13).ToString(CultureInfo.InvariantCulture));

        void SmallList(int listId, string name, int count, string[] titles, int withSubtasks)
        {
            lists.Add(new TaskList { Id = listId, Name = name, Position = listId, CreatedAt = nowUtc.AddDays(-1).AddMinutes(listId) });

            // Due-date categories: overdue, today (4), within seven days, later, none. Shuffled.
            int o = count / 5, w = count / 5, l = count / 5, t = 4;
            var cats = new List<string>();
            cats.AddRange(Enumerable.Repeat("overdue", o));
            cats.AddRange(Enumerable.Repeat("today", t));
            cats.AddRange(Enumerable.Repeat("week", w));
            cats.AddRange(Enumerable.Repeat("later", l));
            cats.AddRange(Enumerable.Repeat("none", count - o - t - w - l));
            for (int i = cats.Count - 1; i > 0; i--) { int j = rng.Next(i + 1); (cats[i], cats[j]) = (cats[j], cats[i]); }

            // The first two tasks due today or overdue repeat (daily, then weekly) and stay open.
            var repeatIdx = cats.Select((c, i) => (c, i)).Where(x => x.c is "today" or "overdue").Select(x => x.i).Take(2).ToArray();

            // Exactly a third completed (rounded down), never the first task or a repeating one.
            var candidates = Enumerable.Range(1, count - 1).Where(i => !repeatIdx.Contains(i)).ToList();
            for (int i = candidates.Count - 1; i > 0; i--) { int j = rng.Next(i + 1); (candidates[i], candidates[j]) = (candidates[j], candidates[i]); }
            var completedIdx = new HashSet<int>(candidates.Take(count / 3));

            // Subtasks on distinct task indexes (never index 0, so task-row of the first task is plain).
            var subIdx = new HashSet<int>();
            while (subIdx.Count < withSubtasks) subIdx.Add(rng.Next(1, count));

            for (int i = 0; i < count; i++)
            {
                taskId++;
                var due = cats[i] switch
                {
                    "overdue" => today.AddDays(-rng.Next(1, 31)),
                    "today" => today,
                    "week" => today.AddDays(rng.Next(1, 8)),
                    "later" => today.AddDays(rng.Next(8, 91)),
                    _ => (DateOnly?)null,
                };
                var tags = new List<string>();
                int tagCount = rng.Next(0, 3);
                while (tags.Count < tagCount) { var tg = TagPool[rng.Next(TagPool.Length)]; if (!tags.Contains(tg)) tags.Add(tg); }
                var notes = rng.NextDouble() < 0.4 ? Fill(NotesPool[rng.Next(NotesPool.Length)]) : "";
                var repeat = i == (repeatIdx.Length > 0 ? repeatIdx[0] : -1) ? "daily" : i == (repeatIdx.Length > 1 ? repeatIdx[1] : -1) ? "weekly" : "none";
                bool completed = completedIdx.Contains(i);
                var created = Created(taskId);
                DateTime? completedAt = completed ? nowUtc.AddHours(-rng.Next(1, 240)) : null;
                var item = new TaskItem
                {
                    Id = taskId, ListId = listId, Title = Fill(titles[i % titles.Length]), Notes = notes, DueDate = due,
                    Priority = rng.Next(0, 4), Tags = tags, Completed = completed, CompletedAt = completedAt,
                    Position = i + 1, Repeat = repeat, CreatedAt = created,
                    UpdatedAt = completedAt is { } ca && ca > created ? ca : created,
                };
                tasks.Add(item);
                if (subIdx.Contains(i))
                {
                    int n = rng.Next(2, 6);
                    for (int s = 0; s < n; s++)
                    {
                        subId++;
                        subs.Add(new Subtask { Id = subId, TaskId = taskId, Title = Fill(SubtaskTitles[(s + i) % SubtaskTitles.Length]), Done = rng.NextDouble() < 0.4, Position = s + 1 });
                    }
                }
            }
        }

        SmallList(1, "Work", 40, WorkTitles, 3);
        SmallList(2, "Home", 38, HomeTitles, 3);
        SmallList(3, "Reading", 36, ReadingTitles, 2);

        // Archive 10k: exactly 10,000 tasks, exactly 3,000 completed, two tags each, no subtasks.
        lists.Add(new TaskList { Id = 4, Name = "Archive 10k", Position = 4, CreatedAt = nowUtc.AddDays(-1).AddMinutes(4) });
        const int n10k = 10_000;
        var perm = Enumerable.Range(0, n10k).ToArray();
        for (int i = perm.Length - 1; i > 0; i--) { int j = rng.Next(i + 1); (perm[i], perm[j]) = (perm[j], perm[i]); }
        var completedSet = new HashSet<int>(perm.Take(3_000));
        for (int i = 0; i < n10k; i++)
        {
            taskId++;
            var t1 = ArchiveTags[rng.Next(ArchiveTags.Length)];
            string t2;
            do { t2 = ArchiveTags[rng.Next(ArchiveTags.Length)]; } while (t2 == t1);
            var title = $"Ticket {(i + 1).ToString("D5", CultureInfo.InvariantCulture)}: {Verbs[rng.Next(Verbs.Length)]} {Objects[rng.Next(Objects.Length)]} for {Names[rng.Next(Names.Length)]}";
            var due = today.AddDays(rng.Next(-365, 366));
            int priority = rng.Next(0, 4);
            bool completed = completedSet.Contains(i);
            var created = Created(taskId);
            DateTime? completedAt = completed ? created.AddSeconds(30) : null;
            tasks.Add(new TaskItem
            {
                Id = taskId, ListId = 4, Title = title, Notes = "", DueDate = due, Priority = priority,
                Tags = [t1, t2], Completed = completed, CompletedAt = completedAt, Position = i + 1, Repeat = "none",
                CreatedAt = created, UpdatedAt = completedAt ?? created,
            });
        }
        return new Result(lists, tasks, subs);
    }
}

/// <summary>Creates the database when missing and rebuilds it on POST /api/admin/reset.</summary>
public sealed class SeedService(DbSettings settings, IServiceScopeFactory scopes, ILogger<SeedService> log)
{
    static readonly object Gate = new();
    const string DateTimeFormat = "yyyy-MM-dd HH:mm:ss.FFFFFFF"; // the format EF Core's SQLite provider writes

    public void EnsureDatabase()
    {
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<TasksDb>();
            db.Database.EnsureCreated();
            if (!db.Lists.IgnoreQueryFilters().Any())
            {
                var sw = Stopwatch.StartNew();
                using var conn = new SqliteConnection(settings.ConnectionString);
                conn.Open();
                using var tx = conn.BeginTransaction();
                Insert(conn, tx);
                tx.Commit();
                log.LogInformation("Seeded {Path} in {Ms} ms", settings.Path, sw.ElapsedMilliseconds);
            }
        }
    }

    /// <summary>
    /// Rebuilds the seed. mode "inplace" (default): one transaction that deletes every row and
    /// re-inserts the seed; works while other connections are open. mode "recreate": clears the
    /// connection pool, deletes the file and creates it again.
    /// </summary>
    public long Reset(string mode = "inplace")
    {
        lock (Gate)
        {
            var sw = Stopwatch.StartNew();
            if (mode == "recreate")
            {
                SqliteConnection.ClearAllPools();
                foreach (var suffix in new[] { "", "-journal", "-wal", "-shm" })
                {
                    var f = settings.Path + suffix;
                    for (int attempt = 0; File.Exists(f); attempt++)
                    {
                        try { File.Delete(f); }
                        catch (IOException) when (attempt < 20) { Thread.Sleep(50); }
                    }
                }
                using var scope = scopes.CreateScope();
                scope.ServiceProvider.GetRequiredService<TasksDb>().Database.EnsureCreated();
                using var conn = new SqliteConnection(settings.ConnectionString);
                conn.Open();
                using var tx = conn.BeginTransaction();
                Insert(conn, tx);
                tx.Commit();
            }
            else
            {
                using (var scope = scopes.CreateScope())
                    scope.ServiceProvider.GetRequiredService<TasksDb>().Database.EnsureCreated();
                using var conn = new SqliteConnection(settings.ConnectionString);
                conn.Open();
                using var tx = conn.BeginTransaction();
                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = "DELETE FROM Subtasks; DELETE FROM Tasks; DELETE FROM Lists;";
                    cmd.ExecuteNonQuery();
                    cmd.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'";
                    if (Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) > 0)
                    {
                        cmd.CommandText = "DELETE FROM sqlite_sequence";
                        cmd.ExecuteNonQuery();
                    }
                }
                Insert(conn, tx);
                tx.Commit();
            }
            var ms = sw.ElapsedMilliseconds;
            log.LogInformation("Reset ({Mode}) in {Ms} ms", mode, ms);
            return ms;
        }
    }

    static string Ts(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString(DateTimeFormat, CultureInfo.InvariantCulture);
    static object Ts(DateTime? d) => d is { } v ? Ts(v) : DBNull.Value;

    static void Insert(SqliteConnection conn, SqliteTransaction tx)
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var seed = SeedData.Build(today, DateTime.UtcNow);

        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "INSERT INTO Lists (Id, Name, Position, CreatedAt, DeletedAt) VALUES ($id, $name, $pos, $created, NULL)";
            var pId = cmd.Parameters.Add("$id", SqliteType.Integer);
            var pName = cmd.Parameters.Add("$name", SqliteType.Text);
            var pPos = cmd.Parameters.Add("$pos", SqliteType.Integer);
            var pCreated = cmd.Parameters.Add("$created", SqliteType.Text);
            cmd.Prepare();
            foreach (var l in seed.Lists)
            {
                pId.Value = l.Id; pName.Value = l.Name; pPos.Value = l.Position; pCreated.Value = Ts(l.CreatedAt);
                cmd.ExecuteNonQuery();
            }
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText =
                "INSERT INTO Tasks (Id, ListId, Title, Notes, DueDate, Priority, Tags, Completed, CompletedAt, Position, Repeat, DeletedAt, CreatedAt, UpdatedAt) " +
                "VALUES ($id, $list, $title, $notes, $due, $prio, $tags, $done, $doneAt, $pos, $repeat, NULL, $created, $updated)";
            var p = new Dictionary<string, SqliteParameter>();
            foreach (var (name, type) in new (string, SqliteType)[]
            {
                ("$id", SqliteType.Integer), ("$list", SqliteType.Integer), ("$title", SqliteType.Text), ("$notes", SqliteType.Text),
                ("$due", SqliteType.Text), ("$prio", SqliteType.Integer), ("$tags", SqliteType.Text), ("$done", SqliteType.Integer),
                ("$doneAt", SqliteType.Text), ("$pos", SqliteType.Integer), ("$repeat", SqliteType.Text), ("$created", SqliteType.Text),
                ("$updated", SqliteType.Text),
            })
                p[name] = cmd.Parameters.Add(name, type);
            cmd.Prepare();
            foreach (var t in seed.Tasks)
            {
                p["$id"].Value = t.Id; p["$list"].Value = t.ListId; p["$title"].Value = t.Title; p["$notes"].Value = t.Notes;
                p["$due"].Value = t.DueDate is { } d ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : DBNull.Value;
                p["$prio"].Value = t.Priority; p["$tags"].Value = JsonSerializer.Serialize(t.Tags);
                p["$done"].Value = t.Completed ? 1 : 0; p["$doneAt"].Value = Ts(t.CompletedAt); p["$pos"].Value = t.Position;
                p["$repeat"].Value = t.Repeat; p["$created"].Value = Ts(t.CreatedAt); p["$updated"].Value = Ts(t.UpdatedAt);
                cmd.ExecuteNonQuery();
            }
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "INSERT INTO Subtasks (Id, TaskId, Title, Done, Position) VALUES ($id, $task, $title, $done, $pos)";
            var pId = cmd.Parameters.Add("$id", SqliteType.Integer);
            var pTask = cmd.Parameters.Add("$task", SqliteType.Integer);
            var pTitle = cmd.Parameters.Add("$title", SqliteType.Text);
            var pDone = cmd.Parameters.Add("$done", SqliteType.Integer);
            var pPos = cmd.Parameters.Add("$pos", SqliteType.Integer);
            cmd.Prepare();
            foreach (var s in seed.Subtasks)
            {
                pId.Value = s.Id; pTask.Value = s.TaskId; pTitle.Value = s.Title; pDone.Value = s.Done ? 1 : 0; pPos.Value = s.Position;
                cmd.ExecuteNonQuery();
            }
        }
    }
}
