// fetch client for the shared Tasks API. The base URL comes from VITE_API_URL (default: the
// reference client's API port).
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:16050';

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

export interface Task {
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

export type TaskPatch = Partial<Pick<Task, 'title' | 'notes' | 'dueDate' | 'priority' | 'tags' | 'repeat' | 'listId'>>;
export type BulkAction = 'complete' | 'reopen' | 'delete' | 'restore' | 'move';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  lists: () => call<TaskList[]>('GET', '/api/lists'),
  createList: (name: string) => call<TaskList>('POST', '/api/lists', { name }),
  renameList: (id: number, name: string) => call<TaskList>('PATCH', `/api/lists/${id}`, { name }),
  deleteList: (id: number) => call<void>('DELETE', `/api/lists/${id}`),
  restoreList: (id: number) => call<TaskList>('POST', `/api/lists/${id}/restore`),
  tasks: (listId: number) => call<Task[]>('GET', `/api/lists/${listId}/tasks`),
  task: (id: number) => call<Task>('GET', `/api/tasks/${id}`),
  createTask: (listId: number, title: string) => call<Task>('POST', '/api/tasks', { listId, title }),
  patchTask: (id: number, patch: TaskPatch) => call<Task>('PATCH', `/api/tasks/${id}`, patch),
  complete: (id: number) => call<{ task: Task; next: Task | null }>('POST', `/api/tasks/${id}/complete`),
  reopen: (id: number) => call<Task>('POST', `/api/tasks/${id}/reopen`),
  deleteTask: (id: number) => call<void>('DELETE', `/api/tasks/${id}`),
  restoreTask: (id: number) => call<Task>('POST', `/api/tasks/${id}/restore`),
  reorder: (listId: number, orderedIds: number[]) => call<void>('POST', '/api/tasks/reorder', { listId, orderedIds }),
  bulk: (ids: number[], action: BulkAction, targetListId?: number) =>
    call<{ affected: number }>('POST', '/api/tasks/bulk', { ids, action, targetListId }),
  addSubtask: (taskId: number, title: string) => call<Subtask>('POST', `/api/tasks/${taskId}/subtasks`, { title }),
  patchSubtask: (id: number, patch: Partial<Pick<Subtask, 'title' | 'done' | 'position'>>) =>
    call<Subtask>('PATCH', `/api/subtasks/${id}`, patch),
  deleteSubtask: (id: number) => call<void>('DELETE', `/api/subtasks/${id}`),
  importList: (data: unknown) => call<TaskList>('POST', '/api/lists/import', data),
  exportUrl: (listId: number, format: 'json' | 'csv') => `${API_URL}/api/lists/${listId}/export?format=${format}`,
};
