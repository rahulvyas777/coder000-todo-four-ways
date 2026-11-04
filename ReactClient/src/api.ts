// Typed access to the Tasks API (see SPEC.md, "Shared API").
const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:16030').replace(/\/+$/, '')

export interface TaskList {
  id: number
  name: string
  position: number
  createdAt: string
  deletedAt: string | null
  taskCount: number
  openCount: number
}

export interface Subtask {
  id: number
  taskId: number
  title: string
  done: boolean
  position: number
}

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly'

export interface TaskItem {
  id: number
  listId: number
  title: string
  notes: string
  dueDate: string | null
  priority: 0 | 1 | 2 | 3
  tags: string[]
  completed: boolean
  completedAt: string | null
  position: number
  repeat: Repeat
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  subtasks: Subtask[]
}

/** The fields PATCH /api/tasks/{id} accepts. */
export type TaskChanges = Partial<Pick<TaskItem, 'title' | 'notes' | 'dueDate' | 'priority' | 'tags' | 'repeat' | 'listId'>>

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const api = {
  lists: (signal?: AbortSignal) => request<TaskList[]>('/api/lists', { signal }),
  createList: (name: string) => send<TaskList>('POST', '/api/lists', { name }),
  updateList: (id: number, changes: { name?: string; position?: number }) =>
    send<TaskList>('PATCH', `/api/lists/${id}`, changes),
  deleteList: (id: number) => send<void>('DELETE', `/api/lists/${id}`),
  tasks: (listId: number, signal?: AbortSignal) => request<TaskItem[]>(`/api/lists/${listId}/tasks`, { signal }),
  createTask: (listId: number, title: string) => send<TaskItem>('POST', '/api/tasks', { listId, title }),
  updateTask: (id: number, changes: TaskChanges) =>
    send<TaskItem>('PATCH', `/api/tasks/${id}`, changes),
  completeTask: (id: number) => send<{ task: TaskItem; next: TaskItem | null }>('POST', `/api/tasks/${id}/complete`),
  reopenTask: (id: number) => send<TaskItem>('POST', `/api/tasks/${id}/reopen`),
  deleteTask: (id: number) => send<void>('DELETE', `/api/tasks/${id}`),
  reorderTasks: (listId: number, orderedIds: number[]) =>
    send<void>('POST', '/api/tasks/reorder', { listId, orderedIds }),
  addSubtask: (taskId: number, title: string) => send<Subtask>('POST', `/api/tasks/${taskId}/subtasks`, { title }),
  updateSubtask: (id: number, changes: { title?: string; done?: boolean; position?: number }) =>
    send<Subtask>('PATCH', `/api/subtasks/${id}`, changes),
  deleteSubtask: (id: number) => send<void>('DELETE', `/api/subtasks/${id}`),
}
