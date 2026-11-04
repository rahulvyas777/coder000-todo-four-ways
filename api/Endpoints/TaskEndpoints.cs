using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TasksApi.Data;

namespace TasksApi.Endpoints;

public static class TaskEndpoints
{
    static Task<TaskItem?> Find(TasksDb db, int id, bool includeDeleted = false) =>
        db.Tasks.Include(t => t.Subtasks).FirstOrDefaultAsync(t => t.Id == id && (includeDeleted || t.DeletedAt == null));

    static async Task<int> NextPosition(TasksDb db, int listId) =>
        (await db.Tasks.Where(t => t.ListId == listId).MaxAsync(t => (int?)t.Position) ?? 0) + 1;

    static Task<bool> ListExists(TasksDb db, int listId) => db.Lists.AnyAsync(l => l.Id == listId && l.DeletedAt == null);

    static IResult NotFoundFor(string key, string message)
    {
        // An unknown id inside a body is still an unknown id: 404, with problem details naming it.
        return Results.Problem(statusCode: 404, title: "Not Found", detail: message, extensions: new Dictionary<string, object?> { ["field"] = key });
    }

    /// <summary>Next occurrence of a repeating task: due + 1 day / 7 days / 1 month, or from today when undated.</summary>
    public static DateOnly NextDue(DateOnly? due, string repeat)
    {
        var from = due ?? DateOnly.FromDateTime(DateTime.Now);
        return repeat switch
        {
            "daily" => from.AddDays(1),
            "weekly" => from.AddDays(7),
            "monthly" => from.AddMonths(1),
            _ => from,
        };
    }

    public static void MapTaskEndpoints(this RouteGroupBuilder api)
    {
        api.MapPost("/tasks", async (CreateTaskBody body, TasksDb db) =>
        {
            var e = new Errors();
            if (body.ListId is null) e.Add("listId", "The listId field is required.");
            var title = Rules.Title(body.Title, "title", e);
            Rules.Due(body.DueDate, "dueDate", e, out var due);
            Rules.Priority(body.Priority, "priority", e);
            Rules.Repeat(body.Repeat, "repeat", e);
            var tags = Rules.Tags(body.Tags, "tags", e);
            if (e.Any) return e.Result();
            if (!await ListExists(db, body.ListId!.Value)) return NotFoundFor("listId", $"List {body.ListId} does not exist.");
            var now = DateTime.UtcNow;
            var task = new TaskItem
            {
                ListId = body.ListId.Value, Title = title!, Notes = body.Notes ?? "", DueDate = due, Priority = body.Priority ?? 0,
                Tags = tags, Repeat = body.Repeat ?? "none", Position = await NextPosition(db, body.ListId.Value),
                CreatedAt = now, UpdatedAt = now,
            };
            db.Tasks.Add(task);
            await db.SaveChangesAsync();
            return Results.Created($"/api/tasks/{task.Id}", Map.Task(task));
        });

        api.MapGet("/tasks/{id:int}", async (int id, TasksDb db) =>
        {
            var t = await db.Tasks.AsNoTracking().Include(x => x.Subtasks).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null);
            return t is null ? Results.NotFound() : Results.Ok(Map.Task(t));
        });

        api.MapPatch("/tasks/{id:int}", async (int id, JsonElement body, TasksDb db) =>
        {
            var t = await Find(db, id);
            if (t is null) return Results.NotFound();
            var e = new Errors();
            if (body.ValueKind != JsonValueKind.Object) { e.Add("body", "The body must be a JSON object."); return e.Result(); }

            string? title = null, notes = null, repeat = null;
            bool setDue = false, setNotes = false;
            DateOnly? due = null;
            int? priority = null, listId = null;
            List<string>? tags = null;

            if (Rules.Has(body, "title", out var v)) title = Rules.Title(Rules.AsString(v, "title", e, false), "title", e);
            if (Rules.Has(body, "notes", out v)) { notes = Rules.AsString(v, "notes", e, true) ?? ""; setNotes = true; }
            if (Rules.Has(body, "dueDate", out v)) { setDue = true; Rules.Due(Rules.AsString(v, "dueDate", e, true), "dueDate", e, out due); }
            if (Rules.Has(body, "priority", out v)) { priority = Rules.AsInt(v, "priority", e); Rules.Priority(priority, "priority", e); }
            if (Rules.Has(body, "tags", out v)) { var arr = Rules.AsStringArray(v, "tags", e); if (arr is not null) tags = Rules.Tags(arr, "tags", e); }
            if (Rules.Has(body, "repeat", out v)) { repeat = Rules.AsString(v, "repeat", e, false); if (repeat is not null) Rules.Repeat(repeat, "repeat", e); }
            if (Rules.Has(body, "listId", out v)) listId = Rules.AsInt(v, "listId", e);
            if (e.Any) return e.Result();

            if (listId is { } lid && lid != t.ListId)
            {
                if (!await ListExists(db, lid)) return NotFoundFor("listId", $"List {lid} does not exist.");
                t.Position = await NextPosition(db, lid);
                t.ListId = lid;
            }
            if (title is not null) t.Title = title;
            if (setNotes) t.Notes = notes!;
            if (setDue) t.DueDate = due;
            if (priority is not null) t.Priority = priority.Value;
            if (tags is not null) t.Tags = tags;
            if (repeat is not null) t.Repeat = repeat;
            t.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(Map.Task(t));
        });

        api.MapPost("/tasks/{id:int}/complete", async (int id, TasksDb db) =>
        {
            var t = await Find(db, id);
            if (t is null) return Results.NotFound();
            if (t.Completed) return Results.Ok(new CompleteResult(Map.Task(t), null)); // idempotent, no new occurrence
            var now = DateTime.UtcNow;
            t.Completed = true;
            t.CompletedAt = now;
            t.UpdatedAt = now;
            TaskItem? next = null;
            if (t.Repeat != "none")
            {
                next = new TaskItem
                {
                    ListId = t.ListId, Title = t.Title, Notes = t.Notes, DueDate = NextDue(t.DueDate, t.Repeat), Priority = t.Priority,
                    Tags = t.Tags.ToList(), Repeat = t.Repeat, Position = await NextPosition(db, t.ListId), CreatedAt = now, UpdatedAt = now,
                    Subtasks = t.Subtasks.OrderBy(s => s.Position).Select((s, i) => new Subtask { Title = s.Title, Done = false, Position = i + 1 }).ToList(),
                };
                db.Tasks.Add(next);
            }
            await db.SaveChangesAsync();
            return Results.Ok(new CompleteResult(Map.Task(t), next is null ? null : Map.Task(next)));
        });

        api.MapPost("/tasks/{id:int}/reopen", async (int id, TasksDb db) =>
        {
            var t = await Find(db, id);
            if (t is null) return Results.NotFound();
            if (t.Completed)
            {
                t.Completed = false;
                t.CompletedAt = null;
                t.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }
            return Results.Ok(Map.Task(t));
        });

        api.MapDelete("/tasks/{id:int}", async (int id, TasksDb db) =>
        {
            var t = await db.Tasks.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null);
            if (t is null) return Results.NotFound();
            t.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/tasks/{id:int}/restore", async (int id, TasksDb db) =>
        {
            var t = await Find(db, id, includeDeleted: true);
            if (t is null) return Results.NotFound();
            if (t.DeletedAt is not null)
            {
                t.DeletedAt = null;
                t.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }
            return Results.Ok(Map.Task(t));
        });

        api.MapPost("/tasks/reorder", async (ReorderBody body, TasksDb db) =>
        {
            var e = new Errors();
            if (body.ListId is null) e.Add("listId", "The listId field is required.");
            if (body.OrderedIds is null) e.Add("orderedIds", "The orderedIds field is required.");
            if (e.Any) return e.Result();
            var listId = body.ListId!.Value;
            if (!await ListExists(db, listId)) return Results.NotFound();
            var ids = body.OrderedIds!;
            if (ids.Distinct().Count() != ids.Length) { e.Add("orderedIds", "The orderedIds field must not repeat an id."); return e.Result(); }

            var tasks = await db.Tasks.Where(t => t.ListId == listId).ToListAsync();
            var open = tasks.Where(t => t.DeletedAt == null).ToDictionary(t => t.Id);
            var foreign = ids.Where(i => !open.ContainsKey(i)).ToArray();
            if (foreign.Length > 0)
            {
                e.Add("orderedIds", $"These ids are not tasks of list {listId}: {string.Join(", ", foreign.Take(20))}.");
                return e.Result();
            }
            // Listed ids first, in the given order; every other task of the list keeps its relative order after them.
            var listed = new HashSet<int>(ids);
            var order = ids.Select(i => open[i])
                .Concat(tasks.Where(t => !listed.Contains(t.Id)).OrderBy(t => t.Position).ThenBy(t => t.Id))
                .ToList();
            for (int i = 0; i < order.Count; i++)
                if (order[i].Position != i + 1) order[i].Position = i + 1; // only changed rows are written
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/tasks/bulk", async (BulkBody body, TasksDb db) =>
        {
            var e = new Errors();
            var action = body.Action?.ToLowerInvariant();
            if (body.Ids is null) e.Add("ids", "The ids field is required.");
            if (action is not ("complete" or "reopen" or "delete" or "restore" or "move"))
                e.Add("action", "The action must be complete, reopen, delete, restore or move.");
            if (action == "move" && body.TargetListId is null) e.Add("targetListId", "The targetListId field is required for move.");
            if (e.Any) return e.Result();
            if (action == "move" && !await ListExists(db, body.TargetListId!.Value))
                return NotFoundFor("targetListId", $"List {body.TargetListId} does not exist.");

            var ids = body.Ids!.Distinct().ToArray();
            var tasks = await db.Tasks.Where(t => ids.Contains(t.Id)).OrderBy(t => t.ListId).ThenBy(t => t.Position).ToListAsync();
            var now = DateTime.UtcNow;
            int affected = 0;
            // Bulk complete does not create next occurrences of repeating tasks (see notes): undo by reopen must return the exact previous state.
            switch (action)
            {
                case "complete":
                    foreach (var t in tasks.Where(t => t.DeletedAt == null && !t.Completed)) { t.Completed = true; t.CompletedAt = now; t.UpdatedAt = now; affected++; }
                    break;
                case "reopen":
                    foreach (var t in tasks.Where(t => t.DeletedAt == null && t.Completed)) { t.Completed = false; t.CompletedAt = null; t.UpdatedAt = now; affected++; }
                    break;
                case "delete":
                    foreach (var t in tasks.Where(t => t.DeletedAt == null)) { t.DeletedAt = now; affected++; }
                    break;
                case "restore":
                    foreach (var t in tasks.Where(t => t.DeletedAt != null)) { t.DeletedAt = null; t.UpdatedAt = now; affected++; }
                    break;
                case "move":
                    var target = body.TargetListId!.Value;
                    var pos = await NextPosition(db, target);
                    foreach (var t in tasks.Where(t => t.DeletedAt == null && t.ListId != target)) { t.ListId = target; t.Position = pos++; t.UpdatedAt = now; affected++; }
                    break;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new BulkResult(affected));
        });

        api.MapPost("/tasks/{id:int}/subtasks", async (int id, CreateSubtaskBody body, TasksDb db) =>
        {
            var t = await Find(db, id);
            if (t is null) return Results.NotFound();
            var e = new Errors();
            var title = Rules.Title(body.Title, "title", e);
            if (e.Any) return e.Result();
            var s = new Subtask { TaskId = id, Title = title!, Position = (t.Subtasks.Count == 0 ? 0 : t.Subtasks.Max(x => x.Position)) + 1 };
            db.Subtasks.Add(s);
            t.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Created($"/api/subtasks/{s.Id}", Map.Subtask(s));
        });

        api.MapPatch("/subtasks/{id:int}", async (int id, JsonElement body, TasksDb db) =>
        {
            var s = await db.Subtasks.FirstOrDefaultAsync(x => x.Id == id);
            if (s is null) return Results.NotFound();
            var task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == s.TaskId && t.DeletedAt == null);
            if (task is null) return Results.NotFound();
            var e = new Errors();
            if (body.ValueKind != JsonValueKind.Object) { e.Add("body", "The body must be a JSON object."); return e.Result(); }
            string? title = null;
            bool? done = null;
            int? position = null;
            if (Rules.Has(body, "title", out var v)) title = Rules.Title(Rules.AsString(v, "title", e, false), "title", e);
            if (Rules.Has(body, "done", out v)) done = Rules.AsBool(v, "done", e);
            if (Rules.Has(body, "position", out v))
            {
                position = Rules.AsInt(v, "position", e);
                if (position is < 1) e.Add("position", "The position field must be 1 or more.");
            }
            if (e.Any) return e.Result();
            if (title is not null) s.Title = title;
            if (done is not null) s.Done = done.Value;
            if (position is { } pos)
            {
                var all = await db.Subtasks.Where(x => x.TaskId == s.TaskId).OrderBy(x => x.Position).ThenBy(x => x.Id).ToListAsync();
                all.Remove(s);
                all.Insert(Math.Clamp(pos - 1, 0, all.Count), s);
                for (int i = 0; i < all.Count; i++) all[i].Position = i + 1;
            }
            task.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(Map.Subtask(s));
        });

        api.MapDelete("/subtasks/{id:int}", async (int id, TasksDb db) =>
        {
            var s = await db.Subtasks.FirstOrDefaultAsync(x => x.Id == id);
            if (s is null) return Results.NotFound();
            db.Subtasks.Remove(s);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
