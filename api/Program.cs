// TasksApi: the shared backend of the four-clients comparison. Run with
//   dotnet run --project api -- --urls http://localhost:16010 --db path/to/data.db
// (--db may also come from the TASKS_DB environment variable; default ./data.db).
using Microsoft.EntityFrameworkCore;
using TasksApi.Data;
using TasksApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

// One log line per request (method, path, query, status, duration) through the built-in console logger.
builder.Logging.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss.fff "; });
builder.Services.AddProblemDetails();
builder.Services.AddSingleton(sp => DbSettings.From(sp.GetRequiredService<IConfiguration>()));
builder.Services.AddDbContext<TasksDb>((sp, o) => o.UseSqlite(sp.GetRequiredService<DbSettings>().ConnectionString));
builder.Services.AddSingleton<SeedService>();

// JSON responses are compressed (Brotli, then gzip) like a production API would: the 10,000-task
// list is about 3.5 MB uncompressed, which at 10 Mbit/s would cost every client the same 2.8 s
// before any rendering starts. The static host compresses the clients' own files the same way.
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
    o.MimeTypes = Microsoft.AspNetCore.ResponseCompression.ResponseCompressionDefaults.MimeTypes
        .Concat(["application/problem+json", "text/csv"]);
});

// Every client's dev (160x1) and production (160x2) origin, x = 1..5, on localhost and 127.0.0.1.
var origins = new List<string>();
for (int x = 1; x <= 5; x++)
    foreach (var host in new[] { "localhost", "127.0.0.1" })
        foreach (var last in new[] { 1, 2 })
            origins.Add($"http://{host}:160{x}{last}");
// Optional extra origins for harness self-tests (comma-separated): --extra-origins or TASKS_EXTRA_ORIGINS.
var extra = builder.Configuration["extra-origins"] ?? builder.Configuration["TASKS_EXTRA_ORIGINS"];
if (!string.IsNullOrWhiteSpace(extra))
    origins.AddRange(extra.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
builder.Services.AddCors(o => o.AddPolicy("clients", p => p
    .WithOrigins(origins.ToArray())
    .AllowAnyHeader()
    .AllowAnyMethod()
    .WithExposedHeaders("Content-Disposition")));

var app = builder.Build();

app.UseResponseCompression();
app.Use(async (ctx, next) =>
{
    var sw = System.Diagnostics.Stopwatch.StartNew();
    await next();
    app.Logger.LogInformation("{Method} {Path}{Query} {Status} {Ms} ms", ctx.Request.Method, ctx.Request.Path, ctx.Request.QueryString,
        ctx.Response.StatusCode, sw.ElapsedMilliseconds);
});
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors("clients");

app.Services.GetRequiredService<SeedService>().EnsureDatabase();

var api = app.MapGroup("/api");
api.MapListEndpoints();
api.MapTaskEndpoints();
api.MapPost("/admin/reset", (string? mode, SeedService seed, HttpContext ctx) =>
{
    var ms = seed.Reset(mode == "recreate" ? "recreate" : "inplace");
    ctx.Response.Headers["X-Reset-Ms"] = ms.ToString(System.Globalization.CultureInfo.InvariantCulture);
    return Results.NoContent();
});

app.Run();

public partial class Program;
