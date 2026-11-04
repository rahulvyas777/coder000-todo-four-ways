# Angular client — the Tasks app for the four-clients comparison

Stack: Angular 22 with TypeScript (strict), standalone components, project folder
`AngularClient/` (created with `ng new` from `@angular/cli@22`, CSS styles, no SSR), package
manager npm, the template's linter kept. No UI component library (Angular CDK is allowed if a
step needs it; list it).
Dev server: `npx ng serve --port 16041` in `AngularClient/`. Do NOT start it yourself: the
test command below starts it for every run and stops it afterwards. To check compile errors
run `npx ng build` in `AngularClient/` without serving.
API: http://localhost:16040, already running. Never start, stop or change it.
Tests: `cd e2e; npx playwright test --grep @stepNN`   (NN = the step you are on, two digits)

Rules
- Implement only what SPEC.md asks for the current step. Earlier steps must stay green.
- Use the data-testid names, routes and class names from SPEC.md exactly.
- shared/app.css and shared/icons.svg are copied into the app unchanged (public/); add your
  own styles in a separate file only when a step needs them.
- Never edit anything under e2e/ or shared/. If a test looks wrong, say so in your summary
  and stop; do not work around it.
- Add a dependency only when the step needs it, and list every one in your summary.
- Do not commit. Do not touch files outside this folder.
- Finish with a short summary: files changed, dependencies added, anything you could not do.
