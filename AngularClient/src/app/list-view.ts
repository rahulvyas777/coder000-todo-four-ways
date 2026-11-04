import { Component, computed, inject, input, numberAttribute } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_URL, TaskItem } from './api';
import { ListsStore } from './lists-store';

/** The main column for `/lists/{listId}`: header, task count and the task rows. */
@Component({
  selector: 'app-list-view',
  templateUrl: './list-view.html',
  host: { class: 'main' },
})
export class ListView {
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

  protected format(n: number): string {
    return n.toLocaleString('en-US');
  }
}
