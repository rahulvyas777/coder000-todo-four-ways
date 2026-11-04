using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit.Abstractions;

namespace TasksApi.Tests;

/// <summary>One temporary database file per test class.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public string DbPath { get; } = Path.Combine(Path.GetTempPath(), "tasksapi-test-" + Guid.NewGuid().ToString("N") + ".db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("db", DbPath);
        builder.UseSetting("extra-origins", "http://localhost:16092");
        builder.UseEnvironment("Testing");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var f in new[] { DbPath, DbPath + "-journal" })
            try { if (File.Exists(f)) File.Delete(f); } catch (IOException) { }
    }
}

public abstract class ApiTestBase : IClassFixture<ApiFactory>
{
    protected readonly HttpClient Http;
    protected static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.Now);

    protected ApiTestBase(ApiFactory f)
    {
        Http = f.CreateClient();
        var r = Http.PostAsync("/api/admin/reset", null).GetAwaiter().GetResult();
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
    }

    protected async Task<JsonElement> Json(HttpResponseMessage r, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await r.Content.ReadAsStringAsync();
        Assert.True(r.StatusCode == expected, $"Expected {(int)expected}, got {(int)r.StatusCode}: {body}");
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    protected Task<JsonElement> Get(string url) => Http.GetAsync(url).ContinueWith(t => Json(t.Result)).Unwrap();
    protected async Task<JsonElement> Post(string url, object? body, HttpStatusCode expected = HttpStatusCode.OK) =>
        await Json(await Http.PostAsJsonAsync(url, body), expected);
    protected async Task<JsonElement> Patch(string url, object body, HttpStatusCode expected = HttpStatusCode.OK) =>
        await Json(await Http.PatchAsJsonAsync(url, body), expected);
    protected async Task<HttpResponseMessage> PatchRaw(string url, string json) =>
        await Http.PatchAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));

    protected static DateOnly? Due(JsonElement t) =>
        t.GetProperty("dueDate").ValueKind == JsonValueKind.Null ? null : DateOnly.ParseExact(t.GetProperty("dueDate").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    protected async Task<JsonElement> List(int id)
    {
        var lists = await Get("/api/lists");
        return lists.EnumerateArray().Single(l => l.GetProperty("id").GetInt32() == id);
    }

    protected static void AssertValidationProblem(JsonElement p, string field)
    {
        Assert.Equal(400, p.GetProperty("status").GetInt32());
        Assert.True(p.TryGetProperty("errors", out var errs), "problem details carry errors");
        Assert.True(errs.EnumerateObject().Any(e => e.Name.Equals(field, StringComparison.OrdinalIgnoreCase)), $"errors name {field}: {errs}");
    }
}

public class SeedTests(ApiFactory f) : ApiTestBase(f)
{
    [Fact]
    public async Task Lists_have_fixed_ids_names_and_counts()
    {
        var lists = (await Get("/api/lists")).EnumerateArray().ToArray();
        Assert.Equal(["Work", "Home", "Reading", "Archive 10k"], lists.Select(l => l.GetProperty("name").GetString()));
        Assert.Equal([1, 2, 3, 4], lists.Select(l => l.GetProperty("id").GetInt32()));
        Assert.Equal([1, 2, 3, 4], lists.Select(l => l.GetProperty("position").GetInt32()));
        Assert.Equal([40, 38, 36, 10000], lists.Select(l => l.GetProperty("taskCount").GetInt32()));
        Assert.Equal([40 - 13, 38 - 12, 36 - 12, 7000], lists.Select(l => l.GetProperty("openCount").GetInt32()));
        Assert.All(lists, l => Assert.Equal(JsonValueKind.Null, l.GetProperty("deletedAt").ValueKind));
        Assert.All(lists, l => Assert.EndsWith("Z", l.GetProperty("createdAt").GetString()));
    }

    [Fact]
    public async Task Task_ids_follow_creation_order()
    {
        Assert.Equal(Enumerable.Range(1, 40), (await Get("/api/lists/1/tasks")).EnumerateArray().Select(t => t.GetProperty("id").GetInt32()));
        Assert.Equal(Enumerable.Range(41, 38), (await Get("/api/lists/2/tasks")).EnumerateArray().Select(t => t.GetProperty("id").GetInt32()));
        Assert.Equal(Enumerable.Range(79, 36), (await Get("/api/lists/3/tasks")).EnumerateArray().Select(t => t.GetProperty("id").GetInt32()));
        var first = await Get("/api/tasks/115");
        Assert.StartsWith("Ticket 00001: ", first.GetProperty("title").GetString());
        Assert.False((await Get("/api/tasks/1")).GetProperty("completed").GetBoolean());
    }

    [Fact]
    public async Task Small_lists_have_the_promised_mix()
    {
        int withSubtasks = 0;
        foreach (var id in new[] { 1, 2, 3 })
        {
            var tasks = (await Get($"/api/lists/{id}/tasks")).EnumerateArray().ToArray();
            Assert.Equal(Enumerable.Range(1, tasks.Length), tasks.Select(t => t.GetProperty("position").GetInt32()));
            var dues = tasks.Select(Due).ToArray();
            Assert.True(dues.Count(d => d == Today) >= 3, "at least three due today");
            Assert.Contains(dues, d => d < Today);
            Assert.Contains(dues, d => d > Today && d <= Today.AddDays(7));
            Assert.Contains(dues, d => d > Today.AddDays(7));
            Assert.Contains(dues, d => d is null);
            Assert.True(tasks.Select(t => t.GetProperty("priority").GetInt32()).Distinct().Count() >= 3, "priorities spread");
            Assert.Contains(tasks, t => t.GetProperty("tags").GetArrayLength() > 0);
            var repeating = tasks.Where(t => t.GetProperty("repeat").GetString() != "none").ToArray();
            Assert.Equal(["daily", "weekly"], repeating.Select(t => t.GetProperty("repeat").GetString()).OrderBy(x => x));
            Assert.All(repeating, t => Assert.True(Due(t) <= Today && !t.GetProperty("completed").GetBoolean()));
            var completed = tasks.Where(t => t.GetProperty("completed").GetBoolean()).ToArray();
            Assert.Equal(tasks.Length / 3, completed.Length);
            Assert.All(completed, t => Assert.NotEqual(JsonValueKind.Null, t.GetProperty("completedAt").ValueKind));
            foreach (var t in tasks.Where(t => t.GetProperty("subtasks").GetArrayLength() > 0))
            {
                withSubtasks++;
                Assert.InRange(t.GetProperty("subtasks").GetArrayLength(), 2, 5);
            }
        }
        Assert.Equal(8, withSubtasks);
    }

    [Fact]
    public async Task Archive_has_ten_thousand_generated_tickets()
    {
        var tasks = (await Get("/api/lists/4/tasks")).EnumerateArray().ToArray();
        Assert.Equal(10000, tasks.Length);
        Assert.StartsWith("Ticket 10000: ", tasks[^1].GetProperty("title").GetString());
        Assert.Equal(10, tasks.Count(t => t.GetProperty("title").GetString()!.Contains("ticket 0999", StringComparison.OrdinalIgnoreCase)));
        Assert.Equal(3000, tasks.Count(t => t.GetProperty("completed").GetBoolean()));
        Assert.All(tasks, t =>
        {
            Assert.Equal(2, t.GetProperty("tags").GetArrayLength());
            Assert.Equal(0, t.GetProperty("subtasks").GetArrayLength());
            Assert.Equal("none", t.GetProperty("repeat").GetString());
            var d = Due(t)!.Value;
            Assert.InRange(d.DayNumber - Today.DayNumber, -365, 365);
        });
        Assert.Equal(12, tasks.SelectMany(t => t.GetProperty("tags").EnumerateArray().Select(x => x.GetString())).Distinct().Count());
    }

    [Fact]
    public async Task Json_is_camelCase_with_iso_dates()
    {
        var t = await Get("/api/tasks/1");
        foreach (var name in new[] { "id", "listId", "title", "notes", "dueDate", "priority", "tags", "completed", "completedAt", "position", "repeat", "deletedAt", "createdAt", "updatedAt", "subtasks" })
            Assert.True(t.TryGetProperty(name, out _), name);
        Assert.EndsWith("Z", t.GetProperty("createdAt").GetString());
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", (await Get("/api/tasks/115")).GetProperty("dueDate").GetString()!);
    }

    [Fact]
    public async Task Seed_content_is_identical_after_reset()
    {
        string Snapshot(JsonElement arr) => string.Join("\n", arr.EnumerateArray().Select(t =>
            $"{t.GetProperty("id")}|{t.GetProperty("title")}|{t.GetProperty("dueDate")}|{t.GetProperty("priority")}|{t.GetProperty("tags")}|{t.GetProperty("completed")}|{t.GetProperty("repeat")}|{t.GetProperty("subtasks").GetArrayLength()}"));
        var before = Snapshot(await Get("/api/lists/1/tasks")) + Snapshot(await Get("/api/lists/4/tasks"));
        await Post("/api/tasks", new { listId = 1, title = "Temporary" }, HttpStatusCode.Created);
        Assert.Equal(HttpStatusCode.NoContent, (await Http.PostAsync("/api/admin/reset?mode=recreate", null)).StatusCode);
        var after = Snapshot(await Get("/api/lists/1/tasks")) + Snapshot(await Get("/api/lists/4/tasks"));
        Assert.Equal(before, after);
    }
}

public class ListTests(ApiFactory f) : ApiTestBase(f)
{
    [Fact]
    public async Task Create_rename_and_move_a_list()
    {
        var created = await Post("/api/lists", new { name = "  Garden  " }, HttpStatusCode.Created);
        var id = created.GetProperty("id").GetInt32();
        Assert.Equal("Garden", created.GetProperty("name").GetString());
        Assert.Equal(5, created.GetProperty("position").GetInt32());
        Assert.Equal(0, created.GetProperty("taskCount").GetInt32());

        var renamed = await Patch($"/api/lists/{id}", new { name = "Garden jobs" });
        Assert.Equal("Garden jobs", renamed.GetProperty("name").GetString());

        await Patch($"/api/lists/{id}", new { position = 1 });
        var names = (await Get("/api/lists")).EnumerateArray().Select(l => l.GetProperty("name").GetString());
        Assert.Equal(["Garden jobs", "Work", "Home", "Reading", "Archive 10k"], names);
    }

    [Fact]
    public async Task List_validation_and_404()
    {
        AssertValidationProblem(await Post("/api/lists", new { name = "" }, HttpStatusCode.BadRequest), "name");
        AssertValidationProblem(await Post("/api/lists", new { name = new string('x', 81) }, HttpStatusCode.BadRequest), "name");
        AssertValidationProblem(await Patch("/api/lists/1", new { name = " " }, HttpStatusCode.BadRequest), "name");
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PatchAsJsonAsync("/api/lists/999", new { name = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync("/api/lists/999")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/lists/999/tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/lists/999/restore", null)).StatusCode);
        var nf = await Http.GetAsync("/api/lists/999/tasks");
        Assert.Equal("application/problem+json", nf.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Soft_delete_and_restore_a_list_with_exactly_its_tasks()
    {
        // Task 2 is deleted before the list; restoring the list must not bring it back.
        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync("/api/tasks/2")).StatusCode);
        await Task.Delay(20);
        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync("/api/lists/1")).StatusCode);
        Assert.DoesNotContain((await Get("/api/lists")).EnumerateArray(), l => l.GetProperty("id").GetInt32() == 1);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/lists/1/tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/tasks/1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync("/api/lists/1")).StatusCode);

        var restored = await Post("/api/lists/1/restore", null);
        Assert.Equal(JsonValueKind.Null, restored.GetProperty("deletedAt").ValueKind);
        Assert.Equal(39, restored.GetProperty("taskCount").GetInt32());
        var ids = (await Get("/api/lists/1/tasks")).EnumerateArray().Select(t => t.GetProperty("id").GetInt32()).ToArray();
        Assert.DoesNotContain(2, ids);
        Assert.Equal(39, ids.Length);
    }

    [Fact]
    public async Task Counts_follow_changes()
    {
        var before = await List(2);
        await Post("/api/tasks", new { listId = 2, title = "Buy stamps" }, HttpStatusCode.Created);
        var open = (await Get("/api/lists/2/tasks")).EnumerateArray().First(t => !t.GetProperty("completed").GetBoolean());
        await Post($"/api/tasks/{open.GetProperty("id").GetInt32()}/complete", null);
        var after = await List(2);
        Assert.Equal(before.GetProperty("taskCount").GetInt32() + 1, after.GetProperty("taskCount").GetInt32());
        // +1 new open task, -1 completed; a repeating task would add its next occurrence too.
        var expectedOpen = before.GetProperty("openCount").GetInt32() + (open.GetProperty("repeat").GetString() == "none" ? 0 : 1);
        Assert.Equal(expectedOpen, after.GetProperty("openCount").GetInt32());
    }
}

public class TaskTests(ApiFactory f) : ApiTestBase(f)
{
    [Fact]
    public async Task Create_appends_at_the_end_with_defaults()
    {
        var t = await Post("/api/tasks", new { listId = 1, title = "Call Aisha Khan", tags = new[] { "Call", "call", " Urgent " }, dueDate = "2026-12-24", priority = 3 }, HttpStatusCode.Created);
        Assert.Equal(41, t.GetProperty("position").GetInt32());
        Assert.Equal("", t.GetProperty("notes").GetString());
        Assert.Equal("none", t.GetProperty("repeat").GetString());
        Assert.Equal(["call", "urgent"], t.GetProperty("tags").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal("2026-12-24", t.GetProperty("dueDate").GetString());
        Assert.False(t.GetProperty("completed").GetBoolean());
        Assert.Equal(0, t.GetProperty("subtasks").GetArrayLength());
        var id = t.GetProperty("id").GetInt32();
        Assert.Equal("Call Aisha Khan", (await Get($"/api/tasks/{id}")).GetProperty("title").GetString());
        Assert.Equal(id, (await Get("/api/lists/1/tasks")).EnumerateArray().Last().GetProperty("id").GetInt32());
    }

    [Fact]
    public async Task Create_validation()
    {
        AssertValidationProblem(await Post("/api/tasks", new { listId = 1, title = "" }, HttpStatusCode.BadRequest), "title");
        AssertValidationProblem(await Post("/api/tasks", new { listId = 1, title = new string('a', 201) }, HttpStatusCode.BadRequest), "title");
        AssertValidationProblem(await Post("/api/tasks", new { title = "x" }, HttpStatusCode.BadRequest), "listId");
        AssertValidationProblem(await Post("/api/tasks", new { listId = 1, title = "x", dueDate = "24/12/2026" }, HttpStatusCode.BadRequest), "dueDate");
        AssertValidationProblem(await Post("/api/tasks", new { listId = 1, title = "x", priority = 4 }, HttpStatusCode.BadRequest), "priority");
        AssertValidationProblem(await Post("/api/tasks", new { listId = 1, title = "x", repeat = "yearly" }, HttpStatusCode.BadRequest), "repeat");
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsJsonAsync("/api/tasks", new { listId = 99, title = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/tasks/999999")).StatusCode);
    }

    [Fact]
    public async Task Patch_changes_only_the_given_fields()
    {
        var before = await Get("/api/tasks/3");
        var t = await Patch("/api/tasks/3", new { title = "Prepare the report", notes = "Two pages", priority = 1, tags = new[] { "email" }, repeat = "monthly" });
        Assert.Equal("Prepare the report", t.GetProperty("title").GetString());
        Assert.Equal("Two pages", t.GetProperty("notes").GetString());
        Assert.Equal(1, t.GetProperty("priority").GetInt32());
        Assert.Equal(["email"], t.GetProperty("tags").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal("monthly", t.GetProperty("repeat").GetString());
        Assert.Equal(before.GetProperty("dueDate").ToString(), t.GetProperty("dueDate").ToString());

        var cleared = await Json(await PatchRaw("/api/tasks/3", "{\"dueDate\":null}"));
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("dueDate").ValueKind);
        Assert.Equal("Prepare the report", cleared.GetProperty("title").GetString());
        var dated = await Patch("/api/tasks/3", new { dueDate = "2027-01-05" });
        Assert.Equal("2027-01-05", dated.GetProperty("dueDate").GetString());

        var moved = await Patch("/api/tasks/3", new { listId = 2 });
        Assert.Equal(2, moved.GetProperty("listId").GetInt32());
        Assert.Equal(39, moved.GetProperty("position").GetInt32());
        Assert.Equal(3, (await Get("/api/lists/2/tasks")).EnumerateArray().Last().GetProperty("id").GetInt32());

        AssertValidationProblem(await Json(await PatchRaw("/api/tasks/3", "{\"title\":\"\"}"), HttpStatusCode.BadRequest), "title");
        AssertValidationProblem(await Json(await PatchRaw("/api/tasks/3", "{\"priority\":\"high\"}"), HttpStatusCode.BadRequest), "priority");
        AssertValidationProblem(await Json(await PatchRaw("/api/tasks/3", "{\"dueDate\":\"tomorrow\"}"), HttpStatusCode.BadRequest), "dueDate");
        Assert.Equal(HttpStatusCode.NotFound, (await PatchRaw("/api/tasks/3", "{\"listId\":77}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await PatchRaw("/api/tasks/999999", "{\"title\":\"x\"}")).StatusCode);
    }

    [Fact]
    public async Task Complete_reopen_and_idempotence()
    {
        var plain = await Post("/api/tasks", new { listId = 1, title = "One-off" }, HttpStatusCode.Created);
        var id = plain.GetProperty("id").GetInt32();
        var r = await Post($"/api/tasks/{id}/complete", null);
        Assert.True(r.GetProperty("task").GetProperty("completed").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, r.GetProperty("task").GetProperty("completedAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, r.GetProperty("next").ValueKind);
        var again = await Post($"/api/tasks/{id}/complete", null);
        Assert.Equal(JsonValueKind.Null, again.GetProperty("next").ValueKind);
        var reopened = await Post($"/api/tasks/{id}/reopen", null);
        Assert.False(reopened.GetProperty("completed").GetBoolean());
        Assert.Equal(JsonValueKind.Null, reopened.GetProperty("completedAt").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/tasks/999999/complete", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/tasks/999999/reopen", null)).StatusCode);
    }

    [Theory]
    [InlineData("daily", "2026-01-31", "2026-02-01")]
    [InlineData("weekly", "2026-01-31", "2026-02-07")]
    [InlineData("monthly", "2026-01-31", "2026-02-28")]
    public async Task Completing_a_repeating_task_creates_the_next_occurrence(string repeat, string due, string expected)
    {
        var t = await Post("/api/tasks", new { listId = 3, title = "Water the ferns", notes = "Rain water", priority = 2, tags = new[] { "errand" }, repeat, dueDate = due }, HttpStatusCode.Created);
        var id = t.GetProperty("id").GetInt32();
        await Post($"/api/tasks/{id}/subtasks", new { title = "Fill the can" }, HttpStatusCode.Created);
        var s2 = await Post($"/api/tasks/{id}/subtasks", new { title = "Check the soil" }, HttpStatusCode.Created);
        await Patch($"/api/subtasks/{s2.GetProperty("id").GetInt32()}", new { done = true });

        var r = await Post($"/api/tasks/{id}/complete", null);
        var next = r.GetProperty("next");
        Assert.Equal(expected, next.GetProperty("dueDate").GetString());
        Assert.Equal("Water the ferns", next.GetProperty("title").GetString());
        Assert.Equal("Rain water", next.GetProperty("notes").GetString());
        Assert.Equal(2, next.GetProperty("priority").GetInt32());
        Assert.Equal(repeat, next.GetProperty("repeat").GetString());
        Assert.Equal(["errand"], next.GetProperty("tags").EnumerateArray().Select(x => x.GetString()));
        Assert.False(next.GetProperty("completed").GetBoolean());
        Assert.Equal(["Fill the can", "Check the soil"], next.GetProperty("subtasks").EnumerateArray().Select(s => s.GetProperty("title").GetString()));
        Assert.All(next.GetProperty("subtasks").EnumerateArray(), s => Assert.False(s.GetProperty("done").GetBoolean()));
        Assert.Equal(t.GetProperty("position").GetInt32() + 1, next.GetProperty("position").GetInt32());
        // Second complete: idempotent, no third occurrence.
        Assert.Equal(JsonValueKind.Null, (await Post($"/api/tasks/{id}/complete", null)).GetProperty("next").ValueKind);
        Assert.Equal(1, (await Get("/api/lists/3/tasks")).EnumerateArray().Count(x => x.GetProperty("dueDate").ToString() == expected && x.GetProperty("title").GetString() == "Water the ferns"));
    }

    [Fact]
    public async Task Undated_repeating_task_starts_from_today()
    {
        var t = await Post("/api/tasks", new { listId = 1, title = "Stand-up notes", repeat = "daily" }, HttpStatusCode.Created);
        var r = await Post($"/api/tasks/{t.GetProperty("id").GetInt32()}/complete", null);
        Assert.Equal(Today.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), r.GetProperty("next").GetProperty("dueDate").GetString());
    }

    [Fact]
    public async Task Soft_delete_and_restore_a_task()
    {
        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync("/api/tasks/5")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/tasks/5")).StatusCode);
        Assert.DoesNotContain((await Get("/api/lists/1/tasks")).EnumerateArray(), t => t.GetProperty("id").GetInt32() == 5);
        Assert.Equal(39, (await List(1)).GetProperty("taskCount").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync("/api/tasks/5")).StatusCode);
        var restored = await Post("/api/tasks/5/restore", null);
        Assert.Equal(JsonValueKind.Null, restored.GetProperty("deletedAt").ValueKind);
        Assert.Equal(5, restored.GetProperty("position").GetInt32());
        Assert.Equal(40, (await List(1)).GetProperty("taskCount").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/tasks/999999/restore", null)).StatusCode);
    }
}

public class ReorderAndBulkTests(ApiFactory f) : ApiTestBase(f)
{
    async Task<int[]> Order(int list) => (await Get($"/api/lists/{list}/tasks")).EnumerateArray().Select(t => t.GetProperty("id").GetInt32()).ToArray();

    [Fact]
    public async Task Reorder_sets_positions_and_keeps_the_rest_in_order()
    {
        var r = await Http.PostAsJsonAsync("/api/tasks/reorder", new { listId = 1, orderedIds = new[] { 3, 1, 2 } });
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        var order = await Order(1);
        Assert.Equal([3, 1, 2], order.Take(3));
        Assert.Equal(Enumerable.Range(4, 37), order.Skip(3));
        var positions = (await Get("/api/lists/1/tasks")).EnumerateArray().Select(t => t.GetProperty("position").GetInt32());
        Assert.Equal(Enumerable.Range(1, 40), positions);

        // A full reversal.
        var reversed = Enumerable.Range(1, 40).Reverse().ToArray();
        Assert.Equal(HttpStatusCode.NoContent, (await Http.PostAsJsonAsync("/api/tasks/reorder", new { listId = 1, orderedIds = reversed })).StatusCode);
        Assert.Equal(reversed, await Order(1));
    }

    [Fact]
    public async Task Reorder_validation()
    {
        AssertValidationProblem(await Post("/api/tasks/reorder", new { listId = 1, orderedIds = new[] { 1, 41 } }, HttpStatusCode.BadRequest), "orderedIds");
        AssertValidationProblem(await Post("/api/tasks/reorder", new { listId = 1, orderedIds = new[] { 1, 1 } }, HttpStatusCode.BadRequest), "orderedIds");
        AssertValidationProblem(await Post("/api/tasks/reorder", new { listId = 1 }, HttpStatusCode.BadRequest), "orderedIds");
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsJsonAsync("/api/tasks/reorder", new { listId = 99, orderedIds = new[] { 1 } })).StatusCode);
        Assert.Equal(Enumerable.Range(1, 40), await Order(1));
    }

    [Fact]
    public async Task Reorder_on_the_10k_list()
    {
        var sw = Stopwatch.StartNew();
        var r = await Http.PostAsJsonAsync("/api/tasks/reorder", new { listId = 4, orderedIds = new[] { 10114, 115 } });
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        var order = await Order(4);
        Assert.Equal([10114, 115, 116], order.Take(3));
        Assert.Equal(10113, order[^1]);
        Assert.True(sw.ElapsedMilliseconds < 5000, $"reorder took {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Bulk_complete_reopen_delete_restore()
    {
        var open = (await Get("/api/lists/1/tasks")).EnumerateArray().Where(t => !t.GetProperty("completed").GetBoolean())
            .Select(t => t.GetProperty("id").GetInt32()).Take(3).ToArray();
        var c = await Post("/api/tasks/bulk", new { ids = open.Append(999999).ToArray(), action = "complete" });
        Assert.Equal(3, c.GetProperty("affected").GetInt32());
        Assert.True((await Get($"/api/tasks/{open[1]}")).GetProperty("completed").GetBoolean());
        Assert.Equal(0, (await Post("/api/tasks/bulk", new { ids = open, action = "complete" })).GetProperty("affected").GetInt32());
        Assert.Equal(3, (await Post("/api/tasks/bulk", new { ids = open, action = "reopen" })).GetProperty("affected").GetInt32());
        Assert.False((await Get($"/api/tasks/{open[1]}")).GetProperty("completed").GetBoolean());
        Assert.Equal(2, (await Post("/api/tasks/bulk", new { ids = new[] { 1, 2 }, action = "delete" })).GetProperty("affected").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/tasks/1")).StatusCode);
        Assert.Equal(2, (await Post("/api/tasks/bulk", new { ids = new[] { 1, 2 }, action = "restore" })).GetProperty("affected").GetInt32());
        Assert.Equal(Enumerable.Range(1, 40), await Order(1));
    }

    [Fact]
    public async Task Bulk_move_appends_to_the_target_list()
    {
        var m = await Post("/api/tasks/bulk", new { ids = new[] { 4, 2 }, action = "move", targetListId = 3 });
        Assert.Equal(2, m.GetProperty("affected").GetInt32());
        var order = await Order(3);
        Assert.Equal([2, 4], order[^2..]);
        Assert.Equal(38, (await List(1)).GetProperty("taskCount").GetInt32());
        Assert.Equal(38, (await List(3)).GetProperty("taskCount").GetInt32());
        var positions = (await Get("/api/lists/3/tasks")).EnumerateArray().Select(t => t.GetProperty("position").GetInt32()).ToArray();
        Assert.Equal([37, 38], positions[^2..]);
    }

    [Fact]
    public async Task Bulk_validation()
    {
        AssertValidationProblem(await Post("/api/tasks/bulk", new { ids = new[] { 1 }, action = "archive" }, HttpStatusCode.BadRequest), "action");
        AssertValidationProblem(await Post("/api/tasks/bulk", new { ids = new[] { 1 }, action = "move" }, HttpStatusCode.BadRequest), "targetListId");
        AssertValidationProblem(await Post("/api/tasks/bulk", new { action = "delete" }, HttpStatusCode.BadRequest), "ids");
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsJsonAsync("/api/tasks/bulk", new { ids = new[] { 1 }, action = "move", targetListId = 99 })).StatusCode);
    }
}

public class SubtaskTests(ApiFactory f) : ApiTestBase(f)
{
    [Fact]
    public async Task Add_toggle_rename_move_and_delete()
    {
        var a = await Post("/api/tasks/1/subtasks", new { title = "Find the old invoice" }, HttpStatusCode.Created);
        var b = await Post("/api/tasks/1/subtasks", new { title = "Attach the receipt" }, HttpStatusCode.Created);
        var c = await Post("/api/tasks/1/subtasks", new { title = "Send it" }, HttpStatusCode.Created);
        Assert.Equal([1, 2, 3], new[] { a, b, c }.Select(s => s.GetProperty("position").GetInt32()));
        Assert.Equal(1, a.GetProperty("taskId").GetInt32());
        Assert.False(a.GetProperty("done").GetBoolean());

        var bid = b.GetProperty("id").GetInt32();
        var toggled = await Patch($"/api/subtasks/{bid}", new { done = true, title = "Attach both receipts" });
        Assert.True(toggled.GetProperty("done").GetBoolean());
        Assert.Equal("Attach both receipts", toggled.GetProperty("title").GetString());

        await Patch($"/api/subtasks/{c.GetProperty("id").GetInt32()}", new { position = 1 });
        var task = await Get("/api/tasks/1");
        Assert.Equal(["Send it", "Find the old invoice", "Attach both receipts"], task.GetProperty("subtasks").EnumerateArray().Select(s => s.GetProperty("title").GetString()));
        Assert.False(task.GetProperty("completed").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/subtasks/{bid}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync($"/api/subtasks/{bid}")).StatusCode);
        Assert.Equal(2, (await Get("/api/tasks/1")).GetProperty("subtasks").GetArrayLength());
    }

    [Fact]
    public async Task Subtask_validation_and_404()
    {
        AssertValidationProblem(await Post("/api/tasks/1/subtasks", new { title = "" }, HttpStatusCode.BadRequest), "title");
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsJsonAsync("/api/tasks/999999/subtasks", new { title = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await PatchRaw("/api/subtasks/999999", "{\"done\":true}")).StatusCode);
        AssertValidationProblem(await Json(await PatchRaw("/api/subtasks/1", "{\"done\":\"yes\"}"), HttpStatusCode.BadRequest), "done");
    }
}

public class ExportImportTests(ApiFactory f) : ApiTestBase(f)
{
    [Fact]
    public async Task Json_export_is_an_attachment_and_round_trips_through_import()
    {
        var r = await Http.GetAsync("/api/lists/1/export?format=json");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("attachment; filename=\"Work.json\"", r.Content.Headers.ContentDisposition?.ToString() ?? string.Join("", r.Headers.GetValues("Content-Disposition")));
        Assert.Equal("application/json", r.Content.Headers.ContentType?.MediaType);
        var text = await r.Content.ReadAsStringAsync();
        var export = JsonDocument.Parse(text).RootElement;
        Assert.Equal("Work", export.GetProperty("name").GetString());
        Assert.Equal(40, export.GetProperty("tasks").GetArrayLength());
        var first = export.GetProperty("tasks")[0];
        foreach (var name in new[] { "title", "notes", "dueDate", "priority", "tags", "completed", "repeat", "subtasks" })
            Assert.True(first.TryGetProperty(name, out _), name);

        // Import the export under a new name and compare task by task.
        var imported = await Json(await Http.PostAsync("/api/lists/import",
            new StringContent(text.Replace("\"name\": \"Work\"", "\"name\": \"Work copy\""), Encoding.UTF8, "application/json")), HttpStatusCode.Created);
        Assert.Equal("Work copy", imported.GetProperty("name").GetString());
        Assert.Equal(5, imported.GetProperty("position").GetInt32());
        Assert.Equal(40, imported.GetProperty("taskCount").GetInt32());
        var newId = imported.GetProperty("id").GetInt32();
        var again = JsonDocument.Parse(await Http.GetStringAsync($"/api/lists/{newId}/export?format=json")).RootElement;
        Assert.Equal(export.GetProperty("tasks").ToString(), again.GetProperty("tasks").ToString());
        Assert.Equal(newId, (await Get("/api/lists")).EnumerateArray().Last().GetProperty("id").GetInt32());
    }

    [Fact]
    public async Task Csv_export_is_rfc4180_utf8_without_bom()
    {
        await Post("/api/tasks", new { listId = 4 + 0 - 2, title = "Fix \"the\" gate, then paint", notes = "Line one\nLine two", tags = new[] { "repair", "errand" } }, HttpStatusCode.Created);
        var r = await Http.GetAsync("/api/lists/2/export?format=csv");
        Assert.Equal("attachment; filename=\"Home.csv\"", string.Join("", r.Content.Headers.GetValues("Content-Disposition")));
        Assert.Equal("text/csv", r.Content.Headers.ContentType?.MediaType);
        var bytes = await r.Content.ReadAsByteArrayAsync();
        Assert.False(bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF, "no BOM");
        var csv = Encoding.UTF8.GetString(bytes);
        Assert.StartsWith("title,notes,dueDate,priority,tags,completed,repeat\r\n", csv);
        Assert.EndsWith("\r\n", csv);
        Assert.Contains("\"Fix \"\"the\"\" gate, then paint\",\"Line one\nLine two\",,0,repair;errand,false,none\r\n", csv);
        Assert.Equal(1 + 38 + 1, csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);
    }

    [Fact]
    public async Task Export_file_name_keeps_letters_digits_dash_underscore()
    {
        var r = await Http.GetAsync("/api/lists/4/export?format=csv");
        Assert.Equal("attachment; filename=\"Archive10k.csv\"", string.Join("", r.Content.Headers.GetValues("Content-Disposition")));
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.GetAsync("/api/lists/1/export?format=xml")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/lists/99/export?format=json")).StatusCode);
        var def = await Http.GetAsync("/api/lists/1/export");
        Assert.Equal("application/json", def.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Import_validation()
    {
        AssertValidationProblem(await Post("/api/lists/import", new { name = "", tasks = Array.Empty<object>() }, HttpStatusCode.BadRequest), "name");
        AssertValidationProblem(await Post("/api/lists/import", new { name = "Bad", tasks = new[] { new { title = "" } } }, HttpStatusCode.BadRequest), "tasks[0].title");
        var ok = await Post("/api/lists/import", new
        {
            name = "Trip",
            tasks = new object[]
            {
                new { title = "Pack the bags", completed = true, tags = new[] { "Errand" }, subtasks = new[] { new { title = "Socks", done = true } } },
                new { title = "Book the train", dueDate = "2026-12-01", priority = 2 },
            },
        }, HttpStatusCode.Created);
        Assert.Equal(2, ok.GetProperty("taskCount").GetInt32());
        Assert.Equal(1, ok.GetProperty("openCount").GetInt32());
        var tasks = (await Get($"/api/lists/{ok.GetProperty("id").GetInt32()}/tasks")).EnumerateArray().ToArray();
        Assert.Equal(["Pack the bags", "Book the train"], tasks.Select(t => t.GetProperty("title").GetString()));
        Assert.Equal(["errand"], tasks[0].GetProperty("tags").EnumerateArray().Select(x => x.GetString()));
        Assert.True(tasks[0].GetProperty("subtasks")[0].GetProperty("done").GetBoolean());
    }
}

// Timing tests run alone: with the other classes in parallel the machine is busy and the numbers say nothing.
[CollectionDefinition("timing", DisableParallelization = true)]
public class TimingCollection;

[Collection("timing")]
public class ResetAndTimingTests(ApiFactory f, ITestOutputHelper output) : ApiTestBase(f)
{
    [Fact]
    public async Task Reset_restores_the_seed_after_changes()
    {
        await Http.DeleteAsync("/api/lists/2");
        await Post("/api/lists", new { name = "Extra" }, HttpStatusCode.Created);
        await Post("/api/tasks/bulk", new { ids = Enumerable.Range(115, 500).ToArray(), action = "complete" });
        Assert.Equal(HttpStatusCode.NoContent, (await Http.PostAsync("/api/admin/reset", null)).StatusCode);
        var lists = (await Get("/api/lists")).EnumerateArray().ToArray();
        Assert.Equal(4, lists.Length);
        Assert.Equal(7000, lists[3].GetProperty("openCount").GetInt32());
        // Ids start again where the seed ends.
        var t = await Post("/api/tasks", new { listId = 1, title = "After reset" }, HttpStatusCode.Created);
        Assert.Equal(10115, t.GetProperty("id").GetInt32());
        var l = await Post("/api/lists", new { name = "After reset" }, HttpStatusCode.Created);
        Assert.Equal(5, l.GetProperty("id").GetInt32());
    }

    [Theory]
    [InlineData("inplace")]
    [InlineData("recreate")]
    public async Task Reset_is_under_two_seconds(string mode)
    {
        var times = new List<long>();
        for (int i = 0; i < 3; i++)
        {
            var sw = Stopwatch.StartNew();
            var r = await Http.PostAsync($"/api/admin/reset?mode={mode}", null);
            sw.Stop();
            Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
            times.Add(sw.ElapsedMilliseconds);
        }
        output.WriteLine($"reset {mode}: {string.Join(", ", times)} ms (wall, in-process)");
        var median = times.OrderBy(x => x).ElementAt(1);
        Assert.True(median < 2000, $"median {median} ms of {string.Join(", ", times)}");
    }

    [Fact]
    public async Task Ten_thousand_tasks_under_half_a_second_warm()
    {
        await Http.GetStringAsync("/api/lists/4/tasks");
        var sw = Stopwatch.StartNew();
        var body = await Http.GetByteArrayAsync("/api/lists/4/tasks");
        sw.Stop();
        output.WriteLine($"GET /api/lists/4/tasks warm: {sw.ElapsedMilliseconds} ms, {body.Length} bytes (in-process)");
        Assert.True(sw.ElapsedMilliseconds < 500, $"{sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Cors_allows_client_origins_and_exposes_content_disposition()
    {
        var pre = new HttpRequestMessage(HttpMethod.Options, "/api/tasks/1");
        pre.Headers.Add("Origin", "http://localhost:16031");
        pre.Headers.Add("Access-Control-Request-Method", "PATCH");
        pre.Headers.Add("Access-Control-Request-Headers", "content-type");
        var r = await Http.SendAsync(pre);
        Assert.Equal("http://localhost:16031", string.Join("", r.Headers.GetValues("Access-Control-Allow-Origin")));

        var get = new HttpRequestMessage(HttpMethod.Get, "/api/lists/1/export?format=csv");
        get.Headers.Add("Origin", "http://127.0.0.1:16052");
        var g = await Http.SendAsync(get);
        Assert.Equal("http://127.0.0.1:16052", string.Join("", g.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Contains("Content-Disposition", string.Join(",", g.Headers.GetValues("Access-Control-Expose-Headers")), StringComparison.OrdinalIgnoreCase);

        var extra = new HttpRequestMessage(HttpMethod.Get, "/api/lists");
        extra.Headers.Add("Origin", "http://localhost:16092");
        Assert.Equal("http://localhost:16092", string.Join("", (await Http.SendAsync(extra)).Headers.GetValues("Access-Control-Allow-Origin")));

        var bad = new HttpRequestMessage(HttpMethod.Get, "/api/lists");
        bad.Headers.Add("Origin", "http://localhost:3000");
        Assert.False((await Http.SendAsync(bad)).Headers.Contains("Access-Control-Allow-Origin"));
    }
}
