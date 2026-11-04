import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL, Api, TaskItem } from './api';
import { Autofocus } from './autofocus';
import { ListsStore } from './lists-store';

/** The main column for `/lists/{listId}`: header, task count, the add input and the task rows. */
@Component({
  selector: 'app-list-view',
  templateUrl: './list-view.html',
  imports: [Autofocus],
  host: { class: 'main' },
})
export class ListView {
  private readonly api = inject(Api);
  private readonly store = inject(ListsStore);

  readonly listId = input.required({ transform: numberAttribute });

  protected readonly list = computed(() => this.store.lists().find((l) => l.id === this.listId()));

  protected readonly tasksResource = httpResource<TaskItem[]>(
    () => `${API_URL}/api/lists/${this.listId()}/tasks`,
    { defaultValue: [] },
  );

  protected readonly tasks = computed(() =>
    this.tasksResource.hasValue() ? this.tasksResource.value() : [],
  );

  protected readonly openCount = computed(() => this.tasks().filter((t) => !t.completed).length);

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

  private replace(task: TaskItem): void {
    this.tasksResource.update((ts) => (ts ?? []).map((t) => (t.id === task.id ? task : t)));
  }

  /** The sidebar counts come from the server. */
  private refreshCounts(): void {
    void this.store.reload();
  }
}
