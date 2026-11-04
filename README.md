# coder000 Tasks: one app, four clients

The same todo application ("Tasks") built four times from one specification by headless Claude
Code sessions: Blazor WebAssembly, Blazor Server, React 19 and Angular 22. One shared ASP.NET
Core API, one shared stylesheet, one frozen Playwright suite of 61 tests, and a hand-written
vanilla TypeScript reference client as the baseline. The write-up, with every measurement, is
the series "Blazor vs React vs Angular: One App, Four Clients" on
https://www.coder000.com/series/blazor-vs-react-vs-angular.

Nothing here was tidied up after the fact: the per-step commits in `clients/<name>` are what the
sessions produced, and `docs/sessions.csv` lists every session with its verdict, turns and meter.

## What is in the repository

| Folder | What |
|---|---|
| `SPEC.md` | the contract every client implements: API, routes, test ids, the 15 feature steps |
| `api/` | TasksApi, ASP.NET Core 10 minimal API, EF Core SQLite, deterministic seed, `POST /api/admin/reset`, xUnit tests |
| `shared/` | `app.css` and `icons.svg`, copied unchanged into every client |
| `harness/e2e/` | the Playwright suite (`@step00` to `@step14`), identical to the copy in every client folder |
| `harness/` | `run-step.ps1`, `run-client.ps1`, prompts, allowed tools, `parse-session.js`, the measurement scripts under `measure/` |
| `hosting/StaticHost` | the common production host: static files, precompressed Brotli and gzip by negotiation, SPA fallback |
| `reference/` | the vanilla TypeScript client (Vite), hand-written with the suite |
| `clients/blazor-wasm`, `clients/blazor-server`, `clients/react`, `clients/angular` | the four AI-built clients with their per-step commits |
| `docs/` | `sessions.csv` (every metered session) and `results.md` (the measurement tables) |

## Run the API and the reference client

Requirements: .NET SDK 10, Node 22 (the Angular client needs 22.22.3 or newer), Google Chrome
(the suite drives the installed Chrome, it never downloads Playwright's browsers). Ports 16000
to 16099 on localhost.

```
git clone https://github.com/rahulvyas777/coder000-todo-four-ways.git
cd coder000-todo-four-ways
dotnet run --project api -- --urls http://localhost:16050 --db run/reference.db
```

The API creates and seeds the database on first start (lists Work, Home, Reading and
"Archive 10k" with 10,000 tasks). In a second terminal:

```
cd reference
npm install
npm run dev -- --port 16051 --strictPort
```

Open http://localhost:16051. The dev server keeps running; the suite below reuses it.

## Run the suite

```
cd harness/e2e
npm install
copy .env.client.example .env.client
npx playwright test
```

`.env.client` for the reference client:

```
CLIENT_URL=http://localhost:16051
API_URL=http://localhost:16050
CLIENT_START=npm run dev -- --port 16051 --strictPort
```

One step at a time: `npx playwright test --grep @step14`. Every test starts with
`POST /api/admin/reset`, so the order does not matter.

## Run one of the AI-built clients

Each client folder is self-contained: the project, `e2e/` (the same suite), `shared/`,
`SPEC.md` and the `CLAUDE.md` its sessions read. The API port is 160x0, the dev server 160x1,
where x is 1 for blazor-wasm, 2 for blazor-server, 3 for react, 4 for angular. For React, from
the repository root:

```
dotnet run --project api -- --urls http://localhost:16030 --db run/react.db
cd clients/react
npm --prefix ReactClient install
cd e2e
npm install
copy .env.client.example .env.client
npx playwright test
```

with `.env.client` set to `CLIENT_URL=http://localhost:16031`, `API_URL=http://localhost:16030`
and `CLIENT_START=npm --prefix ReactClient run dev -- --port 16031 --strictPort`. The other
clients' dev commands are in `harness/clients.json`; Playwright starts the dev server from the
client root for every run and stops it afterwards. The API instance for each of the other
clients:

```
dotnet run --project api -- --urls http://localhost:16040 --db run/angular.db
dotnet run --project api -- --urls http://localhost:16010 --db run/blazor-wasm.db
dotnet run --project api -- --urls http://localhost:16020 --db run/blazor-server.db
```

## Run a step the way the sessions did

`harness/run-step.ps1` runs one headless Claude Code session for one step of one client, with
the prompt in `harness/prompts/step.txt`, the tool lists in `harness/allowed-tools.txt` and
`harness/disallowed-tools.txt`, a budget cap and a 30-minute wall clock, then runs the frozen
suite as an independent verdict and commits. It needs Claude Code 2.1.280 or newer signed in,
and `harness/run-claude.ps1` (the isolated runner from the coder000 Claude Code series):

```
powershell -NoProfile -ExecutionPolicy Bypass -File harness/run-step.ps1 -Client react -Step 14 -Run 1 -RunClaude harness/run-claude.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File harness/run-step.ps1 -Client angular -Step 14 -Run 1 -RunClaude harness/run-claude.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File harness/run-step.ps1 -Client blazor-wasm -Step 14 -Run 1 -RunClaude harness/run-claude.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File harness/run-step.ps1 -Client blazor-server -Step 14 -Run 1 -RunClaude harness/run-claude.ps1
```

The step's API instance must be running on the client's API port (160x0) and the client
folder must be a git repository checked out at the commit before the step (`git log --oneline`
shows one commit per step; `git checkout <hash of "step 13: Recurring tasks">`); the runner
commits the result on top.

Windows PowerShell 5.1. The session's cost is metered at list price in the transcript's
`total_cost_usd`; on a subscription plan it is a meter, not a bill.

## Results

`docs/results.md` holds every table from the series: payload, Lighthouse, interactions on the
10,000-item list, memory, developer metrics, accessibility and the AI metrics per client and
step. The raw measurement files and transcripts live with the series' evidence on coder000.com.

## License

MIT. The data is fictional (names such as Maria Garcia and David Chen, no real person or
company).
