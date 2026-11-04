// StaticHost: the common production host for every static client build (Blazor WebAssembly, React,
// Angular, the reference client). Identical settings for all of them:
//   dotnet run --project hosting/StaticHost -- --root <build folder> --urls http://localhost:16012
// - static files with ETag and Last-Modified, no Cache-Control max-age
// - precompressed files chosen by content negotiation: <file>.br (Content-Encoding: br), else
//   <file>.gz (gzip), else the file itself; the ORIGINAL content type; Vary: Accept-Encoding.
//   Run harness/measure/precompress.js on the folder first. No dynamic compression.
// - SPA fallback: a path without a file extension that does not exist serves /index.html.
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);

var rootArg = builder.Configuration["root"];
if (string.IsNullOrWhiteSpace(rootArg) || !Directory.Exists(rootArg))
{
    Console.Error.WriteLine("Usage: StaticHost --root <folder> --urls http://localhost:<port>  (the folder must exist)");
    return 2;
}
var root = Path.GetFullPath(rootArg);
var files = new PhysicalFileProvider(root);
var types = new PrecompressedContentTypes();

var app = builder.Build();
app.Logger.LogInformation("Serving {Root}", root);

app.Use(async (ctx, next) =>
{
    if (HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
    {
        var path = ctx.Request.Path.Value ?? "/";
        if (path.EndsWith('/')) path += "index.html";
        var file = files.GetFileInfo(path);
        if ((!file.Exists || file.IsDirectory) && Path.GetExtension(path).Length == 0)
        {
            path = "/index.html"; // SPA fallback
            file = files.GetFileInfo(path);
        }
        if (file.Exists && !file.IsDirectory)
        {
            ctx.Response.Headers.Vary = "Accept-Encoding";
            string? encoding = null;
            if (Accepts(ctx, "br") && files.GetFileInfo(path + ".br").Exists) encoding = "br";
            else if (Accepts(ctx, "gzip") && files.GetFileInfo(path + ".gz").Exists) encoding = "gzip";
            ctx.Request.Path = encoding switch { "br" => path + ".br", "gzip" => path + ".gz", _ => path };
            if (encoding is not null) ctx.Items["encoding"] = encoding;
        }
    }
    await next();
});

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = files,
    ContentTypeProvider = types,
    ServeUnknownFileTypes = false,
    OnPrepareResponse = c =>
    {
        if (c.Context.Items["encoding"] is string enc) c.Context.Response.Headers.ContentEncoding = enc;
    },
});

app.Run();
return 0;

static bool Accepts(HttpContext ctx, string coding)
{
    var values = ctx.Request.GetTypedHeaders().AcceptEncoding;
    foreach (var v in values)
    {
        var name = v.Value.Value;
        if ((string.Equals(name, coding, StringComparison.OrdinalIgnoreCase) || name == "*") && (v.Quality ?? 1.0) > 0) return true;
    }
    return false;
}

/// <summary>Content types for the files the four clients ship; "x.js.br" gets the type of "x.js".</summary>
sealed class PrecompressedContentTypes : IContentTypeProvider
{
    readonly FileExtensionContentTypeProvider _inner = new();

    public PrecompressedContentTypes()
    {
        var m = _inner.Mappings;
        m[".wasm"] = "application/wasm";
        m[".dat"] = "application/octet-stream";
        m[".blat"] = "application/octet-stream";
        m[".pdb"] = "application/octet-stream";
        m[".json"] = "application/json";
        m[".webmanifest"] = "application/manifest+json";
        m[".js"] = "text/javascript";
        m[".mjs"] = "text/javascript";
        m[".css"] = "text/css";
        m[".svg"] = "image/svg+xml";
        m[".woff2"] = "font/woff2";
        m[".ico"] = "image/x-icon";
        m[".html"] = "text/html";
        m[".map"] = "application/json";
        m[".txt"] = "text/plain";
    }

    public bool TryGetContentType(string subpath, out string contentType)
    {
        if (subpath.EndsWith(".br", StringComparison.OrdinalIgnoreCase)) subpath = subpath[..^3];
        else if (subpath.EndsWith(".gz", StringComparison.OrdinalIgnoreCase)) subpath = subpath[..^3];
        return _inner.TryGetContentType(subpath, out contentType!);
    }
}
