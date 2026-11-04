// Tasks, the reference client: plain TypeScript, no framework, no runtime dependencies.
// It implements every step of SPEC.md and is the "no framework" baseline row.
import { api, type Task, type TaskList, type Repeat } from './api.ts';
import { h, icon, isTyping } from './dom.ts';

type View = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed';
type Sort = 'manual' | 'due' | 'priority' | 'title' | 'created';

const VIEWS: { id: View; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'due', label: 'Due date' },
  { id: 'priority', label: 'Priority' },
  { id: 'title', label: 'Title' },
  { id: 'created', label: 'Created' },
];
const PRIORITIES = ['None', 'Low', 'Medium', 'High'];
const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'monthly'];
const ROW_H = 40; // fixed by the shared stylesheet
const BUFFER = 10; // rows rendered above and below the viewport
const TOAST_MS = 5000;

const state = {
  lists: [] as TaskList[],
  listId: 0,
  loadedListId: 0,
  tasks: [] as Task[],
  panelTaskId: 0,
  view: 'all' as View,
  q: '',
  sort: 'manual' as Sort,
  selected: new Set<number>(),
  highlightId: 0,
  editingTaskId: 0,
  renamingListId: 0,
  addingList: false,
  visible: [] as Task[], // filtered and sorted, recomputed by computeVisible()
};

// ---------------------------------------------------------------- dates

function localDate(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function inView(t: Task, view: View, today: string): boolean {
  switch (view) {
    case 'all':
      return !t.completed;
    case 'today':
      return !t.completed && t.dueDate === today;
    case 'upcoming':
      return !t.completed && t.dueDate !== null && t.dueDate > today;
    case 'overdue':
      return !t.completed && t.dueDate !== null && t.dueDate < today;
    case 'completed':
      return t.completed;
  }
}

function matchesSearch(t: Task, q: string): boolean {
  if (!q) return true;
  return t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.tags.some((g) => g.includes(q));
}

function compare(sort: Sort): (a: Task, b: Task) => number {
  const byPos = (a: Task, b: Task) => a.position - b.position || a.id - b.id;
  switch (sort) {
    case 'manual':
      return byPos;
    case 'due':
      return (a, b) => {
        if (a.dueDate === b.dueDate) return byPos(a, b);
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      };
    case 'priority':
      return (a, b) => b.priority - a.priority || byPos(a, b);
    case 'title':
      return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || byPos(a, b);
    case 'created':
      return (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id);
  }
}

function computeVisible(): void {
  const today = localDate();
  // Search runs on every keystroke with no debounce on purpose: the comparison measures rendering.
  const q = state.q.trim().toLowerCase();
  state.visible = state.tasks.filter((t) => inView(t, state.view, today) && matchesSearch(t, q)).sort(compare(state.sort));
}

// ---------------------------------------------------------------- routing

function parseRoute(): { listId: number; taskId: number } {
  const m = /^\/lists\/(\d+)(?:\/tasks\/(\d+))?\/?$/.exec(location.pathname);
  const p = new URLSearchParams(location.search);
  const view = p.get('view') as View | null;
  const sort = p.get('sort') as Sort | null;
  state.view = view && VIEWS.some((v) => v.id === view) ? view : 'all';
  state.sort = sort && SORTS.some((s) => s.id === sort) ? sort : 'manual';
  state.q = p.get('q') ?? '';
  return { listId: m ? Number(m[1]) : 0, taskId: m && m[2] ? Number(m[2]) : 0 };
}

function queryString(): string {
  const p = new URLSearchParams();
  if (state.view !== 'all') p.set('view', state.view);
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'manual') p.set('sort', state.sort);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function urlFor(listId: number, taskId = 0): string {
  return `/lists/${listId}${taskId ? `/tasks/${taskId}` : ''}${queryString()}`;
}

function navigate(url: string, replace = false): void {
  if (url !== location.pathname + location.search) {
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }
  void route();
}

/** Writes view, search and sort into the URL without a new history entry. */
function syncQuery(): void {
  history.replaceState(null, '', urlFor(state.listId, state.panelTaskId));
}

let routeToken = 0;
async function route(): Promise<void> {
  const token = ++routeToken;
  const r = parseRoute();
  if (state.lists.length === 0) await refreshLists();
  if (token !== routeToken) return;
  if (!r.listId || !state.lists.some((l) => l.id === r.listId)) {
    const first = state.lists[0];
    if (first) navigate(urlFor(first.id), true);
    else render();
    return;
  }
  if (r.listId !== state.loadedListId) {
    state.listId = r.listId;
    state.selected.clear();
    state.highlightId = 0;
    state.tasks = [];
    state.loadedListId = 0;
    render();
    const tasks = await api.tasks(r.listId);
    if (token !== routeToken) return;
    state.tasks = tasks;
    state.loadedListId = r.listId;
    els.rows.scrollTop = 0;
  }
  state.listId = r.listId;
  state.panelTaskId = r.taskId;
  render();
}

// ---------------------------------------------------------------- data helpers

async function refreshLists(): Promise<void> {
  state.lists = await api.lists();
}

async function reloadTasks(): Promise<void> {
  const id = state.listId;
  const tasks = await api.tasks(id);
  if (id === state.listId) state.tasks = tasks;
}

/** Re-reads the current list's tasks and the list counts, then renders. */
async function refresh(): Promise<void> {
  await Promise.all([reloadTasks(), refreshLists()]);
  render();
}

function upsert(t: Task): void {
  const i = state.tasks.findIndex((x) => x.id === t.id);
  if (t.listId !== state.listId || t.deletedAt) {
    if (i >= 0) state.tasks.splice(i, 1);
  } else if (i >= 0) state.tasks[i] = t;
  else state.tasks.push(t);
}

function taskById(id: number): Task | undefined {
  return state.tasks.find((t) => t.id === id);
}

function currentList(): TaskList | undefined {
  return state.lists.find((l) => l.id === state.listId);
}

function report(err: unknown): void {
  console.error(err);
  showToast(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
}

// ---------------------------------------------------------------- toast and undo

let toastTimer = 0;
function showToast(message: string, undo?: () => Promise<void>): void {
  window.clearTimeout(toastTimer);
  els.toastText.textContent = message;
  els.toastUndo.hidden = !undo;
  els.toastUndo.onclick = undo
    ? () => {
        hideToast();
        undo().then(refresh, report);
      }
    : null;
  els.toast.hidden = false;
  toastTimer = window.setTimeout(hideToast, TOAST_MS);
}

function hideToast(): void {
  window.clearTimeout(toastTimer);
  els.toast.hidden = true;
  els.toastUndo.onclick = null;
}

// ---------------------------------------------------------------- actions

async function addTask(title: string): Promise<void> {
  const t = await api.createTask(state.listId, title);
  upsert(t);
  await refreshLists();
  render();
}

async function toggleTask(id: number, done: boolean): Promise<void> {
  const t = taskById(id);
  if (!t) return;
  t.completed = done; // optimistic; replaced by the server's answer below
  render();
  if (done) {
    const { task, next } = await api.complete(id);
    upsert(task);
    if (next) {
      upsert(next);
      showToast(`Completed. Next: ${next.dueDate ?? 'no date'}`, async () => {
        await api.reopen(task.id);
        await api.deleteTask(next.id);
      });
    }
  } else {
    upsert(await api.reopen(id));
  }
  await refreshLists();
  render();
}

async function deleteTask(id: number): Promise<void> {
  const t = taskById(id);
  if (!t) return;
  await api.deleteTask(id);
  state.tasks = state.tasks.filter((x) => x.id !== id);
  state.selected.delete(id);
  if (state.panelTaskId === id) history.replaceState(null, '', urlFor(state.listId));
  state.panelTaskId = state.panelTaskId === id ? 0 : state.panelTaskId;
  showToast(`Deleted "${t.title}"`, async () => {
    await api.restoreTask(id);
  });
  await refreshLists();
  render();
}

async function patchTask(id: number, patch: Parameters<typeof api.patchTask>[1]): Promise<void> {
  upsert(await api.patchTask(id, patch));
  await refreshLists();
  render();
}

async function deleteList(id: number): Promise<void> {
  const l = state.lists.find((x) => x.id === id);
  if (!l) return;
  if (!window.confirm(`Delete the list "${l.name}" and its tasks?`)) return;
  await api.deleteList(id);
  await refreshLists();
  showToast(`Deleted list "${l.name}"`, async () => {
    await api.restoreList(id);
    await refreshLists();
    navigate(urlFor(id));
  });
  if (state.listId === id) {
    state.loadedListId = 0;
    const first = state.lists[0];
    navigate(first ? urlFor(first.id) : '/');
  } else render();
}

async function bulk(action: 'complete' | 'delete' | 'move'): Promise<void> {
  const ids = [...state.selected];
  if (ids.length === 0) return;
  if (action === 'move') {
    const target = Number(els.bulkTarget.value);
    if (!target) return;
    await api.bulk(ids, 'move', target);
  } else if (action === 'complete') {
    const wereOpen = ids.filter((id) => !taskById(id)?.completed);
    await api.bulk(ids, 'complete');
    showToast(`Completed ${ids.length}`, async () => {
      await api.bulk(wereOpen, 'reopen');
    });
  } else {
    await api.bulk(ids, 'delete');
    showToast(`Deleted ${ids.length}`, async () => {
      await api.bulk(ids, 'restore');
    });
  }
  state.selected.clear();
  await refresh();
}

async function reorder(dragId: number, targetId: number, after: boolean): Promise<void> {
  if (dragId === targetId) return;
  const order = state.tasks.slice().sort(compare('manual')).map((t) => t.id).filter((id) => id !== dragId);
  let at = order.indexOf(targetId);
  if (at < 0) return;
  if (after) at += 1;
  order.splice(at, 0, dragId);
  order.forEach((id, i) => {
    const t = taskById(id);
    if (t) t.position = i + 1;
  });
  render();
  await api.reorder(state.listId, order);
  await reloadTasks();
  render();
}

async function importFile(file: File): Promise<void> {
  const data = JSON.parse(await file.text()) as { name?: string; tasks?: unknown[] };
  const name = (data.name ?? '').trim() || file.name.replace(/\.json$/i, '');
  const list = await api.importList({ name, tasks: data.tasks ?? [] });
  await refreshLists();
  showToast(`Imported "${list.name}"`);
  navigate(urlFor(list.id));
}

async function exportList(format: 'json' | 'csv'): Promise<void> {
  const l = currentList();
  if (!l) return;
  const res = await fetch(api.exportUrl(l.id, format));
  if (!res.ok) throw new Error(`export: ${res.status}`);
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  const name = m ? m[1] : `${l.name}.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------------------------------------------------------------- theme

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  els.themeToggle.replaceChildren(icon(theme === 'dark' ? 'i-sun' : 'i-moon'));
  els.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}

function storedTheme(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem('tasks-theme');
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function initialTheme(): 'light' | 'dark' {
  return storedTheme() ?? (darkQuery.matches ? 'dark' : 'light');
}

// ---------------------------------------------------------------- the shell (built once)

const filterButtons = new Map<View, { btn: HTMLButtonElement; count: HTMLSpanElement }>();

function buildShell() {
  const appTitle = h('h1', { class: 'app-title', 'data-testid': 'app-title', text: 'Tasks' });
  const themeToggle = h('button', { type: 'button', class: 'btn-icon', 'data-testid': 'theme-toggle' });
  const helpButton = h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Keyboard shortcuts (?)', title: 'Keyboard shortcuts (?)' }, icon('i-keyboard'));
  const listNav = h('ul', { class: 'list-nav', 'data-testid': 'list-nav', 'aria-label': 'Lists' });
  const listAdd = h('button', { type: 'button', 'data-testid': 'list-add' }, icon('i-plus'), 'New list');
  const listNameInput = h('input', { type: 'text', 'data-testid': 'list-name-input', 'aria-label': 'New list name', placeholder: 'List name', maxlength: 80, hidden: true });
  const sidebar = h(
    'nav',
    { class: 'sidebar', 'aria-label': 'Lists' },
    h('div', { class: 'sidebar-head' }, appTitle, h('div', { class: 'sidebar-tools' }, helpButton, themeToggle)),
    listNav,
    h('div', { class: 'list-add-row' }, listAdd, listNameInput),
  );

  const listName = h('h2', { id: 'list-heading' });
  const taskCount = h('span', { class: 'task-count', 'data-testid': 'task-count', 'aria-live': 'polite' });
  const exportJson = h('button', { type: 'button', 'data-testid': 'export-json', 'aria-label': 'Export as JSON' }, icon('i-export'), 'JSON');
  const exportCsv = h('button', { type: 'button', 'data-testid': 'export-csv', 'aria-label': 'Export as CSV' }, icon('i-export'), 'CSV');
  const importInput = h('input', { type: 'file', accept: '.json,application/json', 'data-testid': 'import-input', class: 'visually-hidden', id: 'import-input' });
  const importLabel = h('label', { for: 'import-input', class: 'btn', style: 'margin:0;color:inherit;font-size:inherit' }, icon('i-import'), 'Import');
  const head = h('div', { class: 'main-head' }, listName, taskCount, h('div', { class: 'io-tools' }, exportJson, exportCsv, importLabel, importInput));

  const filterBar = h('div', { class: 'filter-bar', role: 'group', 'aria-label': 'Filter' });
  for (const v of VIEWS) {
    const count = h('span', { class: 'count' });
    const btn = h('button', { type: 'button', class: 'filter', 'data-testid': `filter-${v.id}`, 'aria-pressed': 'false' }, v.label + ' ', count);
    btn.addEventListener('click', () => {
      state.view = v.id;
      state.selected.clear();
      syncQuery();
      render();
    });
    filterButtons.set(v.id, { btn, count });
    filterBar.append(btn);
  }
  const search = h('input', { type: 'search', 'data-testid': 'search-input', 'aria-label': 'Search tasks', placeholder: 'Search (/)' });
  const sort = h('select', { 'data-testid': 'sort-select', 'aria-label': 'Sort' });
  for (const s of SORTS) sort.append(h('option', { value: s.id, text: s.label }));
  const toolbar = h('div', { class: 'toolbar' }, filterBar, h('div', { class: 'search' }, search), h('div', { class: 'sort' }, sort));

  const selectAll = h('input', { type: 'checkbox', 'data-testid': 'select-all', 'aria-label': 'Select all shown tasks' });
  const addInput = h('input', { type: 'text', 'data-testid': 'task-add-input', 'aria-label': 'New task title', placeholder: 'Add a task (n)', maxlength: 200 });
  const addRow = h('div', { class: 'task-add' }, selectAll, addInput);

  const bulkCount = h('span', { class: 'bulk-count', 'data-testid': 'bulk-count' });
  const bulkComplete = h('button', { type: 'button', 'data-testid': 'bulk-complete' }, icon('i-check'), 'Complete');
  const bulkDelete = h('button', { type: 'button', class: 'btn-danger', 'data-testid': 'bulk-delete' }, icon('i-trash'), 'Delete');
  const bulkTarget = h('select', { 'data-testid': 'bulk-move-target', 'aria-label': 'Move to list' });
  const bulkMove = h('button', { type: 'button', 'data-testid': 'bulk-move' }, 'Move');
  const bulkBar = h('div', { class: 'bulk-bar', 'data-testid': 'bulk-bar', role: 'toolbar', 'aria-label': 'Selected tasks', hidden: true }, bulkCount, bulkComplete, bulkDelete, bulkTarget, bulkMove);

  const spacer = h('div', { class: 'rows-spacer', role: 'list', 'aria-labelledby': 'list-heading' });
  const empty = h('div', { class: 'empty-state', text: 'Nothing here', hidden: true });
  const rows = h('div', { class: 'rows-container', 'data-testid': 'rows-container' }, spacer, empty);

  const main = h('main', { class: 'main' }, head, toolbar, addRow, bulkBar, rows);
  const panel = h('aside', { class: 'panel', 'data-testid': 'task-panel', 'aria-label': 'Task details', hidden: true });

  const toastText = h('span');
  const toastUndo = h('button', { type: 'button', 'data-testid': 'toast-undo' }, 'Undo');
  const toast = h('div', { class: 'toast', 'data-testid': 'toast', hidden: true }, toastText, toastUndo);
  const live = h('div', { role: 'status', 'aria-live': 'polite' }, toast);

  const help = h(
    'dialog',
    { class: 'shortcut-help', 'data-testid': 'shortcut-help', 'aria-labelledby': 'help-title' },
    h('h2', { id: 'help-title', text: 'Keyboard shortcuts' }),
    shortcutList(),
    h('p', {}, h('button', { type: 'button', 'data-close': '' }, 'Close')),
  );

  const app = h('div', { class: 'app' }, sidebar, main, panel);
  document.querySelector('#app')!.replaceWith(app);
  document.body.append(live, help);
  return {
    appTitle, themeToggle, helpButton, listNav, listAdd, listNameInput, listName, taskCount, exportJson, exportCsv,
    importInput, search, sort, selectAll, addInput, bulkBar, bulkCount, bulkComplete, bulkDelete, bulkTarget, bulkMove,
    rows, spacer, empty, panel, toast, toastText, toastUndo, help,
  };
}

function shortcutList(): HTMLDListElement {
  const items: [string, string][] = [
    ['n', 'New task'],
    ['/', 'Search'],
    ['j / k', 'Next / previous task'],
    ['x', 'Complete or reopen the highlighted task'],
    ['Delete', 'Delete the highlighted task'],
    ['Enter', 'Open the highlighted task'],
    ['Escape', 'Close the panel or clear the selection'],
    ['?', 'Show or hide this help'],
  ];
  const dl = h('dl');
  for (const [k, d] of items) dl.append(h('dt', {}, h('kbd', { text: k })), h('dd', { text: d }));
  return dl;
}

const els = buildShell();

// ---------------------------------------------------------------- rendering

function render(): void {
  computeVisible();
  renderSidebar();
  renderMain();
  renderRows();
  renderPanel();
}

function renderSidebar(): void {
  if (state.renamingListId) return; // keep the inline editor alive
  els.listNav.replaceChildren(
    ...state.lists.map((l) => {
      const link = h('a', { class: 'list-link', href: `/lists/${l.id}`, 'aria-current': l.id === state.listId ? 'page' : null }, l.name);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(urlFor(l.id));
      });
      link.addEventListener('dblclick', (e) => {
        e.preventDefault();
        startRename(l.id);
      });
      const count = h('span', { class: 'list-count', 'data-testid': `list-count-${l.id}`, 'aria-label': `${l.openCount} open`, text: String(l.openCount) });
      const rename = h('button', { type: 'button', class: 'btn-icon', 'data-testid': `list-rename-${l.id}`, 'aria-label': `Rename ${l.name}` }, icon('i-edit'));
      rename.addEventListener('click', () => startRename(l.id));
      const del = h('button', { type: 'button', class: 'btn-icon', 'data-testid': `list-delete-${l.id}`, 'aria-label': `Delete ${l.name}` }, icon('i-trash'));
      del.addEventListener('click', () => deleteList(l.id).catch(report));
      return h('li', { class: `list-item${l.id === state.listId ? ' active' : ''}`, 'data-testid': `list-item-${l.id}` }, link, count, h('span', { class: 'list-actions' }, rename, del));
    }),
  );
}

function startRename(id: number): void {
  const l = state.lists.find((x) => x.id === id);
  const li = els.listNav.querySelector<HTMLLIElement>(`[data-testid="list-item-${id}"]`);
  if (!l || !li) return;
  state.renamingListId = id;
  const input = h('input', { type: 'text', value: l.name, 'aria-label': `New name for ${l.name}`, maxlength: 80 });
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    state.renamingListId = 0;
    const name = input.value.trim();
    if (save && name && name !== l.name) {
      api.renameList(id, name).then(async () => {
        await refreshLists();
        render();
      }, report);
    } else render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  li.replaceChildren(input);
  input.focus();
  input.select();
}

function renderMain(): void {
  const list = currentList();
  els.listName.textContent = list?.name ?? '';
  document.title = list ? `${list.name} - Tasks` : 'Tasks';
  const loaded = state.loadedListId === state.listId && state.listId > 0;
  const open = state.tasks.filter((t) => !t.completed).length;
  els.taskCount.textContent = loaded ? `${open.toLocaleString('en-US')} of ${state.tasks.length.toLocaleString('en-US')} open` : 'Loading...';

  const today = localDate();
  for (const v of VIEWS) {
    const f = filterButtons.get(v.id)!;
    const n = loaded ? state.tasks.filter((t) => inView(t, v.id, today)).length : 0;
    f.count.textContent = n.toLocaleString('en-US');
    f.btn.classList.toggle('active', state.view === v.id);
    f.btn.setAttribute('aria-pressed', String(state.view === v.id));
  }
  if (document.activeElement !== els.search) els.search.value = state.q;
  els.sort.value = state.sort;

  const n = state.selected.size;
  els.bulkBar.hidden = n === 0;
  els.bulkCount.textContent = `${n.toLocaleString('en-US')} selected`;
  const others = state.lists.filter((l) => l.id !== state.listId);
  const keep = els.bulkTarget.value;
  els.bulkTarget.replaceChildren(...others.map((l) => h('option', { value: l.id, text: l.name })));
  if (others.some((l) => String(l.id) === keep)) els.bulkTarget.value = keep;
  const allSelected = state.visible.length > 0 && state.visible.every((t) => state.selected.has(t.id));
  els.selectAll.checked = allSelected;
  els.selectAll.indeterminate = !allSelected && n > 0;
  els.empty.hidden = !loaded || state.visible.length > 0;
}

// The windowed list: a tall spacer, rows absolutely positioned, only the rows in view (plus a
// buffer) in the DOM. Row elements are kept per task id so a double-click survives a re-render.
const rendered = new Map<number, HTMLDivElement>();

function renderRows(): void {
  const total = state.visible.length;
  els.spacer.style.height = `${total * ROW_H}px`;
  const top = els.rows.scrollTop;
  const height = els.rows.clientHeight || 600;
  const first = Math.max(0, Math.floor(top / ROW_H) - BUFFER);
  const last = Math.min(total, Math.ceil((top + height) / ROW_H) + BUFFER);
  const keep = new Set<number>();
  for (let i = first; i < last; i++) {
    const t = state.visible[i];
    keep.add(t.id);
    let row = rendered.get(t.id);
    if (!row) {
      row = createRow(t.id);
      rendered.set(t.id, row);
      els.spacer.append(row);
    }
    row.style.top = `${i * ROW_H}px`;
    row.setAttribute('aria-posinset', String(i + 1));
    row.setAttribute('aria-setsize', String(total));
    updateRow(row, t);
  }
  for (const [id, row] of rendered) {
    if (!keep.has(id)) {
      row.remove();
      rendered.delete(id);
    }
  }
}

function createRow(id: number): HTMLDivElement {
  const row = h('div', { class: 'task-row', role: 'listitem', 'data-testid': `task-row-${id}`, 'data-id': id });
  const select = h('input', { type: 'checkbox', class: 'select-check', 'data-testid': `select-check-${id}` });
  const handle = h('button', { type: 'button', class: 'drag-handle', draggable: 'true', 'data-testid': `drag-handle-${id}`, 'aria-label': 'Drag to reorder' }, icon('i-drag'));
  const check = h('input', { type: 'checkbox', class: 'task-check', 'data-testid': `task-check-${id}` });
  const title = h('span', { class: 'task-title', 'data-testid': `task-title-${id}` });
  const meta = h('span', { class: 'task-meta' });
  const del = h('button', { type: 'button', class: 'btn-icon task-delete', 'data-testid': `task-delete-${id}` }, icon('i-trash'));
  row.append(select, handle, check, title, meta, del);

  select.addEventListener('change', () => {
    if (select.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
  });
  check.addEventListener('change', () => toggleTask(id, check.checked).catch(report));
  del.addEventListener('click', () => deleteTask(id).catch(report));
  title.addEventListener('dblclick', () => startEditTitle(id));
  row.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, button, select, textarea, label')) return;
    state.highlightId = id;
    navigate(urlFor(state.listId, id));
  });
  handle.addEventListener('dragstart', (e) => {
    dragId = id;
    e.dataTransfer?.setData('text/plain', String(id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    dragId = 0;
    row.classList.remove('dragging');
    clearDropMarks();
  });
  return row;
}

function updateRow(row: HTMLDivElement, t: Task): void {
  const [select, handle, check, title, meta, del] = Array.from(row.children) as HTMLElement[];
  const today = localDate();
  row.classList.toggle('completed', t.completed);
  row.classList.toggle('overdue', !t.completed && t.dueDate !== null && t.dueDate < today);
  row.classList.toggle('selected', state.selected.has(t.id));
  row.classList.toggle('highlighted', state.highlightId === t.id);
  row.classList.toggle('open', state.panelTaskId === t.id);
  (select as HTMLInputElement).checked = state.selected.has(t.id);
  select.setAttribute('aria-label', `Select ${t.title}`);
  handle.hidden = state.sort !== 'manual';
  (check as HTMLInputElement).checked = t.completed;
  check.setAttribute('aria-label', `${t.completed ? 'Reopen' : 'Complete'} ${t.title}`);
  del.setAttribute('aria-label', `Delete ${t.title}`);
  if (state.editingTaskId !== t.id && title.textContent !== t.title) title.textContent = t.title;
  title.title = t.title;

  const parts: Node[] = [];
  if (t.subtasks.length > 0) {
    const done = t.subtasks.filter((s) => s.done).length;
    parts.push(h('span', { class: 'subtask-progress', 'data-testid': `subtask-progress-${t.id}`, 'aria-label': `${done} of ${t.subtasks.length} subtasks done`, text: `${done}/${t.subtasks.length}` }));
  }
  if (t.dueDate) parts.push(h('span', { class: 'task-due', 'data-testid': `task-due-${t.id}`, text: t.dueDate }));
  if (t.priority > 0) {
    parts.push(h('span', { class: `prio prio-${t.priority}`, 'data-testid': `task-priority-${t.id}`, role: 'img', 'aria-label': `${PRIORITIES[t.priority]} priority`, title: `${PRIORITIES[t.priority]} priority` }));
  }
  for (const g of t.tags) parts.push(h('span', { class: 'tag', 'data-testid': `task-tag-${t.id}-${g}`, text: g }));
  if (t.repeat !== 'none') {
    parts.push(h('span', { class: 'task-repeat', 'data-testid': `task-repeat-${t.id}`, title: `Repeats ${t.repeat}` }, icon('i-repeat', `Repeats ${t.repeat}`)));
  }
  const key = JSON.stringify([t.subtasks.map((s) => s.done), t.dueDate, t.priority, t.tags, t.repeat]);
  if (meta.dataset.key !== key) {
    meta.dataset.key = key;
    meta.replaceChildren(...parts);
  }
}

function startEditTitle(id: number): void {
  const t = taskById(id);
  const title = els.spacer.querySelector<HTMLElement>(`[data-testid="task-title-${id}"]`);
  if (!t || !title || state.editingTaskId === id) return;
  state.editingTaskId = id;
  const input = h('input', { type: 'text', value: t.title, 'aria-label': 'Task title', maxlength: 200 });
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    state.editingTaskId = 0;
    const value = input.value.trim();
    title.textContent = t.title;
    if (save && value && value !== t.title) {
      title.textContent = value;
      patchTask(id, { title: value }).catch(report);
    } else render();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  title.replaceChildren(input);
  input.focus();
  input.select();
}

// ---------------------------------------------------------------- drag and drop (HTML5)

let dragId = 0;
function clearDropMarks(): void {
  els.spacer.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}
function dropTarget(e: DragEvent): { row: HTMLElement; id: number; after: boolean } | null {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.task-row');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { row, id: Number(row.dataset.id), after: e.clientY > r.top + r.height / 2 };
}
els.rows.addEventListener('dragover', (e) => {
  if (!dragId || state.sort !== 'manual') return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const t = dropTarget(e);
  clearDropMarks();
  if (t && t.id !== dragId) t.row.classList.add(t.after ? 'drop-after' : 'drop-before');
});
els.rows.addEventListener('drop', (e) => {
  if (!dragId) return;
  e.preventDefault();
  const t = dropTarget(e);
  const from = dragId;
  dragId = 0;
  clearDropMarks();
  if (t) reorder(from, t.id, t.after).catch(report);
});

// ---------------------------------------------------------------- the detail panel

let panelFor = 0;
const panelEls = {} as {
  title: HTMLInputElement;
  notes: HTMLTextAreaElement;
  due: HTMLInputElement;
  priority: HTMLSelectElement;
  repeat: HTMLSelectElement;
  tagsBox: HTMLDivElement;
  tagsInput: HTMLInputElement;
  subtasks: HTMLUListElement;
};

function renderPanel(): void {
  const t = state.panelTaskId ? taskById(state.panelTaskId) : undefined;
  if (!t) {
    els.panel.hidden = true;
    panelFor = 0;
    if (state.panelTaskId && state.loadedListId === state.listId) {
      // Not in this list (or deleted): drop the task part of the route.
      state.panelTaskId = 0;
      history.replaceState(null, '', urlFor(state.listId));
    }
    return;
  }
  if (panelFor !== t.id) buildPanel(t);
  els.panel.hidden = false;
  const p = panelEls;
  const focused = document.activeElement;
  if (focused !== p.title) p.title.value = t.title;
  if (focused !== p.notes) p.notes.value = t.notes;
  if (focused !== p.due) p.due.value = t.dueDate ?? '';
  p.priority.value = String(t.priority);
  p.repeat.value = t.repeat;
  p.tagsBox.querySelectorAll('.tag').forEach((el) => el.remove());
  for (const g of t.tags) {
    const remove = h('button', { type: 'button', 'aria-label': `Remove tag ${g}` }, icon('i-close'));
    remove.addEventListener('click', () => patchTask(t.id, { tags: t.tags.filter((x) => x !== g) }).catch(report));
    p.tagsBox.insertBefore(h('span', { class: 'tag', 'data-testid': `panel-tag-${g}` }, g, remove), p.tagsInput);
  }
  p.subtasks.replaceChildren(
    ...t.subtasks
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((s) => {
        const check = h('input', { type: 'checkbox', 'data-testid': `subtask-check-${s.id}`, 'aria-label': `${s.done ? 'Undo' : 'Done'}: ${s.title}` });
        check.checked = s.done;
        check.addEventListener('change', async () => {
          try {
            await api.patchSubtask(s.id, { done: check.checked });
            upsert(await api.task(t.id));
            render();
          } catch (err) {
            report(err);
          }
        });
        const del = h('button', { type: 'button', class: 'btn-icon', 'data-testid': `subtask-delete-${s.id}`, 'aria-label': `Delete subtask ${s.title}` }, icon('i-trash'));
        del.addEventListener('click', async () => {
          try {
            await api.deleteSubtask(s.id);
            upsert(await api.task(t.id));
            render();
          } catch (err) {
            report(err);
          }
        });
        return h('li', { class: `subtask-row${s.done ? ' done' : ''}`, 'data-testid': `subtask-row-${s.id}` }, check, h('span', { class: 'subtask-title', text: s.title }), del);
      }),
  );
}

function buildPanel(t: Task): void {
  panelFor = t.id;
  const id = t.id;
  const title = h('input', { type: 'text', 'data-testid': 'panel-title', 'aria-label': 'Title', maxlength: 200 });
  const close = h('button', { type: 'button', class: 'btn-icon', 'data-testid': 'panel-close', 'aria-label': 'Close details' }, icon('i-close'));
  const notes = h('textarea', { id: 'panel-notes', 'data-testid': 'panel-notes' });
  const due = h('input', { type: 'date', id: 'panel-due', 'data-testid': 'panel-due' });
  const priority = h('select', { id: 'panel-priority', 'data-testid': 'panel-priority' });
  PRIORITIES.forEach((label, i) => priority.append(h('option', { value: i, text: label })));
  const repeat = h('select', { id: 'panel-repeat', 'data-testid': 'panel-repeat' });
  for (const r of REPEATS) repeat.append(h('option', { value: r, text: r === 'none' ? 'Does not repeat' : r[0].toUpperCase() + r.slice(1) }));
  const tagsInput = h('input', { type: 'text', id: 'panel-tags', 'data-testid': 'panel-tags-input', placeholder: 'Add a tag' });
  const tagsBox = h('div', { class: 'tags-box' }, tagsInput);
  const subtasks = h('ul', { class: 'subtasks', 'aria-label': 'Subtasks' });
  const subAdd = h('input', { type: 'text', class: 'subtask-add', 'data-testid': 'subtask-add-input', 'aria-label': 'New subtask', placeholder: 'Add a subtask', maxlength: 200 });

  title.addEventListener('change', () => {
    const v = title.value.trim();
    if (v && v !== taskById(id)?.title) patchTask(id, { title: v }).catch(report);
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
  });
  close.addEventListener('click', closePanel);
  notes.addEventListener('blur', () => {
    if (notes.value !== taskById(id)?.notes) patchTask(id, { notes: notes.value }).catch(report);
  });
  due.addEventListener('change', () => patchTask(id, { dueDate: due.value || null }).catch(report));
  priority.addEventListener('change', () => patchTask(id, { priority: Number(priority.value) }).catch(report));
  repeat.addEventListener('change', () => patchTask(id, { repeat: repeat.value as Repeat }).catch(report));
  tagsInput.addEventListener('keydown', (e) => {
    const cur = taskById(id);
    if (!cur) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const tag = tagsInput.value.trim().toLowerCase();
      tagsInput.value = '';
      if (tag && !cur.tags.includes(tag)) patchTask(id, { tags: [...cur.tags, tag] }).catch(report);
    } else if (e.key === 'Backspace' && tagsInput.value === '' && cur.tags.length > 0) {
      e.preventDefault();
      patchTask(id, { tags: cur.tags.slice(0, -1) }).catch(report);
    }
  });
  subAdd.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const v = subAdd.value.trim();
    if (!v) return;
    subAdd.value = '';
    try {
      await api.addSubtask(id, v);
      upsert(await api.task(id));
      render();
    } catch (err) {
      report(err);
    }
  });

  els.panel.replaceChildren(
    h('div', { class: 'panel-head' }, title, close),
    h('label', { for: 'panel-notes', text: 'Notes' }),
    notes,
    h('label', { for: 'panel-due', text: 'Due date' }),
    due,
    h('label', { for: 'panel-priority', text: 'Priority' }),
    priority,
    h('label', { for: 'panel-tags', text: 'Tags (Enter adds, Backspace removes the last)' }),
    tagsBox,
    h('label', { for: 'panel-repeat', text: 'Repeat' }),
    repeat,
    h('label', { text: 'Subtasks' }),
    subtasks,
    subAdd,
  );
  Object.assign(panelEls, { title, notes, due, priority, repeat, tagsBox, tagsInput, subtasks });
}

function closePanel(): void {
  // Commit a pending notes edit before the panel goes away.
  if (document.activeElement instanceof HTMLElement && els.panel.contains(document.activeElement)) document.activeElement.blur();
  navigate(urlFor(state.listId));
}

// ---------------------------------------------------------------- events

els.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('tasks-theme', next);
  } catch {
    /* storage blocked: the theme still switches for this page */
  }
  applyTheme(next);
});
darkQuery.addEventListener('change', () => {
  if (!storedTheme()) applyTheme(darkQuery.matches ? 'dark' : 'light');
});

els.helpButton.addEventListener('click', toggleHelp);
els.help.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-close]') || e.target === els.help) els.help.close();
});

function toggleHelp(): void {
  if (els.help.open) els.help.close();
  else els.help.showModal();
}

els.listAdd.addEventListener('click', () => {
  state.addingList = true;
  els.listNameInput.hidden = false;
  els.listNameInput.value = '';
  els.listNameInput.focus();
});
els.listNameInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    els.listNameInput.hidden = true;
    state.addingList = false;
    return;
  }
  if (e.key !== 'Enter') return;
  const name = els.listNameInput.value.trim();
  if (!name) return;
  els.listNameInput.value = '';
  els.listNameInput.hidden = true;
  state.addingList = false;
  try {
    const l = await api.createList(name);
    await refreshLists();
    navigate(urlFor(l.id));
  } catch (err) {
    report(err);
  }
});
els.listNameInput.addEventListener('blur', () => {
  if (!els.listNameInput.value.trim()) {
    els.listNameInput.hidden = true;
    state.addingList = false;
  }
});

els.addInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const title = els.addInput.value.trim();
  els.addInput.value = '';
  if (title) addTask(title).catch(report);
});

els.search.addEventListener('input', () => {
  state.q = els.search.value;
  state.selected.clear();
  els.rows.scrollTop = 0;
  syncQuery();
  render();
});
els.sort.addEventListener('change', () => {
  state.sort = els.sort.value as Sort;
  syncQuery();
  render();
});

els.selectAll.addEventListener('change', () => {
  const all = state.visible.length > 0 && state.visible.every((t) => state.selected.has(t.id));
  if (all) state.selected.clear();
  else state.visible.forEach((t) => state.selected.add(t.id));
  render();
});
els.bulkComplete.addEventListener('click', () => bulk('complete').catch(report));
els.bulkDelete.addEventListener('click', () => bulk('delete').catch(report));
els.bulkMove.addEventListener('click', () => bulk('move').catch(report));

els.exportJson.addEventListener('click', () => exportList('json').catch(report));
els.exportCsv.addEventListener('click', () => exportList('csv').catch(report));
els.importInput.addEventListener('change', () => {
  const f = els.importInput.files?.[0];
  els.importInput.value = '';
  if (f) importFile(f).catch(report);
});

let scrollFrame = 0;
els.rows.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    renderRows();
  });
});
window.addEventListener('resize', () => renderRows());
window.addEventListener('popstate', () => void route());

function moveHighlight(delta: number): void {
  const v = state.visible;
  if (v.length === 0) return;
  let i = v.findIndex((t) => t.id === state.highlightId);
  i = i < 0 ? 0 : Math.min(v.length - 1, Math.max(0, i + delta));
  state.highlightId = v[i].id;
  // Keep the highlighted row in view.
  const top = i * ROW_H;
  if (top < els.rows.scrollTop) els.rows.scrollTop = top;
  else if (top + ROW_H > els.rows.scrollTop + els.rows.clientHeight) els.rows.scrollTop = top + ROW_H - els.rows.clientHeight;
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && !isTyping(e.target)) {
    if (els.help.open) return; // the dialog closes itself on Escape
    if (state.panelTaskId) closePanel();
    else if (state.selected.size > 0) {
      state.selected.clear();
      render();
    }
    return;
  }
  if (isTyping(e.target)) return;
  const h1 = state.visible.find((t) => t.id === state.highlightId);
  switch (e.key) {
    case 'n':
      e.preventDefault();
      els.addInput.focus();
      break;
    case '/':
      e.preventDefault();
      els.search.focus();
      break;
    case '?':
      e.preventDefault();
      toggleHelp();
      break;
    case 'j':
      moveHighlight(state.highlightId ? 1 : 0);
      break;
    case 'k':
      moveHighlight(state.highlightId ? -1 : 0);
      break;
    case 'x':
      if (h1) toggleTask(h1.id, !h1.completed).catch(report);
      break;
    case 'Delete':
      if (h1) deleteTask(h1.id).catch(report);
      break;
    case 'Enter':
      if (h1 && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
        e.preventDefault();
        navigate(urlFor(state.listId, h1.id));
      }
      break;
  }
});

// ---------------------------------------------------------------- start

applyTheme(initialTheme());
void route().catch(report);
