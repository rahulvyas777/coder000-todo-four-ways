# Blazor WebAssembly client — the Tasks app for the four-clients comparison

Stack: Blazor WebAssembly standalone app on .NET 10 (net10.0), C# with nullable reference
types enabled, project folder `BlazorWasmClient/` (created with `dotnet new blazorwasm`).
No UI component library.
Dev server: `dotnet run --project BlazorWasmClient --urls http://localhost:16011`. Do NOT
start it yourself: the test command below starts it fresh for every run (so your edits are
always included) and stops it afterwards. To check compile errors run `dotnet build
BlazorWasmClient` without serving.
API: http://localhost:16010, already running. Never start, stop or change it.
Tests: `cd e2e; npx playwright test --grep @stepNN`   (NN = the step you are on, two digits)

Rules
- Implement only what SPEC.md asks for the current step. Earlier steps must stay green.
- Use the data-testid names, routes and class names from SPEC.md exactly.
- shared/app.css and shared/icons.svg are copied into the app unchanged (wwwroot/); add your
  own styles in a separate file only when a step needs them.
- Never edit anything under e2e/ or shared/. If a test looks wrong, say so in your summary
  and stop; do not work around it.
- Add a dependency only when the step needs it, and list every one in your summary.
- Do not commit. Do not touch files outside this folder.
- Finish with a short summary: files changed, dependencies added, anything you could not do.
