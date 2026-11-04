import { Component, computed, inject, input, numberAttribute, signal, viewChild } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, map } from 'rxjs';
import { API_URL, Api, TaskItem } from './api';
import { Autofocus } from './autofocus';
import { ListsStore } from './lists-store';
import { TaskChanges, TaskPanel } from './task-panel';

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

/**
 * The main column for `/lists/{listId}` (header, task count, the add input and the task rows)
 * and, for `/lists/{listId}/tasks/{taskId}`, the detail panel next to it.
 */
@Component({
  selector: 'app-list-view',
  templateUrl: './list-view.html',
  imports: [Autofocus, TaskPanel],
  // The main column and the panel are cells of the shell's grid.
  host: { style: 'display: contents', '(document:keydown.escape)': 'onEscape($event)' },
})
export class ListView {
  private readonly api = inject(Api);
  private readonly store = inject(ListsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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

  /** The rows of the selected filter, in list order. */
  protected readonly visibleTasks = computed(() => {
    const view = this.view();
    const today = this.today();
    return this.tasks().filter((t) => matches(view, t, today));
  });

  protected setView(view: View): void {
    void this.router.navigate([], {
      queryParams: { view: view === 'all' ? null : view },
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

  protected async toggle(task: TaskItem, checkbox: HTMLInputElement): Promise<void> {
    const completed = checkbox.checked;
    // Optimistic: show the new state at once, then replace it with the server's task.
    this.replace({ ...task, completed });
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
  }

  /** A click anywhere on a row (but not on its controls) opens the panel. */
  protected openRow(task: TaskItem, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('input, button, select, textarea')) return;
    void this.router.navigate(['/lists', this.listId(), 'tasks', task.id], { queryParamsHandling: 'preserve' });
  }

  protected closePanel(): void {
    void this.router.navigate(['/lists', this.listId()], { queryParamsHandling: 'preserve' });
  }

  /** Escape closes the panel, except while typing in an inline editor outside it. */
  protected onEscape(event: Event): void {
    const panel = this.panel();
    if (!panel) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select') && !target.closest('.panel')) return;
    panel.close();
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

  /** The sidebar counts come from the server. */
  private refreshCounts(): void {
    void this.store.reload();
  }
}
