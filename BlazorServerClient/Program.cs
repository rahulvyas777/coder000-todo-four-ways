using BlazorServerClient.Components;
using BlazorServerClient.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

var apiUrl = builder.Configuration["ApiUrl"] ?? "http://localhost:16020";
builder.Services.AddHttpClient<TasksApi>(c => c.BaseAddress = new Uri(apiUrl.TrimEnd('/') + "/"));

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);

app.UseAntiforgery();

app.MapStaticAssets();

// Export downloads go through this server (the browser never calls the API): the API's file and
// Content-Disposition are passed through unchanged.
app.MapGet("/export/lists/{id:int}", async (int id, string? format, TasksApi api, HttpContext ctx) =>
{
    using var res = await api.ExportListAsync(id, format == "csv" ? "csv" : "json");
    ctx.Response.StatusCode = (int)res.StatusCode;
    if (!res.IsSuccessStatusCode) return;
    ctx.Response.ContentType = res.Content.Headers.ContentType?.ToString();
    if (res.Content.Headers.ContentDisposition is { } disposition)
        ctx.Response.Headers.ContentDisposition = disposition.ToString();
    await res.Content.CopyToAsync(ctx.Response.Body);
});
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
