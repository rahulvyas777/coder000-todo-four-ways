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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  lists: (signal?: AbortSignal) => request<TaskList[]>('/api/lists', { signal }),
  tasks: (listId: number, signal?: AbortSignal) => request<TaskItem[]>(`/api/lists/${listId}/tasks`, { signal }),
}
