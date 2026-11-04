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

  async create(name: string): Promise<TaskList> {
    const list = await firstValueFrom(this.api.createList(name));
    this.lists.update((ls) => [...ls, list]);
    return list;
  }

  /** Posts an exported list file; the reload brings in the new list with its counts. */
  async import(payload: unknown): Promise<TaskList> {
    const list = await firstValueFrom(this.api.importList(payload));
    await this.reload();
    return list;
  }

  async rename(id: number, name: string): Promise<void> {
    const updated = await firstValueFrom(this.api.updateList(id, { name }));
    // Keep the counts we have if the PATCH response leaves them out.
    this.lists.update((ls) => ls.map((l) => (l.id === id ? { ...l, ...updated } : l)));
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.api.deleteList(id));
    this.lists.update((ls) => ls.filter((l) => l.id !== id));
  }

  /** Brings back a deleted list and its tasks; the reload puts it back in its position. */
  async restore(id: number): Promise<void> {
    await firstValueFrom(this.api.restoreList(id));
    await this.reload();
  }
}
