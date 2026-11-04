import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export const API_URL = 'http://localhost:16040';

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

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

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

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  lists(): Observable<TaskList[]> {
    return this.http.get<TaskList[]>(`${API_URL}/api/lists`);
  }

  createList(name: string): Observable<TaskList> {
    return this.http.post<TaskList>(`${API_URL}/api/lists`, { name });
  }

  updateList(id: number, changes: { name?: string; position?: number }): Observable<TaskList> {
    return this.http.patch<TaskList>(`${API_URL}/api/lists/${id}`, changes);
  }

  deleteList(id: number): Observable<void> {
    return this.http.delete<void>(`${API_URL}/api/lists/${id}`);
  }

  tasks(listId: number): Observable<TaskItem[]> {
    return this.http.get<TaskItem[]>(`${API_URL}/api/lists/${listId}/tasks`);
  }

  createTask(listId: number, title: string): Observable<TaskItem> {
    return this.http.post<TaskItem>(`${API_URL}/api/tasks`, { listId, title });
  }

  updateTask(id: number, changes: Partial<Pick<TaskItem, 'title' | 'notes' | 'dueDate' | 'priority' | 'tags' | 'repeat' | 'listId'>>): Observable<TaskItem> {
    return this.http.patch<TaskItem>(`${API_URL}/api/tasks/${id}`, changes);
  }

  completeTask(id: number): Observable<{ task: TaskItem; next: TaskItem | null }> {
    return this.http.post<{ task: TaskItem; next: TaskItem | null }>(`${API_URL}/api/tasks/${id}/complete`, {});
  }

  reopenTask(id: number): Observable<TaskItem> {
    return this.http.post<TaskItem>(`${API_URL}/api/tasks/${id}/reopen`, {});
  }

  deleteTask(id: number): Observable<void> {
    return this.http.delete<void>(`${API_URL}/api/tasks/${id}`);
  }

  reorderTasks(listId: number, orderedIds: number[]): Observable<void> {
    return this.http.post<void>(`${API_URL}/api/tasks/reorder`, { listId, orderedIds });
  }
}
