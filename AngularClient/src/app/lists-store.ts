import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api, TaskList } from './api';

/** The lists of the sidebar, shared by the shell and the routes. */
@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly api = inject(Api);
  private loading: Promise<TaskList[]> | null = null;

  readonly lists = signal<TaskList[]>([]);

  /** Loads the lists once; later calls reuse the first request. */
  ensureLoaded(): Promise<TaskList[]> {
    this.loading ??= this.reload();
    return this.loading;
  }

  async reload(): Promise<TaskList[]> {
    const lists = await firstValueFrom(this.api.lists());
    this.lists.set(lists);
    return lists;
  }
}
