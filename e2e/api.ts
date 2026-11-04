// Typed client for the shared Tasks API (the contract in SPEC.md, "Shared API").
// Tests read every expected value through this client; nothing is hard-coded except the
// seed's fixed list ids 1 to 4 and the Archive titles "Ticket 00001" and "Ticket 10000".
import { APIRequestContext, expect } from '@playwright/test';

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

export interface TaskList {
  id: number;
  name: string;
  position: number;
  createdAt: string;
  deletedAt: string | null;
  taskCount: number;
  openCount: number;
}

export interface Subtask {
  id: number;
  taskId: number;
  title: string;
  done: boolean;
  position: number;
}

export interface TaskItem {
  id: number;
  listId: number;
  title: string;
  notes: string;
  dueDate: string | null;
  priority: number;
  tags: string[];
  completed: boolean;
  completedAt: string | null;
  position: number;
  repeat: Repeat;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: Subtask[];
}

export interface NewTask {
  title: string;
  notes?: string;
  dueDate?: string | null;
  priority?: number;
  tags?: string[];
  repeat?: Repeat;
}

export class Api {
  constructor(private readonly request: APIRequestContext, readonly baseUrl: string) {}

  private url(p: string): string {
    return this.baseUrl + p;
  }

  private async json<T>(method: 'get' | 'post' | 'patch' | 'delete', p: string, data?: unknown, okStatus?: number[]): Promise<T> {
    const res = await this.request.fetch(this.url(p), {
      method: method.toUpperCase(),
      data: data === undefined ? undefined : data,
      headers: data === undefined ? undefined : { 'content-type': 'application/json' },
    });
    const allowed = okStatus ?? [200, 201, 204];
    if (!allowed.includes(res.status())) {
      throw new Error(`${method.toUpperCase()} ${p} returned ${res.status()}: ${await res.text()}`);
    }
    if (res.status() === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async reset(): Promise<void> {
    const res = await this.request.post(this.url('/api/admin/reset'));
    expect(res.status(), 'POST /api/admin/reset').toBe(204);
  }

  lists(): Promise<TaskList[]> {
    return this.json('get', '/api/lists');
  }

  async list(id: number): Promise<TaskList | undefined> {
    return (await this.lists()).find((l) => l.id === id);
  }

  createList(name: string): Promise<TaskList> {
    return this.json('post', '/api/lists', { name });
  }

  tasks(listId: number): Promise<TaskItem[]> {
    return this.json('get', `/api/lists/${listId}/tasks`);
  }

  /** Returns the task, or null when it is unknown or soft-deleted (404). */
  async task(id: number): Promise<TaskItem | null> {
    const res = await this.request.get(this.url(`/api/tasks/${id}`));
    if (res.status() === 404) return null;
    expect(res.status(), `GET /api/tasks/${id}`).toBe(200);
    const t = (await res.json()) as TaskItem;
    return t.deletedAt ? null : t;
  }

  createTask(listId: number, t: NewTask): Promise<TaskItem> {
    return this.json('post', '/api/tasks', { listId, ...t });
  }

  patchTask(id: number, patch: Partial<NewTask> & { listId?: number }): Promise<TaskItem> {
    return this.json('patch', `/api/tasks/${id}`, patch);
  }

  complete(id: number): Promise<{ task: TaskItem; next: TaskItem | null }> {
    return this.json('post', `/api/tasks/${id}/complete`);
  }

  addSubtask(taskId: number, title: string): Promise<Subtask> {
    return this.json('post', `/api/tasks/${taskId}/subtasks`, { title });
  }

  patchSubtask(id: number, patch: { title?: string; done?: boolean }): Promise<Subtask> {
    return this.json('patch', `/api/subtasks/${id}`, patch);
  }

  async exportRaw(listId: number, format: 'json' | 'csv'): Promise<{ body: string; disposition: string }> {
    const res = await this.request.get(this.url(`/api/lists/${listId}/export?format=${format}`));
    expect(res.status()).toBe(200);
    return { body: await res.text(), disposition: res.headers()['content-disposition'] ?? '' };
  }

  /** Creates a fresh list with the given tasks, in order. Small and isolated from the seed. */
  async makeList(name: string, tasks: NewTask[]): Promise<{ list: TaskList; tasks: TaskItem[] }> {
    const list = await this.createList(name);
    const created: TaskItem[] = [];
    for (const t of tasks) created.push(await this.createTask(list.id, t));
    return { list, tasks: created };
  }
}

/** Local calendar date (the browser and the API run on the same PC) as yyyy-MM-dd. */
export function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const today = (): string => isoDate(0);
