# Tasks end-to-end suite

One Playwright suite for every client of the comparison (Blazor WebAssembly, Blazor Server,
React, Angular and the vanilla TypeScript reference). It knows nothing about the framework: it
uses only the `data-testid` names and routes from `SPEC.md` and visible text, and it reads every
expected value from the API.

## Run it in a client folder

The suite lives in `<client>/e2e/` (an identical copy per client). Next to it, write
`e2e/.env.client` (not committed; see `.env.client.example`):

```
CLIENT_URL=http://localhost:16031
API_URL=http://localhost:16030
CLIENT_START=npm run dev -- --port 16031 --strictPort
```

`CLIENT_START` is optional. When it is set, Playwright starts the dev server from the client
root (one folder up) and reuses one that is already running. The API must already be running.

```
cd e2e
npm install
npx playwright test --grep @step03            # one step
npx playwright test --grep "@step00|@step01"  # several
npx playwright test                           # everything
```

Browser: the installed Google Chrome (`channel: 'chrome'`); the suite never downloads
Playwright's own browsers. One worker, no retries, 60 s per test, 10 s per expectation,
viewport 1366x768. The JSON report goes to `results.json` (or `E2E_JSON`).

Every test starts with `POST /api/admin/reset`, so tests are independent and may run in any
order. Most tests create their own small list through the API (so the default view, sorting
and windowing of the seed lists do not get in the way) and use the seed only where the spec
names it: list ids 1 to 4, the Archive titles "Ticket 00001" and "Ticket 10000".

## What a client must do for the suite (all from SPEC.md)

- Rows: `task-row-{id}` inside `rows-container`; the on-screen order (by position on the page)
  is what order tests read, so windowed lists with absolutely positioned rows are fine.
- Selects: `sort-select`, `panel-priority`, `panel-repeat` and `bulk-move-target` are native
  `<select>` elements. The suite picks an option by value or by label, case-insensitive:
  sort values `manual|due|priority|title|created`, priority `0..3` (or the labels None, Low,
  Medium, High), repeat `none|daily|weekly|monthly`, bulk targets by list name.
- Inline editors (list rename, task title) take focus when they open; the suite types into the
  focused element, so the editor's own test id does not matter.
- Delete list "with a confirm": a native `confirm()` is accepted, and so is an in-page dialog
  (`role="dialog"` or `alertdialog`) with a button named Delete, Confirm, Yes or OK.
- `select-all` may be a checkbox or a button; a second click clears the selection.
- Filter buttons show their count as the last number in the button text.
- `task-count` reads "N of M open" (thousands separators allowed).

## Where the spec leaves a choice, the suite accepts each reading

- Today and Upcoming may or may not include completed tasks (All and Overdue are open only,
  Completed is completed only, as the spec says).
- Sort by created may be oldest or newest first.
- A drop on the upper part of a row may land before or after it.
- The first `j` may highlight the first or the second row; after that `j` moves down one and
  `k` up one.
- `list-count-{id}` may show the open count or the total.

## Files

- `playwright.config.ts`: the configuration described above.
- `fixtures.ts`: the `api` fixture, the automatic reset, and helpers (`revealRow` scrolls a
  windowed list until a row renders; `rowIdsInOrder`; `selectFlexible`; `confirmIfAsked`).
- `api.ts`: a typed client for the API contract and the local-date helper.
- `tests/stepNN-*.spec.ts`: one file per step, tagged `@stepNN`.
- `check-testids.mjs`: compares the test ids in SPEC.md's table with the ids the tests use
  (`node check-testids.mjs ../SPEC.md`).
