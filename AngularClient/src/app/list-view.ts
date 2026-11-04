import { ChangeDetectorRef, Component, ElementRef, computed, inject, input, linkedSignal, numberAttribute, signal, viewChild } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, map } from 'rxjs';
import { API_URL, Api, Subtask, TaskItem } from './api';
import { Autofocus } from './autofocus';
import { ListsStore } from './lists-store';
import { TaskChanges, TaskPanel } from './task-panel';
import { UndoService } from './undo';

type View = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed';

const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
];

function toView(value: string | null): View {
  return VIEWS.some((v) => v.id === value) ? (value as View) : 'all';
}

/** All = open tasks; Today and Upcoming include completed tasks; Overdue = open only. */
function matches(view: View, task: TaskItem, today: string): boolean {
  switch (view) {
    case 'all':
      return !task.completed;
    case 'today':
      return task.dueDate === today;
    case 'upcoming':
      return !!task.dueDate && task.dueDate > today;
    case 'overdue':
      return !task.completed && !!task.dueDate && task.dueDate < today;
    case 'completed':
      return task.completed;
  }
}

type Sort = 'manual' | 'due' | 'priority' | 'title' | 'created';

const SORTS: readonly { id: Sort; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'due', label: 'Due date' },
  { id: 'priority', label: 'Priority' },
  { id: 'title', label: 'Title' },
  { id: 'created', label: 'Created' },
];

function toSort(value: string | null): Sort {
  return SORTS.some((s) => s.id === value) ? (value as Sort) : 'manual';
}

/** Ties keep the manual order (the list's positions). */
function compare(sort: Sort, a: TaskItem, b: TaskItem): number {
  switch (sort) {
    case 'manual':
      return 0;
    case 'due':
      // Nulls last; ISO dates compare as strings.
      if (a.dueDate === b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    case 'priority':
      return b.priority - a.priority;
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'created':
      // Oldest first; ids follow creation order when timestamps tie.
      return a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
  }
}

function matchesQuery(task: TaskItem, q: string): boolean {
  return (
    task.title.toLowerCase().includes(q) ||
    task.notes.toLowerCase().includes(q) ||
    task.tags.some((tag) => tag.includes(q))
  );
}

/**
 * The main column for `/lists/{listId}` (header, task count, the add input and the task rows)
 * and, for `/lists/{listId}/tasks/{taskId}`, the detail panel next to it.
 */
@Component({
  selector: 'app-list-view',
  templateUrl: './list-view.html',
  imports: [Autofocus, TaskPanel],
  // The main column and the panel are cells of the shell's grid.
  host: { style: 'display: contents', '(document:keydown)': 'onKeydown($event)' },
})
export class ListView {
  private readonly api = inject(Api);
  private readonly store = inject(ListsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly undo = inject(UndoService);

  readonly listId = input.required({ transform: numberAttribute });

  /** The task of `/lists/{l}/tasks/{t}`, null on `/lists/{l}`. */
  protected readonly openTaskId = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.taskIdInUrl()),
    ),
    { initialValue: this.taskIdInUrl() },
  );

  protected readonly openTask = computed(() => {
    const id = this.openTaskId();
    return id === null ? undefined : this.tasks().find((t) => t.id === id);
  });

  private readonly panel = viewChild(TaskPanel);
  private readonly addInput = viewChild.required<ElementRef<HTMLInputElement>>('addInput');
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly help = viewChild.required<ElementRef<HTMLDialogElement>>('help');

  protected readonly list = computed(() => this.store.lists().find((l) => l.id === this.listId()));

  protected readonly tasksResource = httpResource<TaskItem[]>(
    () => `${API_URL}/api/lists/${this.listId()}/tasks`,
    { defaultValue: [] },
  );

  protected readonly tasks = computed(() =>
    this.tasksResource.hasValue() ? this.tasksResource.value() : [],
  );

  protected readonly openCount = computed(() => this.tasks().filter((t) => !t.completed).length);

  protected readonly views = VIEWS;

  /** The filter of `?view=`; anything unknown is All. */
  protected readonly view = toSignal(
    this.route.queryParamMap.pipe(map((q) => toView(q.get('view')))),
    { initialValue: toView(this.route.snapshot.queryParamMap.get('view')) },
  );

  /** How many tasks each filter shows. */
  protected readonly viewCounts = computed(() => {
    const today = this.today();
    const counts: Record<View, number> = { all: 0, today: 0, upcoming: 0, overdue: 0, completed: 0 };
    for (const t of this.tasks()) {
      for (const v of VIEWS) if (matches(v.id, t, today)) counts[v.id]++;
    }
    return counts;
  });

  protected readonly sorts = SORTS;

  /** The sort of `?sort=`; anything unknown is Manual. */
  protected readonly sort = toSignal(
    this.route.queryParamMap.pipe(map((q) => toSort(q.get('sort')))),
    { initialValue: toSort(this.route.snapshot.queryParamMap.get('sort')) },
  );

  private readonly urlQuery = toSignal(
    this.route.queryParamMap.pipe(map((q) => q.get('q') ?? '')),
    { initialValue: this.route.snapshot.queryParamMap.get('q') ?? '' },
  );

  /**
   * The search text. It follows `?q=` but is set at once on every keystroke, so the rows
   * re-render without waiting for the navigation. No debounce on purpose: the comparison
   * measures how fast each framework renders the filtered rows.
   */
  protected readonly query = linkedSignal(() => this.urlQuery());

  /** The rows of the selected filter matching the search, in the selected order. */
  protected readonly visibleTasks = computed(() => {
    const view = this.view();
    const today = this.today();
    const q = this.query().trim().toLowerCase();
    const sort = this.sort();
    const rows = this.tasks().filter((t) => matches(view, t, today) && (!q || matchesQuery(t, q)));
    // Array.prototype.sort is stable, so ties stay in manual order.
    return sort === 'manual' ? rows : rows.sort((a, b) => compare(sort, a, b));
  });

  protected setView(view: View): void {
    void this.router.navigate([], {
      queryParams: { view: view === 'all' ? null : view },
      queryParamsHandling: 'merge',
    });
  }

  protected setQuery(q: string): void {
    this.query.set(q);
    void this.router.navigate([], {
      queryParams: { q: q || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setSort(value: string): void {
    const sort = toSort(value);
    void this.router.navigate([], {
      queryParams: { sort: sort === 'manual' ? null : sort },
      queryParamsHandling: 'merge',
    });
  }

  /** The id of the task whose title is being edited inline. */
  protected readonly editingId = signal<number | null>(null);

  protected format(n: number): string {
    return n.toLocaleString('en-US');
  }

  protected async addTask(input: HTMLInputElement): Promise<void> {
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    const listId = this.listId();
    const task = await firstValueFrom(this.api.createTask(listId, title));
    if (this.listId() === listId) this.tasksResource.update((ts) => [...(ts ?? []), task]);
    this.refreshCounts();
  }

  protected async toggle(task: TaskItem, completed: boolean): Promise<void> {
    // Optimistic: show the new state at once, then replace it with the server's task.
    this.replace({ ...task, completed });
    // Render it inside the click, so the row never shows the old state after the server answers.
    this.cdr.detectChanges();
    try {
      const saved = completed
        ? (await firstValueFrom(this.api.completeTask(task.id))).task
        : await firstValueFrom(this.api.reopenTask(task.id));
      this.replace(saved);
    } catch {
      this.replace(task);
    }
    this.refreshCounts();
  }

  protected startEdit(id: number): void {
    this.editingId.set(id);
    // Render the editor now so it has focus before the next keystroke, not a frame later.
    this.cdr.detectChanges();
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected async commitEdit(task: TaskItem, value: string): Promise<void> {
    // Escape clears editingId first, so the blur that follows the input's removal is a no-op.
    if (this.editingId() !== task.id) return;
    this.editingId.set(null);
    const title = value.trim();
    if (!title || title === task.title) return;
    this.replace({ ...task, title });
    try {
      this.replace(await firstValueFrom(this.api.updateTask(task.id, { title })));
    } catch {
      this.replace(task);
    }
  }

  protected async deleteTask(task: TaskItem): Promise<void> {
    await firstValueFrom(this.api.deleteTask(task.id));
    this.tasksResource.update((ts) => (ts ?? []).filter((t) => t.id !== task.id));
    this.refreshCounts();
    this.undo.show(`Deleted "${task.title}"`, async () => {
      await firstValueFrom(this.api.restoreTask(task.id));
      this.afterUndo(task.listId);
    });
  }

  /** The task being dragged by its handle (manual sort only; native HTML5 drag and drop). */
  protected readonly draggingId = signal<number | null>(null);

  /** The row under the pointer and which half of it: the drop goes before or after it. */
  protected readonly dropTarget = signal<{ id: number; after: boolean } | null>(null);

  protected onDragStart(task: TaskItem, event: DragEvent): void {
    this.draggingId.set(task.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Some browsers only start a drag when data is set.
      event.dataTransfer.setData('text/plain', String(task.id));
      const row = (event.target as HTMLElement).closest('.task-row');
      if (row) event.dataTransfer.setDragImage(row, 16, 20);
    }
  }

  protected onDragOver(task: TaskItem, event: DragEvent): void {
    const dragged = this.draggingId();
    if (dragged === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dragged === task.id) {
      this.dropTarget.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const current = this.dropTarget();
    if (current?.id !== task.id || current.after !== after) this.dropTarget.set({ id: task.id, after });
  }

  protected onDragEnd(): void {
    this.draggingId.set(null);
    this.dropTarget.set(null);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const dragged = this.draggingId();
    const target = this.dropTarget();
    this.onDragEnd();
    if (dragged === null || !target || target.id === dragged) return;

    // The visible rows may be filtered, so the move is applied to the whole list's order.
    const before = this.tasks();
    const moved = before.find((t) => t.id === dragged);
    if (!moved) return;
    const rest = before.filter((t) => t.id !== dragged);
    const index = rest.findIndex((t) => t.id === target.id);
    if (index < 0) return;
    rest.splice(target.after ? index + 1 : index, 0, moved);
    const reordered = rest.map((t, i) => ({ ...t, position: i + 1 }));

    const listId = this.listId();
    this.tasksResource.set(reordered);
    try {
      await firstValueFrom(this.api.reorderTasks(listId, reordered.map((t) => t.id)));
    } catch {
      if (this.listId() === listId) this.tasksResource.set(before);
    }
  }

  /** The ids of the selected rows; a new list starts with none. */
  protected readonly selected = linkedSignal<number, ReadonlySet<number>>({
    source: () => this.listId(),
    computation: () => new Set(),
  });

  /** The selected tasks that are still in the list. */
  private readonly selectedIds = computed(() => {
    const selected = this.selected();
    return this.tasks().filter((t) => selected.has(t.id)).map((t) => t.id);
  });

  protected readonly selectedCount = computed(() => this.selectedIds().length);

  protected readonly allVisibleSelected = computed(() => {
    const rows = this.visibleTasks();
    const selected = this.selected();
    return rows.length > 0 && rows.every((t) => selected.has(t.id));
  });

  /** The lists a selection can move to: every list but this one. */
  protected readonly moveTargets = computed(() => this.store.lists().filter((l) => l.id !== this.listId()));

  protected readonly moveTargetId = linkedSignal(() => this.moveTargets()[0]?.id ?? null);

  protected toggleSelected(task: TaskItem, checked: boolean): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (checked) next.add(task.id);
      else next.delete(task.id);
      return next;
    });
  }

  /** Selects every visible row, or clears the selection when they all are selected already. */
  protected toggleSelectAll(): void {
    this.selected.set(this.allVisibleSelected() ? new Set() : new Set(this.visibleTasks().map((t) => t.id)));
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected async bulk(action: 'complete' | 'delete' | 'move'): Promise<void> {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const target = action === 'move' ? this.moveTargetId() : undefined;
    if (action === 'move' && target == null) return;
    const listId = this.listId();
    const affected = new Set(ids);
    this.clearSelection();
    await firstValueFrom(this.api.bulk(ids, action, target ?? undefined));
    if (this.listId() === listId) {
      this.tasksResource.update((ts) =>
        action === 'complete'
          ? (ts ?? []).map((t) => (affected.has(t.id) ? { ...t, completed: true } : t))
          : (ts ?? []).filter((t) => !affected.has(t.id)),
      );
      // Completing a repeating task creates its next occurrence on the server.
      if (action === 'complete') this.tasksResource.reload();
    }
    this.refreshCounts();
    if (action === 'move') return;
    const n = ids.length;
    const noun = n === 1 ? 'task' : 'tasks';
    this.undo.show(action === 'complete' ? `Completed ${n} ${noun}` : `Deleted ${n} ${noun}`, async () => {
      await firstValueFrom(this.api.bulk(ids, action === 'complete' ? 'reopen' : 'restore'));
      this.afterUndo(listId);
    });
  }

  /** After an undo the server's state is the truth: reload the rows (if still shown) and counts. */
  private afterUndo(listId: number): void {
    if (this.listId() === listId) this.tasksResource.reload();
    this.refreshCounts();
  }

  /** A click anywhere on a row (but not on its controls) opens the panel. */
  protected openRow(task: TaskItem, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('input, button, select, textarea')) return;
    void this.router.navigate(['/lists', this.listId(), 'tasks', task.id], { queryParamsHandling: 'preserve' });
  }

  protected closePanel(): void {
    void this.router.navigate(['/lists', this.listId()], { queryParamsHandling: 'preserve' });
  }

  /** The row the keyboard cursor (j/k) is on; a new list starts with none. */
  protected readonly highlightedId = linkedSignal<number, number | null>({
    source: () => this.listId(),
    computation: () => null,
  });

  /** The highlighted task while its row is visible. */
  private readonly highlighted = computed(() => {
    const id = this.highlightedId();
    return this.visibleTasks().find((t) => t.id === id);
  });

  /**
   * The single-key shortcuts (listed in the help dialog). They are ignored while typing in a
   * field, with a modifier held, and, but for ? and Escape, while the help dialog is open.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.onEscape(event);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === '?') {
      event.preventDefault();
      this.toggleHelp();
      return;
    }
    if (this.help().nativeElement.open) return;
    switch (event.key) {
      case 'n':
        event.preventDefault();
        this.addInput().nativeElement.focus();
        break;
      case '/':
        event.preventDefault();
        this.searchInput().nativeElement.focus();
        break;
      case 'j':
        this.moveHighlight(1);
        break;
      case 'k':
        this.moveHighlight(-1);
        break;
      case 'x': {
        const task = this.highlighted();
        if (task) void this.toggle(task, !task.completed);
        break;
      }
      case 'Delete': {
        const task = this.highlighted();
        if (!task) return;
        // The cursor moves on to the next row (or the previous one at the end).
        const rows = this.visibleTasks();
        const i = rows.indexOf(task);
        this.highlightedId.set((rows[i + 1] ?? rows[i - 1])?.id ?? null);
        void this.deleteTask(task);
        break;
      }
      case 'Enter': {
        // Enter on a focused button, link or checkbox keeps its own meaning.
        if (target.closest('button, a, input')) return;
        const task = this.highlighted();
        if (!task) return;
        event.preventDefault();
        void this.router.navigate(['/lists', this.listId(), 'tasks', task.id], { queryParamsHandling: 'preserve' });
        break;
      }
    }
  }

  /** The first j or k highlights the first row; the cursor stops at either end. */
  private moveHighlight(delta: 1 | -1): void {
    const rows = this.visibleTasks();
    if (rows.length === 0) return;
    const current = this.highlighted();
    const i = current ? rows.indexOf(current) + delta : 0;
    const next = rows[Math.min(Math.max(i, 0), rows.length - 1)];
    this.highlightedId.set(next.id);
    this.cdr.detectChanges();
    document.querySelector(`[data-testid="task-row-${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  protected toggleHelp(): void {
    const dialog = this.help().nativeElement;
    if (dialog.open) dialog.close();
    else dialog.showModal();
  }

  /**
   * Escape closes the help dialog, else the panel, or else clears the selection; never while
   * typing in an inline editor outside the panel.
   */
  private onEscape(event: Event): void {
    const help = this.help().nativeElement;
    if (help.open) {
      help.close();
      return;
    }
    const panel = this.panel();
    const target = event.target as HTMLElement;
    if (target.closest('input[type="text"], input[type="search"], textarea, select') && !target.closest('.panel')) return;
    if (panel) panel.close();
    else this.clearSelection();
  }

  protected async saveDetails(task: TaskItem, changes: TaskChanges): Promise<void> {
    const before = this.tasks().find((t) => t.id === task.id) ?? task;
    this.replace({ ...before, ...changes });
    try {
      this.replace(await firstValueFrom(this.api.updateTask(task.id, changes)));
    } catch {
      this.replace(before);
    }
  }

  protected async addSubtask(task: TaskItem, title: string): Promise<void> {
    const subtask = await firstValueFrom(this.api.createSubtask(task.id, title));
    this.updateSubtasks(task.id, (ss) => [...ss, subtask]);
  }

  /** Subtasks never complete or reopen their task; only the subtask changes. */
  protected async toggleSubtask(task: TaskItem, subtask: Subtask): Promise<void> {
    const done = !subtask.done;
    this.updateSubtasks(task.id, (ss) => ss.map((s) => (s.id === subtask.id ? { ...s, done } : s)));
    try {
      const saved = await firstValueFrom(this.api.updateSubtask(subtask.id, { done }));
      this.updateSubtasks(task.id, (ss) => ss.map((s) => (s.id === saved.id ? saved : s)));
    } catch {
      this.updateSubtasks(task.id, (ss) => ss.map((s) => (s.id === subtask.id ? subtask : s)));
    }
  }

  protected async deleteSubtask(task: TaskItem, subtask: Subtask): Promise<void> {
    await firstValueFrom(this.api.deleteSubtask(subtask.id));
    this.updateSubtasks(task.id, (ss) => ss.filter((s) => s.id !== subtask.id));
  }

  protected doneCount(task: TaskItem): number {
    return task.subtasks.filter((s) => s.done).length;
  }

  /** Short local date for the rows, e.g. "Nov 7" (the year only when it is not this year). */
  protected formatDue(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const sameYear = y === new Date().getFullYear();
    return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected isOverdue(task: TaskItem): boolean {
    return !task.completed && !!task.dueDate && task.dueDate < this.today();
  }

  protected readonly priorityNames = ['None', 'Low', 'Medium', 'High'];

  private today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private taskIdInUrl(): number | null {
    // While the view is first created the child route has no snapshot yet; NavigationEnd follows.
    const id = this.route.firstChild?.snapshot?.paramMap.get('taskId');
    return id ? Number(id) : null;
  }

  private replace(task: TaskItem): void {
    this.tasksResource.update((ts) => (ts ?? []).map((t) => (t.id === task.id ? task : t)));
  }

  private updateSubtasks(taskId: number, change: (subtasks: Subtask[]) => Subtask[]): void {
    this.tasksResource.update((ts) =>
      (ts ?? []).map((t) => (t.id === taskId ? { ...t, subtasks: change(t.subtasks) } : t)),
    );
  }

  /** The sidebar counts come from the server. */
  private refreshCounts(): void {
    void this.store.reload();
  }
}
