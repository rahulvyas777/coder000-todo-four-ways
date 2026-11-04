using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TasksApi.Data;

namespace TasksApi.Endpoints;

public static class ListEndpoints
{
    public static async Task<ListDto?> WithCounts(TasksDb db, int id, bool includeDeleted = false)
    {
        var row = await db.Lists.AsNoTracking()
            .Where(l => l.Id == id && (includeDeleted || l.DeletedAt == null))
            .Select(l => new
            {
                List = l,
                TaskCount = l.Tasks.Count(t => t.DeletedAt == null),
                OpenCount = l.Tasks.Count(t => t.DeletedAt == null && !t.Completed),
            })
            .FirstOrDefaultAsync();
        return row is null ? null : Map.List(row.List, row.TaskCount, row.OpenCount);
    }

    public static void MapListEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/lists", async (TasksDb db) =>
        {
            var rows = await db.Lists.AsNoTracking()
                .Where(l => l.DeletedAt == null)
                .OrderBy(l => l.Position).ThenBy(l => l.Id)
                .Select(l => new
                {
                    List = l,
                    TaskCount = l.Tasks.Count(t => t.DeletedAt == null),
                    OpenCount = l.Tasks.Count(t => t.DeletedAt == null && !t.Completed),
                })
                .ToListAsync();
            return Results.Ok(rows.Select(r => Map.List(r.List, r.TaskCount, r.OpenCount)));
        });

        api.MapPost("/lists", async (CreateListBody body, TasksDb db) =>
        {
            var e = new Errors();
            var name = Rules.Title(body.Name, "name", e, 80);
            if (e.Any) return e.Result();
            var max = await db.Lists.MaxAsync(l => (int?)l.Position) ?? 0;
            var list = new TaskList { Name = name!, Position = max + 1, CreatedAt = DateTime.UtcNow };
            db.Lists.Add(list);
            await db.SaveChangesAsync();
            return Results.Created($"/api/lists/{list.Id}", Map.List(list, 0, 0));
        });

        api.MapPatch("/lists/{id:int}", async (int id, JsonElement body, TasksDb db) =>
        {
            var list = await db.Lists.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
            if (list is null) return Results.NotFound();
            var e = new Errors();
            if (body.ValueKind != JsonValueKind.Object) { e.Add("body", "The body must be a JSON object."); return e.Result(); }
            string? name = null;
            int? position = null;
            if (Rules.Has(body, "name", out var n)) name = Rules.Title(Rules.AsString(n, "name", e, false), "name", e, 80);
            if (Rules.Has(body, "position", out var p))
            {
                position = Rules.AsInt(p, "position", e);
                if (position is < 1) e.Add("position", "The position field must be 1 or more.");
            }
            if (e.Any) return e.Result();
            if (name is not null) list.Name = name;
            if (position is { } pos)
            {
                // Move semantics: the list takes the given 1-based place among the lists not deleted.
                var all = await db.Lists.Where(l => l.DeletedAt == null).OrderBy(l => l.Position).ThenBy(l => l.Id).ToListAsync();
                all.Remove(list);
                all.Insert(Math.Clamp(pos - 1, 0, all.Count), list);
                for (int i = 0; i < all.Count; i++) all[i].Position = i + 1;
            }
            await db.SaveChangesAsync();
            return Results.Ok(await WithCounts(db, id));
        });

        api.MapDelete("/lists/{id:int}", async (int id, TasksDb db) =>
        {
            var list = await db.Lists.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
            if (list is null) return Results.NotFound();
            var now = DateTime.UtcNow;
            list.DeletedAt = now;
            // The list's tasks get the same timestamp, so restoring the list restores exactly these.
            await db.Tasks.Where(t => t.ListId == id && t.DeletedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.DeletedAt, now));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/lists/{id:int}/restore", async (int id, TasksDb db) =>
        {
            var list = await db.Lists.FirstOrDefaultAsync(l => l.Id == id);
            if (list is null) return Results.NotFound();
            if (list.DeletedAt is { } stamp)
            {
                await db.Tasks.Where(t => t.ListId == id && t.DeletedAt == stamp)
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.DeletedAt, (DateTime?)null));
                list.DeletedAt = null;
                await db.SaveChangesAsync();
            }
            return Results.Ok(await WithCounts(db, id));
        });

        api.MapGet("/lists/{id:int}/tasks", async (int id, TasksDb db) =>
        {
            if (!await db.Lists.AnyAsync(l => l.Id == id && l.DeletedAt == null)) return Results.NotFound();
            var tasks = await db.Tasks.AsNoTracking()
                .Where(t => t.ListId == id && t.DeletedAt == null)
                .Include(t => t.Subtasks)
                .OrderBy(t => t.Position).ThenBy(t => t.Id)
                .AsSplitQuery()
                .ToListAsync();
            return Results.Ok(tasks.Select(Map.Task));
        });

        api.MapGet("/lists/{id:int}/export", async (int id, string? format, TasksDb db, HttpContext ctx) =>
        {
            var list = await db.Lists.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
            if (list is null) return Results.NotFound();
            format = (format ?? "json").ToLowerInvariant();
            if (format is not ("json" or "csv"))
            {
                var e = new Errors();
                e.Add("format", "The format must be json or csv.");
                return e.Result();
            }
            var tasks = await db.Tasks.AsNoTracking()
                .Where(t => t.ListId == id && t.DeletedAt == null)
                .Include(t => t.Subtasks)
                .OrderBy(t => t.Position).ThenBy(t => t.Id)
                .AsSplitQuery()
                .ToListAsync();
            var file = Rules.FileName(list.Name);
            var utf8 = new UTF8Encoding(false);
            if (format == "json")
            {
                var export = new ExportFile(list.Name, tasks.Select(t => new ExportTask(
                    t.Title, t.Notes, t.DueDate, t.Priority, t.Tags.ToArray(), t.Completed, t.Repeat,
                    t.Subtasks.OrderBy(s => s.Position).ThenBy(s => s.Id).Select(s => new ExportSubtask(s.Title, s.Done)).ToArray())).ToArray());
                var bytes = JsonSerializer.SerializeToUtf8Bytes(export, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });
                ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"{file}.json\"";
                return Results.Bytes(bytes, "application/json; charset=utf-8");
            }
            var sb = new StringBuilder();
            sb.Append("title,notes,dueDate,priority,tags,completed,repeat\r\n");
            foreach (var t in tasks)
            {
                sb.Append(Csv(t.Title)).Append(',')
                  .Append(Csv(t.Notes)).Append(',')
                  .Append(t.DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "").Append(',')
                  .Append(t.Priority.ToString(CultureInfo.InvariantCulture)).Append(',')
                  .Append(Csv(string.Join(';', t.Tags))).Append(',')
                  .Append(t.Completed ? "true" : "false").Append(',')
                  .Append(t.Repeat).Append("\r\n");
            }
            ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"{file}.csv\"";
            return Results.Bytes(utf8.GetBytes(sb.ToString()), "text/csv; charset=utf-8");
        });

        api.MapPost("/lists/import", async (ImportBody body, TasksDb db) =>
        {
            var e = new Errors();
            var name = Rules.Title(body.Name, "name", e, 80);
            var items = body.Tasks ?? [];
            var tasks = new List<TaskItem>();
            var now = DateTime.UtcNow;
            for (int i = 0; i < items.Length; i++)
            {
                var it = items[i];
                var k = $"tasks[{i}]";
                if (it is null) { e.Add(k, "A task must be an object."); continue; }
                var title = Rules.Title(it.Title, k + ".title", e);
                Rules.Due(it.DueDate, k + ".dueDate", e, out var due);
                Rules.Priority(it.Priority, k + ".priority", e);
                Rules.Repeat(it.Repeat, k + ".repeat", e);
                var tags = Rules.Tags(it.Tags, k + ".tags", e);
                var subs = new List<Subtask>();
                var subItems = it.Subtasks ?? [];
                for (int s = 0; s < subItems.Length; s++)
                {
                    var st = Rules.Title(subItems[s]?.Title, $"{k}.subtasks[{s}].title", e);
                    if (st is not null) subs.Add(new Subtask { Title = st, Done = subItems[s]!.Done ?? false, Position = s + 1 });
                }
                if (title is null) continue;
                bool completed = it.Completed ?? false;
                tasks.Add(new TaskItem
                {
                    Title = title, Notes = it.Notes ?? "", DueDate = due, Priority = it.Priority ?? 0, Tags = tags,
                    Completed = completed, CompletedAt = completed ? now : null, Position = tasks.Count + 1,
                    Repeat = it.Repeat ?? "none", CreatedAt = now, UpdatedAt = now, Subtasks = subs,
                });
            }
            if (e.Any) return e.Result();
            var max = await db.Lists.MaxAsync(l => (int?)l.Position) ?? 0;
            var list = new TaskList { Name = name!, Position = max + 1, CreatedAt = now, Tasks = tasks };
            db.Lists.Add(list);
            await db.SaveChangesAsync();
            return Results.Created($"/api/lists/{list.Id}", Map.List(list, tasks.Count, tasks.Count(t => !t.Completed)));
        });
    }

    // RFC 4180: quote when the field holds a comma, a quote, CR or LF; double inner quotes.
    static string Csv(string s) =>
        s.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
}
